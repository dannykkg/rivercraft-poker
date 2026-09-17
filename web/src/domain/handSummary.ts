import { evaluateHand } from "./evaluator";
import type { Card } from "./types";

export interface CurrentHandSummary {
  stage: "起手牌" | "翻牌" | "转牌" | "河牌";
  label: string;
  bestFive: Card[];
}

const rankLabel = (card: Card): string => card[0] === "T" ? "10" : card[0];

const groupedRanks = (cards: readonly Card[]): Map<string, number> => {
  const groups = new Map<string, number>();
  cards.forEach((card) => groups.set(rankLabel(card), (groups.get(rankLabel(card)) ?? 0) + 1));
  return groups;
};

const rankWithCount = (groups: Map<string, number>, count: number): string[] =>
  [...groups.entries()].filter(([, value]) => value === count).map(([rank]) => rank);

const detailedHandLabel = (name: string, bestFive: readonly Card[]): string => {
  const groups = groupedRanks(bestFive);
  const pairRanks = rankWithCount(groups, 2);
  const tripRank = rankWithCount(groups, 3)[0];
  const quadRank = rankWithCount(groups, 4)[0];
  const highRank = bestFive[0] ? rankLabel(bestFive[0]) : "";
  switch (name) {
    case "High Card": return `高牌 ${highRank}`;
    case "Pair": return `一对 ${pairRanks[0]}`;
    case "Two Pair": return `两对 ${pairRanks.join("、")}`;
    case "Three of a Kind": return `三条 ${tripRank}`;
    case "Straight": return `顺子 · ${highRank} 高`;
    case "Flush": return `同花 · ${highRank} 高`;
    case "Full House": return `葫芦 · ${tripRank} 带 ${pairRanks[0]}`;
    case "Four of a Kind": return `四条 ${quadRank}`;
    case "Straight Flush": return `同花顺 · ${highRank} 高`;
    case "Royal Flush": return "皇家同花顺";
    default: return name;
  }
};

export const summarizeCurrentHand = (
  holeCards: readonly Card[],
  board: readonly Card[],
): CurrentHandSummary | null => {
  if (holeCards.length !== 2) return null;
  if (board.length < 3) {
    const isPair = holeCards[0][0] === holeCards[1][0];
    const rankOrder = "23456789TJQKA";
    const highCard = [...holeCards].sort((first, second) => rankOrder.indexOf(second[0]) - rankOrder.indexOf(first[0]))[0];
    return {
      stage: "起手牌",
      label: isPair ? `一对 ${rankLabel(holeCards[0])}` : `${rankLabel(highCard)} 高`,
      bestFive: [...holeCards],
    };
  }

  const evaluated = evaluateHand([...holeCards, ...board]);
  const stage = board.length === 3 ? "翻牌" : board.length === 4 ? "转牌" : "河牌";
  return { stage, label: detailedHandLabel(evaluated.name, evaluated.bestFive), bestFive: evaluated.bestFive };
};
