import type { Card, GameState, PlayerAction } from "../domain/types";
import { getLegalActions, submitAction } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import { parseRange } from "../study/math";
import { compileScenario, decisionPoints, forkHand, recordHand, SeededRandom } from "../study/scenario";
import { uid, type Scenario } from "../study/model";
import { CONTENT_VERSION, findCase, findDrill } from "./catalogue";
import { evaluateDecision } from "./feedback";
import { opponentAction } from "./policy";
import type { Mode, PracticeLaunch, Result, Scope, Session } from "./model";

/** Samples all active opponents jointly by rejection, so blockers cannot bias seat ordering. */
function sampledScenario(original: Scenario, range: string, seed: number): Scenario {
  const s = structuredClone(original); s.seed = seed >>> 0;
  const known = [...s.board, ...s.players.find(p => p.id === s.heroId)!.cards!];
  const folded = new Set(s.prefix.filter(p => p.action.type === "fold").map(p => p.playerId));
  const opponents = s.players.filter(p => p.id !== s.heroId && !folded.has(p.id));
  const choices = parseRange(range, known); const total = choices.reduce((n, c) => n + c.weight, 0); const rng = new SeededRandom(seed ^ 0x22334455);
  for (let trial = 0; trial < 5000; trial++) {
    const selected: Card[][] = [];
    for (const _p of opponents) {
      let target = rng.next() * total; let chosen = choices[choices.length - 1];
      for (const c of choices) { target -= c.weight; if (target < 0) { chosen = c; break; } }
      selected.push([...chosen.cards]);
    }
    const cards = [...known, ...selected.flat()]; if (new Set(cards).size !== cards.length) continue;
    opponents.forEach((p, i) => { p.cards = selected[i]; }); return s;
  }
  throw new Error("指定范围无法生成互不冲突的练习手牌，请更换配置。");
}
export function createSession(drillId: string, caseIndex: number, scope: Scope, mode: Mode, results: Result[], seed = crypto.getRandomValues(new Uint32Array(1))[0]): Session {
  const drill = findDrill(drillId); if (!drill) throw new Error("专项练习不存在。");
  const c = drill.cases[caseIndex % drill.cases.length]; if (!c) throw new Error("局面编号无效。");
  const state = compileScenario(sampledScenario(c.scenario, c.range, seed));
  if (getLegalActions(state)?.playerId !== "hero") throw new Error("课程起点没有轮到学习者。");
  const now = Date.now();
  return { schema: 1, contentVersion: CONTENT_VERSION, id: uid("practice"), drillId, caseId: c.id, family: c.family, title: drill.title, heroId: "hero", mode, scope, opponent: drill.opponent, seed, range: c.range, initial: structuredClone(state), state, startPhase: state.hand!.phase, decisions: [], hinted: false, assisted: false, seen: results.some(r => r.family === c.family), status: "acting", createdAt: now, updatedAt: now };
}
export function fromHand(launch: PracticeLaunch, mode: Mode = "review"): Session {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const state = forkHand(launch.hand, launch.sequence, true, seed);
  if (getLegalActions(state)?.playerId !== launch.hand.heroId) throw new Error("只能从学习者的决策点开始复练。");
  const now = Date.now();
  return { schema: 1, contentVersion: CONTENT_VERSION, id: uid("practice"), drillId: "personal", caseId: launch.id, family: `personal:${launch.hand.id}:${launch.sequence}`, title: "个人牌谱复练", heroId: launch.hand.heroId, mode, scope: "hand", opponent: "balanced", seed, range: "random", initial: structuredClone(state), state, startPhase: state.hand!.phase, decisions: [], hinted: false, assisted: false, seen: true, status: "acting", createdAt: now, updatedAt: now, sourceHandId: launch.hand.id, sourceSequence: launch.sequence };
}
export function finished(s: Session): boolean {
  const hero = s.state.hand?.players.find(p => p.playerId === s.heroId);
  return s.state.hand?.phase === "complete" || !!hero?.folded || (s.decisions.length > 0 && (s.scope === "spot" || (s.scope === "street" && s.state.hand?.phase !== s.startPhase)));
}
function advanceOpponents(s: Session): void {
  // Spot practice still shows any immediate replies up to the next hero decision.
  for (let n = 0; n < 256; n++) {
    const h = s.state.hand!; const hero = h.players.find(p => p.playerId === s.heroId)!;
    if (hero.folded || h.phase === "complete" || (s.scope === "street" && h.phase !== s.startPhase)) return;
    const l = getLegalActions(s.state); if (!l) throw new Error("牌局尚未结束但没有合法动作。");
    if (l.playerId === s.heroId) return;
    const seed = (s.seed ^ Math.imul(s.state.events.length, 0x9e3779b9) ^ Math.imul(l.seat + 1, 0x85ebca6b)) >>> 0;
    const action = opponentAction(projectPlayerView(s.state, l.playerId), s.opponent, seed);
    const result = submitAction(s.state, l.playerId, action); if (!result.ok) throw new Error(`陪练行动失败：${result.error.message}`);
    s.state = result.state;
  }
  throw new Error("陪练行动超过安全上限，不保存未完成的部分结果。");
}
export function playAction(source: Session, action: PlayerAction): Session {
  if (source.status !== "acting") throw new Error("请先继续练习，不要重复提交动作。");
  const result = submitAction(source.state, source.heroId, action);
  if (!result.ok) throw new Error(result.error.message);
  const s = structuredClone(source);
  const feedback = evaluateDecision(source, source.state, action);
  s.decisions.push({ id: `${s.id}:${s.decisions.length}`, sequence: source.state.events.at(-1)!.sequence, phase: source.state.hand!.phase, action, feedback, hinted: s.hinted, before: structuredClone(source.state) });
  s.state = result.state; s.assisted ||= s.hinted; s.hinted = false;
  advanceOpponents(s); s.updatedAt = Date.now();
  s.status = s.mode === "assessment" ? finished(s) ? "complete" : "acting" : "feedback";
  return s;
}
export const continueSession = (source: Session): Session => {
  if (source.status !== "feedback") return source;
  return { ...source, status: finished(source) ? "complete" : "acting", updatedAt: Date.now() };
};
export function resultOf(s: Session, prior: Result[] = []): Result {
  if (s.status !== "complete") throw new Error("训练还未结束。");
  const deviations = s.decisions.filter(d => d.feedback.verdict === "deviation").length;
  const mastered = prior.filter(r => r.id !== s.id && r.drillId === s.drillId && !r.deviations && !r.assisted).length;
  const days = deviations || s.assisted ? 1 : [1, 3, 7, 14][Math.min(mastered, 3)];
  return { id: s.id, contentVersion: s.contentVersion, drillId: s.drillId, caseId: s.caseId, family: s.family, mode: s.mode, scope: s.scope, assisted: s.assisted, seen: s.seen, createdAt: s.updatedAt, decisions: s.decisions.length, aligned: s.decisions.filter(d => d.feedback.verdict === "aligned").length, deviations, ungraded: s.decisions.filter(d => d.feedback.kind === "ungraded").length, mathLoss: s.decisions.reduce((n, d) => n + (d.feedback.evLoss ?? 0), 0), mathDecisions: s.decisions.filter(d => d.feedback.kind === "math").length, dueAt: s.updatedAt + days * 86400000, session: structuredClone(s) };
}
export function practiceHand(s: Session) {
  const h = recordHand(s.state, s.heroId, "lesson", `实战训练 · ${s.title}`);
  h.tags = ["实战训练", s.drillId, s.scope, s.mode]; return h;
}
export function practicePoint(s: Session, decisionIndex?: number) {
  const state = decisionIndex === undefined ? s.state : s.decisions[decisionIndex]?.before;
  if (!state) throw new Error("决策不存在。");
  const record = recordHand(state, s.heroId, "lesson", `实战训练 · ${s.title}`);
  const point = decisionPoints(record.events, s.heroId).at(-1);
  if (!point) throw new Error("该位置没有学习者决策点。");
  return { record, sequence: point.sequence, state: point.state };
}
export const initialHint = (s: Session): string => {
  const c = findCase(s.caseId);
  return c && s.decisions.length === 0 ? c.explanation : "先辨认当前成手与听牌，再看需要新增的成本、对手公开行动和本课对手模型。不要用后来发出的牌倒推现在的选择。";
};
