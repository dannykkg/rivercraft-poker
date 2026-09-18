import { createDeck, shuffleDeck } from "../domain/cards";
import { selectWinningIndexes } from "../domain/evaluator";
import type { Card, RandomSource } from "../domain/types";
import { isCard, SeededRandom } from "./scenario";

export interface Combo { cards: [Card, Card]; weight: number }
const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
export const rangeMatrix = (): string[][] => [...RANKS].reverse().map((a, i, ranks) => ranks.map((b, j) => i === j ? a + b : i < j ? a + b + "s" : b + a + "o"));
/** Explicit combos, classes, pair/non-pair '+' and weights. Duplicate classes are errors. */
export const parseRange = (text: string, blocked: Card[] = []): Combo[] => {
  if (typeof text !== "string" || text.length > 20000) throw new Error("范围文本无效或过长。");
  const result = new Map<string, Combo>(); const used = new Set(blocked);
  const add = (a: Card, b: Card, weight: number) => {
    if (a === b) throw new Error("一个组合不能含有相同的牌。");
    if (used.has(a) || used.has(b)) return;
    const key = [a, b].sort().join(""); if (result.has(key)) throw new Error(`范围重复包含 ${key}。`);
    result.set(key, { cards: [a, b], weight });
  };
  const expand = (hand: string, weight: number) => {
    if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/.test(hand)) { add(hand.slice(0, 2) as Card, hand.slice(2) as Card, weight); return; }
    if (!/^[2-9TJQKA]{2}[so]?$/.test(hand)) throw new Error(`无法解析范围 ${hand}。支持 AsKh、QQ+、ATs+、AKo、random。`);
    const [a, b, suit] = hand;
    if (a === b && suit) throw new Error("对子不使用 s/o 后缀。");
    for (const x of SUITS) for (const y of SUITS) {
      if (a === b && x >= y) continue;
      if ((suit === "s" && x !== y) || (suit === "o" && x === y)) continue;
      add(`${a}${x}` as Card, `${b}${y}` as Card, weight);
    }
  };
  for (const token of text.trim().split(/[\s,]+/).filter(Boolean)) {
    const parts = token.split(":"); const hand = parts[0]; const weight = parts.length === 1 ? 1 : Number(parts[1]);
    if (parts.length > 2 || !Number.isFinite(weight) || weight <= 0 || weight > 1) throw new Error("组合权重必须大于 0 且不超过 1。");
    if (hand === "random") { const deck = createDeck(); for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) add(deck[i], deck[j], weight); }
    else if (hand.endsWith("+")) {
      const base = hand.slice(0, -1); if (!/^[2-9TJQKA]{2}[so]?$/.test(base)) throw new Error("+ 范围格式无效。");
      if (base[0] === base[1]) { if (base.length !== 2) throw new Error("对子不使用花色后缀。"); for (let i = RANKS.indexOf(base[0]); i < 13; i++) expand(RANKS[i] + RANKS[i], weight); }
      else { const hi = RANKS.indexOf(base[0]), lo = RANKS.indexOf(base[1]); if (hi <= lo) throw new Error("+ 范围先写高牌，例如 ATs+。"); for (let i = lo; i < hi; i++) expand(base[0] + RANKS[i] + (base[2] ?? ""), weight); }
    } else expand(hand, weight);
  }
  if (!result.size) throw new Error("移除已知牌后没有可用的范围组合。"); return [...result.values()];
};
const picker = (range: Combo[]) => {
  const cumulative: number[] = []; let total = 0;
  range.forEach(c => { total += c.weight; cumulative.push(total); });
  return (rng: RandomSource): Card[] => { const target = rng.next() * total; let lo = 0, hi = range.length - 1; while (lo < hi) { const mid = (lo + hi) >>> 1; if (cumulative[mid] > target) hi = mid; else lo = mid + 1; } return range[lo].cards; };
};
const share = (hero: Card[], opponents: Card[][], board: Card[]): number => {
  const winners = selectWinningIndexes([hero, ...opponents].map(h => [...h, ...board])); return winners.includes(0) ? 1 / winners.length : 0;
};
export interface EquityInput { hero: Card[]; board: Card[]; ranges: string[]; samples: number; seed: number }
export interface EquityResult { equity: number; win: number; tie: number; samples: number; margin95: number; exact: boolean; assumptions: string }
export const rangeEquity = (input: EquityInput): EquityResult => {
  const known = [...input.hero, ...input.board];
  if (input.hero.length !== 2 || ![0, 3, 4, 5].includes(input.board.length) || !known.every(isCard) || new Set(known).size !== known.length) throw new Error("已知牌无效。");
  if (input.ranges.length < 1 || input.ranges.length > 8 || !Number.isInteger(input.samples) || input.samples < 50 || input.samples > 50000) throw new Error("对手须为 1–8 人，采样数须为 50–50000。");
  const ranges = input.ranges.map(r => parseRange(r, known)); let equity = 0, win = 0, tie = 0;
  const assumptions = "输入范围的组合权重；未知牌均匀发出；仅计算摊牌份额，不模拟后续下注，不代表行动 EV。";
  if (input.board.length === 5 && ranges.length === 1) {
    const total = ranges[0].reduce((n, c) => n + c.weight, 0);
    for (const c of ranges[0]) { const s = share(input.hero, [c.cards], input.board); equity += c.weight * s / total; if (s === 1) win += c.weight / total; else if (s > 0) tie += c.weight / total; }
    return { equity, win, tie, samples: ranges[0].length, margin95: 0, exact: true, assumptions };
  }
  const rng = new SeededRandom(input.seed); const draw = ranges.map(picker); let accepted = 0;
  // Independent weighted draws followed by joint collision rejection preserve the joint distribution.
  for (let trial = 0; accepted < input.samples && trial < input.samples * 100; trial++) {
    const hands = draw.map(p => p(rng)); const used = new Set([...known, ...hands.flat()]); if (used.size !== known.length + hands.length * 2) continue;
    const deck = shuffleDeck(createDeck().filter(c => !used.has(c)), rng); const board = [...input.board]; while (board.length < 5) board.push(deck.pop()!);
    const s = share(input.hero, hands, board); equity += s; if (s === 1) win++; else if (s > 0) tie++; accepted++;
  }
  if (accepted !== input.samples) throw new Error("范围间冲突过多，无法完成指定采样；没有返回不完整结果。");
  return { equity: equity / accepted, win: win / accepted, tie: tie / accepted, samples: accepted, margin95: Math.min(1, Math.sqrt(Math.log(40) / (2 * accepted))), exact: false, assumptions };
};
export const requiredEquity = (call: number, eligiblePot: number): number => {
  if (![call, eligiblePot].every(n => Number.isFinite(n) && n >= 0)) throw new Error("跟注成本和可争夺底池必须非负。"); return call === 0 ? 0 : call / (eligiblePot + call);
};
export const terminalCallEV = (equity: number, call: number, eligiblePot: number): number => {
  if (!Number.isFinite(equity) || equity < 0 || equity > 1) throw new Error("权益须在 0–1 之间。"); requiredEquity(call, eligiblePot); return equity * (eligiblePot + call) - call;
};
/** Exact ICM over remaining-player bitmasks; already eliminated players must be removed. */
export const icmEquities = (stacks: number[], payouts: number[]): number[] => {
  const n = stacks.length;
  if (n < 2 || n > 9 || stacks.some(s => !Number.isFinite(s) || s <= 0)) throw new Error("需要 2–9 个正筹码量，先移除已淘汰玩家。");
  if (!payouts.length || payouts.length > n || payouts.some((p, i) => !Number.isFinite(p) || p < 0 || (i > 0 && p > payouts[i - 1]))) throw new Error("奖励必须非负并按名次递减。");
  const result = stacks.map(() => 0); const probability = new Float64Array(1 << n); probability[(1 << n) - 1] = 1;
  for (let mask = (1 << n) - 1; mask > 0; mask--) {
    const remaining = stacks.map((_, i) => i).filter(i => mask & 1 << i); const total = remaining.reduce((s, i) => s + stacks[i], 0); const prize = payouts[n - remaining.length] ?? 0;
    for (const i of remaining) { const p = probability[mask] * stacks[i] / total; result[i] += p * prize; probability[mask ^ 1 << i] += p; }
  } return result;
};
export interface RiverInput { board: Card[]; bettorRange: string; defenderRange: string; pot: number; bet: number; iterations: number; lockedCall?: number }
export interface RiverResult {
  algorithm: string; value: number; lower: number; upper: number; gap: number; pairs: number; iterations: number;
  bettor: Array<{ hand: string; bet: number }>; defender: Array<{ hand: string; call: number }>; assumptions: string;
}
/** Finite zero-sum river game: check->showdown, bet->fold/call. No raises, no rake. */
export const solveRiver = (input: RiverInput): RiverResult => {
  if (input.board.length !== 5 || !input.board.every(isCard) || new Set(input.board).size !== 5) throw new Error("河牌求解需要五张不同的公共牌。");
  if (![input.pot, input.bet].every(n => Number.isFinite(n) && n > 0 && n <= 1e8) || !Number.isInteger(input.iterations) || input.iterations < 100 || input.iterations > 10000) throw new Error("底池、下注或迭代数无效（100–10000 次）。");
  if (input.lockedCall !== undefined && (!Number.isFinite(input.lockedCall) || input.lockedCall < 0 || input.lockedCall > 1)) throw new Error("锁定跟注频率须为 0–1。");
  const h = parseRange(input.bettorRange, input.board), v = parseRange(input.defenderRange, input.board);
  if (h.length * v.length > 4096) throw new Error("内置求解器最多处理 4096 个组合对，请缩小范围。");
  const pairs: Array<{ h: number; v: number; weight: number; check: number; call: number }> = [];
  h.forEach((a, i) => v.forEach((b, j) => { if (a.cards.some(c => b.cards.includes(c))) return; const e = share(a.cards, [b.cards], input.board); pairs.push({ h: i, v: j, weight: a.weight * b.weight, check: e * input.pot, call: e * (input.pot + 2 * input.bet) - input.bet }); }));
  const total = pairs.reduce((s, p) => s + p.weight, 0); if (!total) throw new Error("没有互不冲突的私牌组合对。"); pairs.forEach(p => p.weight /= total);
  const hr = h.map(() => [0, 0]), vr = v.map(() => [0, 0]); const ha = h.map(() => 0), va = v.map(() => 0); let weight = 0;
  const prob = (r: number[]) => r[0] + r[1] > 0 ? r[1] / (r[0] + r[1]) : 0.5;
  for (let t = 1; t <= input.iterations; t++) {
    const hs = hr.map(prob), vs = vr.map(r => input.lockedCall ?? prob(r)); const hd = h.map(() => [0, 0]), vd = v.map(() => [0, 0]);
    for (const p of pairs) {
      const bet = (1 - vs[p.v]) * input.pot + vs[p.v] * p.call; const value = (1 - hs[p.h]) * p.check + hs[p.h] * bet;
      hd[p.h][0] += p.weight * (p.check - value); hd[p.h][1] += p.weight * (bet - value);
      vd[p.v][0] += p.weight * hs[p.h] * (bet - input.pot); vd[p.v][1] += p.weight * hs[p.h] * (bet - p.call);
    }
    hr.forEach((r, i) => { r[0] = Math.max(0, r[0] + hd[i][0]); r[1] = Math.max(0, r[1] + hd[i][1]); ha[i] += t * hs[i]; });
    vr.forEach((r, i) => { r[0] = Math.max(0, r[0] + vd[i][0]); r[1] = Math.max(0, r[1] + vd[i][1]); va[i] += t * vs[i]; }); weight += t;
  }
  const hs = ha.map(p => p / weight), vs = va.map(p => p / weight); const hb = h.map(() => [0, 0]), vb = v.map(() => [0, 0]); let value = 0;
  for (const p of pairs) {
    const bet = (1 - vs[p.v]) * input.pot + vs[p.v] * p.call;
    value += p.weight * ((1 - hs[p.h]) * p.check + hs[p.h] * bet);
    hb[p.h][0] += p.weight * p.check; hb[p.h][1] += p.weight * bet;
    vb[p.v][0] += p.weight * ((1 - hs[p.h]) * p.check + hs[p.h] * input.pot);
    vb[p.v][1] += p.weight * ((1 - hs[p.h]) * p.check + hs[p.h] * p.call);
  }
  const upper = hb.reduce((s, a) => s + Math.max(...a), 0), lower = input.lockedCall === undefined ? vb.reduce((s, a) => s + Math.min(...a), 0) : value;
  return { algorithm: "finite-river-cfr-plus-v1", value, lower, upper, gap: Math.max(0, upper - lower), pairs: pairs.length, iterations: input.iterations,
    bettor: h.map((c, i) => ({ hand: c.cards.join(""), bet: hs[i] })), defender: v.map((c, i) => ({ hand: c.cards.join(""), call: vs[i] })),
    assumptions: input.lockedCall === undefined ? "双人有限河牌子博弈；过牌直接摊牌，下注后仅能弃牌或跟注；无加注、抽水或后续行动。界为该模型平均策略的精确最佳回应界，不代表完整 NLHE 均衡。" : "对手跟注频率被锁定。差距是针对该固定假设的回应差距，不是双方自由调整的均衡证书。" };
};
