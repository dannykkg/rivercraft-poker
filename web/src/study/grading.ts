import type { PlayerAction } from "../domain/types";
import { actionKey, type Question, type StrategyReference } from "./model";
export const checkAnswer = (q: Question, answer: string): boolean => {
  if (typeof q.answer === "number") return answer.trim() !== "" && Number.isFinite(Number(answer)) && Math.abs(Number(answer) - q.answer) <= (q.tolerance ?? 0.1);
  if (q.selectCount) return answer.trim().split(/\s+/).sort().join(" ") === q.answer;
  return answer === q.answer;
};
export const validateReference = (value: unknown): StrategyReference => {
  if (!value || typeof value !== "object") throw new Error("参考格式无效。"); const r = value as StrategyReference;
  if (r.version !== 1 || [r.id, r.revision, r.source, r.license, r.context].some(x => typeof x !== "string" || !x.trim()) || typeof r.assumptions !== "string" || !["chips", "prize-equity"].includes(r.unit) || !Number.isFinite(r.errorBound) || r.errorBound < 0) throw new Error("参考需要来源、版本、许可、上下文、价值单位和误差。");
  if (!Array.isArray(r.actions) || !r.actions.length || r.actions.length > 50) throw new Error("参考动作集合无效。");
  const keys = new Set<string>(); let frequency = 0;
  for (const a of r.actions) { if (!a || !/^(fold|check|call|all-in|raise:[1-9][0-9]*)$/.test(a.key) || keys.has(a.key) || !Number.isFinite(a.frequency) || a.frequency < 0 || a.frequency > 1 || !Number.isFinite(a.ev)) throw new Error("参考动作、频率或收益无效。"); keys.add(a.key); frequency += a.frequency; }
  if (Math.abs(frequency - 1) > 1e-6) throw new Error("参考动作频率之和必须为 1。"); return structuredClone(r);
};
export const gradeReference = (reference: StrategyReference | undefined, context: string, action: PlayerAction) => {
  if (!reference || reference.context !== context) return { status: "ungraded", message: "无匹配参考，或局面／假设已变化。不生成专业分数。" };
  const selected = reference.actions.find(a => a.key === actionKey(action));
  if (!selected) return { status: "ungraded", message: "动作不在参考树中；不会自动替换为最近的下注尺度。" };
  const loss = Math.max(0, Math.max(...reference.actions.map(a => a.ev)) - selected.ev);
  return { status: loss <= 2 * reference.errorBound ? "close" : "graded", loss, frequency: selected.frequency, referenceId: reference.id, revision: reference.revision, message: loss <= 2 * reference.errorBound ? "收益差在误差界内，不严格区分对错；重复练习再看频率。" : `相对参考损失 ${loss.toFixed(3)} ${reference.unit}；仅针对这份参考的模型。` };
};
