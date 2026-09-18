import { getLegalActions } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import type { GameState, PlayerAction } from "../domain/types";
import { decisionContext } from "../study/scenario";
import { rangeEquity } from "../study/math";
import { findCase, findDrill, CONTENT_VERSION } from "./catalogue";
import { visibleFeatures } from "./policy";
import type { Feedback, Session } from "./model";

const labels = { fold: "弃牌", check: "过牌", call: "跟注", small: "小尺度下注／加注", large: "较大尺度下注／加注" };
export function actionLabel(action: PlayerAction): string {
  return action.type === "raise" ? `加注到 ${action.to}` : action.type === "all-in" ? "全下" : labels[action.type];
}
function actionClass(state: GameState, action: PlayerAction): keyof typeof labels {
  if (action.type !== "raise" && action.type !== "all-in") return action.type;
  const l = getLegalActions(state)!; const hand = state.hand!;
  const actor = hand.players.find(p => p.playerId === l.playerId)!;
  const to = action.type === "all-in" ? l.maxRaiseTo : action.to;
  // Equivalent full-stack calls are calls, not strategic raises.
  if (to <= hand.currentBet) return "call";
  if (hand.phase === "preflop") return hand.currentBet <= (state.config.mode === "cash" ? state.config.bigBlind : state.config.blindLevels[state.blindLevelIndex].bigBlind) && to <= 60 ? "small" : "large";
  const ratio = (to - actor.streetContribution - l.callAmount) / Math.max(1, hand.players.reduce((n, p) => n + p.totalContribution, 0) + l.callAmount);
  return ratio <= 0.5 ? "small" : "large";
}
/** Grades only with information available BEFORE the selected action. */
export function evaluateDecision(session: Session, state: GameState, action: PlayerAction): Feedback {
  const l = getLegalActions(state); if (!l || l.playerId !== session.heroId) throw new Error("不是学习者的决策点。");
  const question = findCase(session.caseId); const drill = findDrill(session.drillId);
  const first = session.decisions.length === 0;
  const neutral: Feedback = { kind: "ungraded", verdict: "ungraded", title: "自主复盘，不计策略分", explanation: "此节点没有与局面及对手假设匹配的评分参考。保留你的实际选择，不由输赢倒推对错。", tags: [], sourceIds: ["author"], reference: CONTENT_VERSION, recommended: [] };
  if (session.sourceHandId || session.contentVersion !== CONTENT_VERSION) return neutral;
  if (first && decisionContext(state, session.heroId, session.range) !== decisionContext(session.initial, session.heroId, session.range)) return { ...neutral, explanation: "局面已偏离课程起点，不复用原参考。" };
  if (first && question?.terminal && state.hand?.phase === "river" && state.hand.players.filter(p => !p.folded).length === 2 && l.canCall) {
    const cls = actionClass(state, action);
    if (cls !== "call" && cls !== "fold") return { ...neutral, explanation: "此题精确模型只比较跟注与弃牌。加注需要对手的继续范围与回应策略，不会用跟注EV替代。" };
    const hero = state.hand.players.find(p => p.playerId === session.heroId)!;
    const equity = rangeEquity({ hero: [...hero.holeCards], board: [...state.hand.board], ranges: [session.range], samples: 100, seed: 1 }).equity;
    const eligible = hero.totalContribution + l.callAmount;
    const potAfter = state.hand.players.reduce((sum, p) => sum + Math.min(p.totalContribution, eligible), 0) + l.callAmount;
    const ev = equity * potAfter - l.callAmount;
    const selectedEV = cls === "call" ? ev : 0; const evLoss = Math.max(0, ev) - selectedEV;
    return { kind: "math", verdict: evLoss < 1e-8 ? "aligned" : "deviation", title: evLoss < 1e-8 ? "符合终局数学比较" : "跟注／弃牌比较存在收益损失", explanation: `指定河牌下注范围下权益 ${(equity * 100).toFixed(2)}%，跟注 ${l.callAmount}，可争夺的跟注后底池 ${potAfter}。EV(跟注)=${ev.toFixed(2)}，EV(弃牌)=0。已投入筹码不再计作本决策成本；只比较这两个动作，不声称加注不可能更优。`, tags: evLoss > 1e-8 ? ["terminal-ev", "pot-odds"] : [], sourceIds: ["terminal"], reference: `${CONTENT_VERSION}:${session.caseId}:${session.range}`, recommended: [ev >= 0 ? "跟注" : "弃牌"], equity, threshold: l.callAmount / potAfter, evLoss, unit: "chips" };
  }
  if (!drill || !question) return neutral;
  const view = projectPlayerView(state, session.heroId); const f = visibleFeatures(view);
  let preferred: Array<keyof typeof labels> = first ? [...question.preferred] : l.canCheck ? (f.strength > 0.8 ? ["small", "large"] : f.draw ? ["check", "small"] : ["check"]) : (f.strength > 0.8 ? ["call", "large"] : f.strength >= 0.45 || f.draw ? ["call"] : ["fold"]);
  if (drill.courseId === "A6" && l.canCheck) {
    if (session.opponent === "caller" && f.strength < 0.3) preferred = ["check"];
    if (session.opponent === "tight" && f.strength < 0.3) preferred = ["check", "small"];
  }
  preferred = preferred.filter(p => p === "fold" ? l.canFold : p === "check" ? l.canCheck : p === "call" ? l.canCall : l.canRaise);
  if (!preferred.length) return neutral;
  const cls = actionClass(state, action); const aligned = preferred.includes(cls);
  let validSmallSize = true;
  if (action.type === "raise" || action.type === "all-in") {
    const to = action.type === "all-in" ? l.maxRaiseTo : action.to;
    if (cls !== "call") {
      const mine = state.hand!.players.find(p => p.playerId === session.heroId)!;
      const pot = state.hand!.players.reduce((n, p) => n + p.totalContribution, 0);
      const ratio = (to - mine.streetContribution - l.callAmount) / Math.max(1, pot + l.callAmount);
      const bb = state.config.mode === "cash" ? state.config.bigBlind : state.config.blindLevels[state.blindLevelIndex].bigBlind;
      validSmallSize = state.hand!.phase === "preflop" ? (state.hand!.currentBet <= bb ? to >= 2.5 * bb && to <= 3 * bb : to >= 2.2 * state.hand!.currentBet && to <= 4 * state.hand!.currentBet) : (ratio >= 0.25 && ratio <= 1.05) || to === l.minRaiseTo;
    }
  }
  const verdict = aligned && validSmallSize ? "aligned" : cls === "small" && preferred.includes("large") ? "discuss" : "deviation";
  return { kind: "teaching", verdict, title: verdict === "aligned" ? "符合本课教学计划" : verdict === "discuss" ? "尺度值得比较" : "偏离本课教学计划", explanation: `${first ? question.explanation : `这是新的${state.hand!.phase}决策点。后续指导仅按当前可见成手、听牌与行动成本生成简化建议；不会沿用起点答案，也未给出精确EV。`} 你的选择：${actionLabel(action)}。${!validSmallSize ? "这个尺度超出本课的简化计划。合法不等于合适；本课开池2.5–3BB，再加注约2.2–4倍，翻牌后以约1/3至满池为教学尺度。" : ""} 非唯一最优结论，合法偏离路线仍可继续。`, tags: verdict === "deviation" ? drill.foundations.slice(0, 2) : [], sourceIds: drill.sourceIds, reference: `${CONTENT_VERSION}:${first ? question.id : "continuation-policy-v1"}`, recommended: preferred.map(x => labels[x]) };
}
