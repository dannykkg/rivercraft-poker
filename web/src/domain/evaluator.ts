import { Hand } from "pokersolver";
import type { Card } from "./types";

export interface EvaluatedHand {
  name: string;
  description: string;
  rank: number;
  source: Hand;
}

export const evaluateHand = (cards: readonly Card[]): EvaluatedHand => {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`Expected 5 to 7 cards, received ${cards.length}.`);
  }
  const solved = Hand.solve([...cards]);
  return {
    name: solved.name,
    description: solved.descr,
    rank: solved.rank,
    source: solved,
  };
};

export const selectWinningIndexes = (hands: readonly (readonly Card[])[]): number[] => {
  const solved = hands.map((cards) => Hand.solve([...cards]));
  const winners = new Set(Hand.winners(solved));
  return solved.flatMap((hand, index) => winners.has(hand) ? [index] : []);
};

export const compareHands = (first: readonly Card[], second: readonly Card[]): number => {
  const [firstHand, secondHand] = [Hand.solve([...first]), Hand.solve([...second])];
  const winners = Hand.winners([firstHand, secondHand]);
  if (winners.length === 2) return 0;
  return winners[0] === firstHand ? 1 : -1;
};
