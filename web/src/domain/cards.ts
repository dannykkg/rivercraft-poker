import type { Card, RandomSource, Rank, Suit } from "./types";

const RANKS: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS: readonly Suit[] = ["c", "d", "h", "s"];

export const createDeck = (): Card[] =>
  SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}` as Card));

export const shuffleDeck = (cards: readonly Card[], random: RandomSource): Card[] => {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random.next() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

export class CryptoRandomSource implements RandomSource {
  next(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 0x1_0000_0000;
  }
}

export class SeededRandomSource implements RandomSource {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0;
  }

  next(): number {
    this.value += 0x6d2b79f5;
    let next = this.value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 0x1_0000_0000;
  }
}

export const cardRankLabel = (card: Card): string => card[0] === "T" ? "10" : card[0];

export const cardSuitSymbol = (card: Card): string => {
  const symbols: Record<Suit, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };
  return symbols[card[1] as Suit];
};

export const isRedCard = (card: Card): boolean => card.endsWith("d") || card.endsWith("h");
