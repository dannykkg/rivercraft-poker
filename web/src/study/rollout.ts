import { decideBotAction } from "../bots/bot";
import { getLegalActions, submitAction } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import type { GameState, PlayerAction } from "../domain/types";
import { actionKey, type HandRecord } from "./model";
import { decisionPoints, forkHand, integer, validAction, SeededRandom } from "./scenario";
import { validateHand } from "./storage";

export interface RolloutInput { record: HandRecord; sequence: number; actions: PlayerAction[]; trials: number; seed: number }
export interface RolloutResult {
  version: 1; model: string; seed: number; trials: number; unit: "chips"; assumptions: string;
  actions: Array<{ action: PlayerAction; mean: number; standardError: number; lower95: number; upper95: number }>;
}
export const candidateActions = (state: GameState, heroId: string): PlayerAction[] => {
  const legal = getLegalActions(state); if (!legal || legal.playerId !== heroId) return [];
  const actions: PlayerAction[] = [];
  if (legal.canFold) actions.push({ type: "fold" });
  if (legal.canCheck) actions.push({ type: "check" });
  if (legal.canCall) actions.push({ type: "call" });
  if (legal.canRaise && legal.minRaiseTo !== null) {
    const committed = state.hand!.players.find(p => p.playerId === heroId)!.streetContribution;
    const pot = state.hand!.players.reduce((sum, p) => sum + p.totalContribution, 0);
    const targets = new Set([legal.minRaiseTo, Math.max(legal.minRaiseTo, committed + legal.callAmount + Math.round((pot + legal.callAmount) / 2)), Math.max(legal.minRaiseTo, committed + legal.callAmount + pot + legal.callAmount)]);
    for (const to of targets) if (to < legal.maxRaiseTo) actions.push({ type: "raise", to });
  }
  // A short all-in call is already represented by call; do not duplicate aliases.
  if (legal.canAllIn && (legal.canRaise || !legal.canCall)) actions.push({ type: "all-in" });
  return actions.slice(0, 6);
};
const finish = (initial: GameState, heroId: string, action: PlayerAction, seed: number): number => {
  const baseline = initial.players.find(p => p.id === heroId)!.stack;
  const first = submitAction(initial, heroId, action); if (!first.ok) throw new Error(first.error.message);
  let state = first.state; const rng = new SeededRandom(seed);
  for (let step = 0; step < 256; step++) {
    const hero = state.hand!.players.find(p => p.playerId === heroId)!;
    if (hero.folded || state.hand!.phase === "complete") return state.players.find(p => p.id === heroId)!.stack - baseline;
    const legal = getLegalActions(state); if (!legal) throw new Error("模拟未结束但无法取得合法动作。");
    // Every continuation seat, including the learner, uses the declared fixed heuristic policy.
    const next = decideBotAction(projectPlayerView(state, legal.playerId), "normal", "balanced", rng);
    const result = submitAction(state, legal.playerId, next); if (!result.ok) throw new Error(`模拟策略提交非法动作：${result.error.message}`);
    state = result.state;
  }
  throw new Error("模拟行动超过安全上限，未返回部分或偏置样本。");
};
/** Paired unknown-card samples; explicitly a policy evaluation, not GTO or a strategy oracle. */
export const compareActions = (input: RolloutInput, progress?: (completed: number) => void): RolloutResult => {
  const record = validateHand(input.record);
  if (!integer(input.trials, 10, 1000) || !integer(input.seed, 0, 0xffffffff)) throw new Error("模拟次数须为 10–1000，种子须为 32 位非负整数。");
  if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > 6 || !input.actions.every(validAction) || new Set(input.actions.map(actionKey)).size !== input.actions.length) throw new Error("需要 1–6 个不同的合法候选动作。");
  const point = decisionPoints(record.events, record.heroId).find(p => p.sequence === input.sequence);
  if (!point) throw new Error("必须选择学习者行动前的决策点。");
  for (const action of input.actions) { const result = submitAction(point.state, record.heroId, action); if (!result.ok) throw new Error(result.error.message); }
  const totalChips = point.state.players.reduce((n, p) => n + p.stack, 0) + point.state.hand!.players.reduce((n, p) => n + p.totalContribution, 0);
  const sums = input.actions.map(() => 0), squares = input.actions.map(() => 0);
  for (let n = 0; n < input.trials; n++) {
    const sampleSeed = (input.seed + Math.imul(n + 1, 0x9e3779b9)) >>> 0;
    const sample = forkHand(record, input.sequence, true, sampleSeed);
    input.actions.forEach((action, i) => {
      const value = finish(sample, record.heroId, action, sampleSeed ^ 0x31415926);
      sums[i] += value; squares[i] += value * value;
    });
    if ((n + 1) % 10 === 0 || n + 1 === input.trials) progress?.(n + 1);
  }
  // Hoeffding + union bound across the requested actions; intentionally conservative.
  const margin = totalChips * Math.sqrt(Math.log(2 * input.actions.length / 0.05) / (2 * input.trials));
  return { version: 1, model: "rivercraft-fixed-policy-rollout-v1", seed: input.seed, trials: input.trials, unit: "chips",
    assumptions: "只保留学习者当时的底牌和公共牌；所有未知底牌与后续牌均匀抽样，不使用历史真实底牌。每个候选动作使用共同的未知牌样本；后续所有座位均由普通／均衡算法机器人接管。收益是相对本决策点的筹码变化。95% 区间为覆盖全部候选动作的保守采样界；不包含对手策略假设错误，不是 GTO 或真实对手收益预测。",
    actions: input.actions.map((action, i) => { const mean = sums[i] / input.trials; const variance = Math.max(0, (squares[i] - sums[i] * sums[i] / input.trials) / (input.trials - 1)); return { action, mean, standardError: Math.sqrt(variance / input.trials), lower95: mean - margin, upper95: mean + margin }; }) };
};
