import { evaluateHand } from "../domain/evaluator";
import type { PlayerAction, PlayerView } from "../domain/types";
import { SeededRandom } from "../study/scenario";
import type { Opponent } from "./model";

/** Deliberately accepts PlayerView, never GameState or an opponent's hidden cards. */
export function visibleFeatures(view: PlayerView) {
  const cards = view.players.find(p => p.id === view.heroId)?.holeCards ?? [];
  const board = view.hand?.board ?? [];
  const rank = (c: string) => "23456789TJQKA".indexOf(c[0]) + 2;
  const pair = cards.length === 2 && cards[0][0] === cards[1][0];
  const suited = cards.length === 2 && cards[0][1] === cards[1][1];
  if (board.length < 3) {
    const high = Math.max(0, ...cards.map(rank)), low = Math.min(...cards.map(rank));
    return { strength: pair ? 0.58 + high / 40 : (high + low) / 42 + (suited ? 0.08 : 0), draw: false, name: pair ? "口袋对子" : suited ? "同花起手牌" : "非同花起手牌" };
  }
  const name = evaluateHand([...cards, ...board]).name;
  const all = [...cards, ...board];
  const flushDraw = board.length < 5 && cards.some(c => all.filter(x => x[1] === c[1]).length === 4);
  const ranks = new Set(all.map(rank)); if (ranks.has(14)) ranks.add(1);
  const straightDraw = board.length < 5 && Array.from({ length: 10 }, (_, n) => n + 1).some(n => Array.from({ length: 5 }, (_, i) => n + i).filter(r => ranks.has(r)).length === 4 && cards.some(c => rank(c) >= n && rank(c) <= n + 4));
  const ownPairRank = Math.max(pair ? rank(cards[0]) : 0, ...cards.filter(c => board.some(b => b[0] === c[0])).map(rank), 0);
  const top = Math.max(...board.map(rank));
  // Board-only made hands are not treated as exclusive private strength.
  const boardName = board.length === 5 ? evaluateHand(board).name : undefined;
  const made = ({ "High Card": 0.1, Pair: ownPairRank >= top ? 0.67 : ownPairRank ? 0.4 : 0.18, "Two Pair": 0.72, "Three of a Kind": 0.8, Straight: 0.86, Flush: 0.89, "Full House": 0.95, "Four of a Kind": 0.98, "Straight Flush": 1, "Royal Flush": 1 } as Record<string, number>)[name] ?? 0.2;
  return { strength: boardName === name ? Math.min(made, 0.5) : made, draw: flushDraw || straightDraw, name };
}
export function raiseByPot(view: PlayerView, fraction: number): PlayerAction | undefined {
  const legal = view.legalActions;
  if (!legal?.canRaise || legal.minRaiseTo === null || !view.hand) return undefined;
  const hero = view.players.find(p => p.id === view.heroId)!;
  const to = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, (hero.streetContribution ?? 0) + legal.callAmount + Math.round((view.hand.potTotal + legal.callAmount) * fraction)));
  return { type: "raise", to };
}
export function opponentAction(view: PlayerView, model: Opponent, seed: number): PlayerAction {
  const l = view.legalActions; if (!l || !view.hand) throw new Error("陪练缺少合法行动视图。");
  const rng = new SeededRandom(seed); const f = visibleFeatures(view);
  const aggression = model === "pressure" ? 0.2 : model === "caller" ? -0.18 : 0;
  const raise = raiseByPot(view, model === "pressure" ? 0.75 : 0.5);
  if (l.canCheck) {
    if (raise && (f.strength > 0.72 - aggression || (f.draw && rng.next() < 0.3 + aggression) || rng.next() < Math.max(0.02, 0.06 + aggression))) return raise;
    return { type: "check" };
  }
  const price = l.callAmount / Math.max(1, view.hand.potTotal + l.callAmount);
  if (raise && f.strength > 0.88 - aggression / 2 && rng.next() < 0.45 + aggression) return raise;
  const threshold = model === "caller" ? 0.12 : model === "tight" ? 0.52 : model === "pressure" ? 0.3 : 0.4;
  if (l.canCall && (f.strength >= threshold + price * 0.35 || (f.draw && price < 0.35))) return { type: "call" };
  if (l.canFold) return { type: "fold" };
  return l.canCheck ? { type: "check" } : { type: "call" };
}
