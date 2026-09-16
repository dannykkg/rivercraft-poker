import { createDeck, CryptoRandomSource, shuffleDeck } from "../domain/cards";
import { selectWinningIndexes } from "../domain/evaluator";
import type { Card, RandomSource } from "../domain/types";

export interface EquityResult {
  win: number;
  tie: number;
  loss: number;
  samples: number;
}

export const estimateEquity = (
  holeCards: readonly Card[],
  board: readonly Card[],
  opponentCount: number,
  samples = 800,
  random: RandomSource = new CryptoRandomSource(),
): EquityResult => {
  if (holeCards.length !== 2) throw new Error("Equity calculation requires two hole cards.");
  if (board.length > 5) throw new Error("The board cannot contain more than five cards.");
  if (opponentCount < 1 || opponentCount > 8) throw new Error("Opponent count must be between 1 and 8.");
  const known = new Set([...holeCards, ...board]);
  if (known.size !== holeCards.length + board.length) throw new Error("Known cards must be unique.");

  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const deck = shuffleDeck(createDeck().filter((card) => !known.has(card)), random);
    const opponents = Array.from({ length: opponentCount }, () => [deck.pop()!, deck.pop()!] as Card[]);
    const runout = [...board];
    while (runout.length < 5) runout.push(deck.pop()!);
    const hands = [[...holeCards, ...runout], ...opponents.map((cards) => [...cards, ...runout])] as Card[][];
    const winners = selectWinningIndexes(hands);
    if (winners.includes(0)) {
      if (winners.length === 1) wins += 1;
      else ties += 1;
    } else losses += 1;
  }
  return {
    win: wins / samples,
    tie: ties / samples,
    loss: losses / samples,
    samples,
  };
};

export const calculatePotOdds = (toCall: number, potBeforeCall: number): number => {
  if (toCall <= 0) return 0;
  return toCall / (potBeforeCall + toCall);
};
