import type {
  BotDifficulty,
  BotStyle,
  Card,
  PlayerAction,
  PlayerView,
  RandomSource,
} from "../domain/types";
import { CryptoRandomSource } from "../domain/cards";
import { evaluateHand } from "../domain/evaluator";
import { calculatePotOdds } from "../poker-tools/equity";

const CATEGORY_STRENGTH: Record<string, number> = {
  "High Card": 0.18,
  Pair: 0.38,
  "Two Pair": 0.56,
  "Three of a Kind": 0.66,
  Straight: 0.76,
  Flush: 0.82,
  "Full House": 0.9,
  "Four of a Kind": 0.97,
  "Straight Flush": 1,
  "Royal Flush": 1,
};

const rankValue = (card: Card): number => "23456789TJQKA".indexOf(card[0]) + 2;

const preflopStrength = (cards: readonly Card[]): number => {
  const [first, second] = cards;
  const high = Math.max(rankValue(first), rankValue(second));
  const low = Math.min(rankValue(first), rankValue(second));
  const pair = high === low;
  const suited = first[1] === second[1];
  const gap = high - low;
  let score = high / 14 * 0.48 + low / 14 * 0.22;
  if (pair) score += 0.24 + high / 100;
  if (suited) score += 0.07;
  if (gap <= 1) score += 0.06;
  if (gap >= 4) score -= 0.08;
  return Math.max(0.05, Math.min(1, score));
};

const visibleStrength = (view: PlayerView): number => {
  const hero = view.players.find((player) => player.id === view.heroId)!;
  const cards = hero.holeCards ?? [];
  if (cards.length !== 2 || !view.hand) return 0;
  if (view.hand.board.length < 3) return preflopStrength(cards);
  const evaluated = evaluateHand([...cards, ...view.hand.board]);
  return CATEGORY_STRENGTH[evaluated.name] ?? 0.2;
};

const styleTuning: Record<BotStyle, { looseness: number; aggression: number }> = {
  tight: { looseness: -0.1, aggression: -0.08 },
  balanced: { looseness: 0, aggression: 0 },
  loose: { looseness: 0.11, aggression: -0.02 },
  aggressive: { looseness: 0.04, aggression: 0.16 },
};

const chooseRaise = (view: PlayerView, aggression: number, random: RandomSource): PlayerAction => {
  const legal = view.legalActions!;
  if (!legal.canRaise || legal.minRaiseTo === null) return legal.canCheck ? { type: "check" } : { type: "call" };
  const span = Math.max(0, legal.maxRaiseTo - legal.minRaiseTo);
  const fraction = Math.min(0.75, 0.12 + aggression + random.next() * 0.22);
  const target = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(legal.minRaiseTo + span * fraction)));
  if (target === legal.maxRaiseTo && random.next() < 0.3) return { type: "all-in" };
  return { type: "raise", to: target };
};

export const decideBotAction = (
  view: PlayerView,
  difficulty: BotDifficulty = "normal",
  style: BotStyle = "balanced",
  random: RandomSource = new CryptoRandomSource(),
): PlayerAction => {
  const legal = view.legalActions;
  if (!legal) throw new Error("The bot has no legal action context.");
  const tuning = styleTuning[style];
  let strength = visibleStrength(view);
  if (difficulty === "easy") strength += (random.next() - 0.5) * 0.38;
  if (difficulty === "hard") strength += 0.04;
  strength = Math.max(0, Math.min(1, strength + tuning.looseness));

  const potOdds = calculatePotOdds(legal.toCall, view.hand?.potTotal ?? 0);
  const callThreshold = difficulty === "easy" ? 0.36 : Math.max(0.2, potOdds + (difficulty === "hard" ? 0.04 : 0.09));
  const aggression = tuning.aggression + (difficulty === "hard" ? 0.1 : difficulty === "easy" ? -0.08 : 0);
  const bluff = random.next() < Math.max(0.02, 0.05 + aggression * 0.4);

  if (legal.canCheck) {
    if (legal.canRaise && (strength > 0.64 - aggression || bluff)) return chooseRaise(view, aggression, random);
    return { type: "check" };
  }
  if (legal.canRaise && (strength > 0.72 - aggression || (bluff && strength > 0.25))) {
    return chooseRaise(view, aggression, random);
  }
  if (legal.canCall && strength >= callThreshold) return { type: "call" };
  if (legal.canFold) return { type: "fold" };
  return { type: "all-in" };
};
