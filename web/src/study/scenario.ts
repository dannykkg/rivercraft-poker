import { createDeck, shuffleDeck } from "../domain/cards";
import { beginNextHand, getLegalActions, submitAction } from "../domain/engine";
import { rehydrateTournament } from "../domain/reducer";
import { projectPlayerView } from "../domain/view";
import type { Card, GameConfig, GameEvent, GameState, PlayerAction, RandomSource } from "../domain/types";
import { uid, type HandRecord, type Scenario } from "./model";

export class SeededRandom implements RandomSource {
  constructor(private seed: number) {}
  next(): number { this.seed = (this.seed + 0x6d2b79f5) >>> 0; let x = this.seed; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; }
}
export const isCard = (card: unknown): card is Card => typeof card === "string" && /^[2-9TJQKA][cdhs]$/.test(card);
export const integer = (n: unknown, min = 0, max = 1e9): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
export const parseCards = (text: string): Card[] => {
  const cards = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!cards.every(isCard) || new Set(cards).size !== cards.length) throw new Error("牌格式应为 As Kh Td 9c，且不能重复。");
  return cards;
};
export const validAction = (value: unknown): value is PlayerAction => {
  if (!value || typeof value !== "object") return false; const a = value as PlayerAction;
  return ["fold", "check", "call", "all-in"].includes(a.type) || (a.type === "raise" && integer(a.to, 1));
};
export const validateScenario = (value: unknown): Scenario => {
  if (!value || typeof value !== "object") throw new Error("局面格式无效。"); const s = value as Scenario;
  if (s.version !== 1 || typeof s.id !== "string" || !s.id || typeof s.title !== "string" || s.title.length > 200 || !["cash", "tournament"].includes(s.mode)) throw new Error("局面名称、版本或模式无效。");
  if (!integer(s.seed, 0, 0xffffffff) || !integer(s.smallBlind, 1, 1e6) || !integer(s.bigBlind, s.smallBlind + 1, 1e6)) throw new Error("随机种子或盲注无效。");
  if (!Array.isArray(s.players) || s.players.length < 2 || s.players.length > 9 || !integer(s.dealerSeat, 0, s.players.length - 1)) throw new Error("人数或庄家座位无效。");
  const ids = new Set<string>(); const cards: Card[] = [];
  for (const p of s.players) {
    if (!p || typeof p.id !== "string" || !p.id || ["__proto__", "constructor", "prototype"].includes(p.id) || ids.has(p.id) || typeof p.name !== "string" || !integer(p.stack, s.bigBlind, 1e8)) throw new Error("座位标识、姓名或初始筹码无效。");
    ids.add(p.id); if (p.cards !== undefined) { if (!Array.isArray(p.cards) || p.cards.length !== 2) throw new Error("指定底牌时必须恰好两张。"); cards.push(...p.cards); }
  }
  if (!ids.has(s.heroId) || !Array.isArray(s.board) || ![0, 3, 4, 5].includes(s.board.length)) throw new Error("学习者或公共牌无效。");
  cards.push(...s.board); if (!cards.every(isCard) || new Set(cards).size !== cards.length) throw new Error("牌局存在无效牌或重复牌。");
  if (!Array.isArray(s.prefix) || s.prefix.length > 150 || s.prefix.some(p => !p || !ids.has(p.playerId) || !validAction(p.action)) || typeof s.assumptions !== "string") throw new Error("前序动作或假设无效。");
  return structuredClone(s);
};

/** Only constructs an initial state; all subsequent transitions use the production engine. */
export const compileScenario = (input: Scenario): GameState => {
  const s = validateScenario(input); const rng = new SeededRandom(s.seed);
  const reserved = new Set([...s.board, ...s.players.flatMap(p => p.cards ?? [])]);
  const pool = shuffleDeck(createDeck().filter(c => !reserved.has(c)), rng);
  const draw = (): Card => { const c = pool.pop(); if (!c) throw new Error("牌堆不足。"); return c; };
  const holes = s.players.map(p => p.cards ?? [draw(), draw()]);
  const order = s.players.map((_, i) => (s.dealerSeat + 1 + i) % s.players.length); const deck: Card[] = [];
  for (let round = 0; round < 2; round++) for (const seat of order) deck.push(holes[seat][round]);
  let index = 0;
  for (const count of [3, 1, 1]) { deck.push(draw()); for (let i = 0; i < count; i++) deck.push(s.board[index++] ?? draw()); }
  deck.push(...pool);
  const players = s.players.map((p, seat) => ({ id: p.id, name: p.name, seat, kind: p.id === s.heroId ? "human" as const : "bot" as const }));
  const startingStack = Math.max(...s.players.map(p => p.stack));
  const config: GameConfig = s.mode === "cash"
    ? { mode: "cash", players, startingStack, smallBlind: s.smallBlind, bigBlind: s.bigBlind, buyIn: startingStack, minBuyIn: 1, maxBuyIn: 1e8, botAutoRebuy: false }
    : { mode: "tournament", players, startingStack, blindLevels: [{ smallBlind: s.smallBlind, bigBlind: s.bigBlind, hands: Number.MAX_SAFE_INTEGER }] };
  const root: GameState = { id: uid("study"), status: "playing", config, players: players.map((p, i) => ({ ...p, stack: s.players[i].stack, eliminated: false })), handNumber: 0, blindLevelIndex: 0, dealerSeat: (s.dealerSeat - 1 + players.length) % players.length, hand: null, events: [],
    ...(s.mode === "cash" ? { cashSession: { startedAt: Date.now(), ledgers: Object.fromEntries(s.players.map(p => [p.id, { totalBuyIn: p.stack, rebuyCount: 0, potsWon: 0 }])) } } : {}) };
  let state = beginNextHand(root, rng, deck.reverse()).state;
  for (const [i, step] of s.prefix.entries()) { const r = submitAction(state, step.playerId, step.action); if (!r.ok) throw new Error(`第 ${i + 1} 个前序动作非法：${r.error.message}`); state = r.state; }
  return state;
};
export const exampleScenario = (street: "preflop" | "flop" | "turn" | "river" = "flop"): Scenario => {
  const prefix: Scenario["prefix"] = street === "preflop" ? [] : [{ playerId: "hero", action: { type: "raise", to: 60 } }, { playerId: "v", action: { type: "call" } }, { playerId: "v", action: { type: "check" } }];
  if (street === "turn" || street === "river") prefix.push({ playerId: "hero", action: { type: "check" } }, { playerId: "v", action: { type: "check" } });
  if (street === "river") prefix.push({ playerId: "hero", action: { type: "check" } }, { playerId: "v", action: { type: "check" } });
  return { version: 1, id: `heads-up-${street}`, title: "双人单加注底池", seed: 42, mode: "cash", smallBlind: 10, bigBlind: 20, dealerSeat: 0, heroId: "hero", players: [{ id: "hero", name: "你", stack: 2000, cards: ["As", "Kh"] }, { id: "v", name: "练习对手", stack: 2000 }], board: street === "preflop" ? [] : street === "flop" ? ["Ah", "9d", "4c"] : street === "turn" ? ["Ah", "9d", "4c", "2s"] : ["Ah", "9d", "4c", "2s", "7h"], prefix, assumptions: "无抽水；对手未知底牌由随机种子生成。不是标准策略答案。" };
};
const reindex = (events: GameEvent[], id: string): GameEvent[] => events.map((e, i) => ({ ...structuredClone(e), id: `${id}:${i + 1}`, sequence: i + 1 }));
export const recordHand = (state: GameState, heroId: string, source: HandRecord["source"], title?: string): HandRecord => {
  if (!state.hand) throw new Error("当前没有手牌。");
  const start = state.events.findIndex(e => e.type === "hand-started" && e.handNumber === state.handNumber);
  if (start < 0) throw new Error("牌谱缺少开始事件。");
  const id = `${state.id}:hand:${state.handNumber}`; const events = reindex(state.events.slice(start), id);
  return { version: 1, id, gameId: state.id, handNumber: state.handNumber, heroId, title: title ?? `第 ${state.handNumber} 手`, tags: [], starred: false, source, mode: state.config.mode, complete: state.hand.phase === "complete", createdAt: events[0].timestamp, updatedAt: Date.now(), events };
};
export const decisionPoints = (events: GameEvent[], heroId?: string): Array<{ sequence: number; state: GameState }> => events.flatMap((e, i) => {
  if (e.type !== "state-checkpoint") return []; const state = rehydrateTournament(events.slice(0, i + 1)); const legal = getLegalActions(state);
  return legal && (!heroId || legal.playerId === heroId) ? [{ sequence: e.sequence, state }] : [];
});
export const restoreDecision = (events: GameEvent[], sequence: number): GameState => {
  const found = decisionPoints(events).find(d => d.sequence === sequence); if (!found) throw new Error("只能从合法决策检查点继续，不能从显示回放帧继续。");
  return structuredClone(found.state);
};
export const forkHand = (record: HandRecord, sequence: number, resample: boolean, seed: number): GameState => {
  const state = restoreDecision(record.events, sequence); state.id = uid("branch");
  if (resample) {
    const hand = state.hand!; const hero = hand.players.find(p => p.playerId === record.heroId); if (!hero) throw new Error("学习者不存在。");
    const known = new Set([...hero.holeCards, ...hand.board]); const pool = shuffleDeck(createDeck().filter(c => !known.has(c)), new SeededRandom(seed));
    for (const p of hand.players) if (p.playerId !== record.heroId) p.holeCards = [pool.pop()!, pool.pop()!];
    // Marginalize unknown burn cards, then retain the original number of undealt cards.
    hand.deck = pool.slice(0, hand.deck.length);
    state.events = state.events.filter(e => e.type !== "state-checkpoint").map(e => { const { private: hidden, ...publicEvent } = e; return e.playerId === record.heroId && e.type === "hole-cards-dealt" ? { ...publicEvent, private: hidden } : publicEvent; });
  }
  const { events: _events, ...snapshot } = state;
  state.events = state.events.filter(e => e.type !== "state-checkpoint" || e.sequence !== sequence);
  state.events.push({ id: "pending", sequence: 0, timestamp: Date.now(), type: "state-checkpoint", public: { reason: resample ? "resampled-research-branch" : "original-research-branch" }, private: { snapshot: structuredClone(snapshot) } });
  state.events = reindex(state.events, state.id); return state;
};
/** Canonical scoring key deliberately excludes future/private opponent information. */
export const decisionContext = (state: GameState, heroId: string, assumptions: string): string => {
  const v = projectPlayerView(state, heroId);
  return JSON.stringify({ mode: v.mode, blinds: v.blindLevel, heroId, players: v.players.map(({ name: _name, ...p }) => p), hand: v.hand, history: state.events.filter(e => e.type === "player-acted" && e.handNumber === state.handNumber).map(e => ({ playerId: e.playerId, ...e.public })), assumptions });
};
