import { PREFLOP_BASELINES } from "../../study/curriculum";
import { parseRange, rangeMatrix } from "../../study/math";

export const WORKSHOP_VERSION = "range-frequency-2026.09-v1";
export const HAND_CLASSES = rangeMatrix().flat();
const classes = new Set(HAND_CLASSES);
const ranks = "23456789TJQKA";
export type WorkshopAction = "pass" | "commit";
export interface RangeTask {
  id: string; kind: "range"; title: string; context: string; target: string;
  source: string; limitation: string;
}
export interface FrequencyTask {
  id: string; kind: "frequency"; title: string; pot: number; bet: number;
  values: number; bluffs: number; role: "bluffer" | "catcher";
}
export type WorkshopTask = RangeTask | FrequencyTask;
const examples = [
  { pot: 100, bet: 50, values: 12, bluffs: 8 },
  { pot: 120, bet: 120, values: 9, bluffs: 12 },
  { pot: 150, bet: 50, values: 8, bluffs: 12 },
  { pot: 200, bet: 100, values: 10, bluffs: 10 },
];
export const WORKSHOP_TASKS: WorkshopTask[] = [
  ...PREFLOP_BASELINES.map((baseline, i): RangeTask => ({
    id: `core-range-${i}`, kind: "range", title: `${baseline.position} · 核心范围重建`,
    context: baseline.context, target: baseline.range, source: "原基础课程 PREFLOP_BASELINES（原文及进度不变）",
    limitation: `${baseline.label}。本练习只检查指定范围的重建，不评价完整实战开池策略。`,
  })),
  ...examples.flatMap((configuration, i) => (["bluffer", "catcher"] as const).map((role): FrequencyTask => ({
    ...configuration, id: `polarized-${i}-${role}`, kind: "frequency", role,
    title: `模型 ${i + 1} · ${role === "bluffer" ? "弱牌诈唬频率" : "抓诈跟注频率"}`,
  }))),
];
export function taskById(id: string): WorkshopTask {
  const task = WORKSHOP_TASKS.find(item => item.id === id);
  if (!task) throw new Error("找不到这个专项版本，未覆盖原进度。");
  return task;
}
export function comboCount(hand: string): number {
  if (!classes.has(hand)) throw new Error("无效的起手牌类别。");
  return hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
}
export function rangeClasses(notation: string): string[] {
  const result = new Map<string, number>();
  for (const combo of parseRange(notation)) {
    if (combo.weight !== 1) throw new Error("此矩阵练习只支持整类手牌，不支持混合权重。");
    const [a, b] = [...combo.cards].sort((x, y) => ranks.indexOf(y[0]) - ranks.indexOf(x[0]));
    const key = a[0] === b[0] ? a[0] + b[0] : a[0] + b[0] + (a[1] === b[1] ? "s" : "o");
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  for (const [hand, count] of result) if (count !== comboCount(hand)) throw new Error("169格表示整类组合；单一花色组合请使用实验室范围工具。");
  return HAND_CLASSES.filter(hand => result.has(hand));
}
export function gradeRange(task: RangeTask, selected: string[]) {
  if (new Set(selected).size !== selected.length || selected.some(hand => !classes.has(hand))) throw new Error("矩阵包含无效或重复手牌。");
  const expected = rangeClasses(task.target), wanted = new Set(expected), actual = new Set(selected);
  const missing = expected.filter(hand => !actual.has(hand));
  const excess = selected.filter(hand => !wanted.has(hand));
  return { missing, excess, exact: !missing.length && !excess.length,
    selectedCombos: selected.reduce((n, hand) => n + comboCount(hand), 0),
    expectedCombos: expected.reduce((n, hand) => n + comboCount(hand), 0) };
}
/** An abstract, one-bet zero-sum river model. All value hands beat all catchers;
 * all bluffs lose at showdown. No ties, blockers, raises, rake or future betting.
 * Restrict to the interior mixing solution; do not silently clip boundary cases. */
export function polarizedReference(input: Pick<FrequencyTask, "pot" | "bet" | "values" | "bluffs">) {
  const { pot: p, bet: b, values: v, bluffs: l } = input;
  if (![p, b, v, l].every(n => Number.isFinite(n) && n > 0)) throw new Error("模型参数必须是正有限数。");
  const bluffFrequency = v * b / (l * (p + b));
  if (!(bluffFrequency > 0 && bluffFrequency < 1)) throw new Error("此专项只支持有内部混合解的模型；不能将边界解当作混合训练。");
  const callFrequency = p / (p + b);
  const bettingBluffShare = l * bluffFrequency / (v + l * bluffFrequency);
  return { bluffFrequency, callFrequency, bettingBluffShare,
    bluffBetEV: (1 - callFrequency) * p - callFrequency * b,
    catcherCallEV: bettingBluffShare * (p + 2 * b) - b };
}
export interface WorkshopSession {
  version: typeof WORKSHOP_VERSION; id: string; taskId: string; seen: boolean; assisted: boolean;
  selected: string[]; frequency: string; actions: WorkshopAction[]; status: "acting" | "complete";
  createdAt: number; updatedAt: number; revision: number;
}
export const EXECUTION_ROUNDS = 24;
export function newWorkshop(taskId: string): WorkshopSession {
  taskById(taskId);
  return { version: WORKSHOP_VERSION, id: crypto.randomUUID(), taskId, seen: false, assisted: false,
    selected: [], frequency: "", actions: [], status: "acting", createdAt: Date.now(), updatedAt: Date.now(), revision: 0 };
}
export function finishWorkshop(session: WorkshopSession): WorkshopSession {
  validateWorkshop(session);
  const task = taskById(session.taskId);
  if (session.status !== "acting") throw new Error("已完成记录不可重复提交。");
  if (task.kind === "frequency" && (!session.frequency.trim() || !Number.isFinite(Number(session.frequency)) || Number(session.frequency) < 0 || Number(session.frequency) > 100 || session.actions.length !== EXECUTION_ROUNDS)) throw new Error(`请输入0–100%的计划，并完成${EXECUTION_ROUNDS}次实际选择。`);
  return { ...session, status: "complete", updatedAt: Date.now() };
}
export function validateWorkshop(value: unknown): WorkshopSession {
  if (!value || typeof value !== "object") throw new Error("专项会话格式无效。");
  const s = value as WorkshopSession; const task = taskById(s.taskId);
  if (s.version !== WORKSHOP_VERSION || typeof s.id !== "string" || !s.id || s.id.length > 200 || ![s.seen, s.assisted].every(x => typeof x === "boolean") || !["acting", "complete"].includes(s.status) || ![s.createdAt, s.updatedAt].every(x => Number.isFinite(x) && x >= 0) || !Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error("专项版本或字段无效。");
  if (!Array.isArray(s.selected) || s.selected.length > 169 || new Set(s.selected).size !== s.selected.length || s.selected.some(hand => !classes.has(hand)) || typeof s.frequency !== "string" || s.frequency.length > 20 || !Array.isArray(s.actions) || s.actions.length > EXECUTION_ROUNDS || s.actions.some(a => a !== "pass" && a !== "commit")) throw new Error("专项作答数据无效。");
  if (task.kind === "range" && (s.actions.length || s.frequency)) throw new Error("范围记录不能含有频率作答。");
  if (task.kind === "frequency" && (s.frequency.trim() ? !Number.isFinite(Number(s.frequency)) || Number(s.frequency) < 0 || Number(s.frequency) > 100 : s.actions.length > 0)) throw new Error("频率计划无效或尚未保存。");
  if (task.kind === "frequency" && s.selected.length) throw new Error("频率记录不能含有矩阵作答。");
  if (s.status === "complete" && task.kind === "frequency" && (!s.frequency.trim() || !Number.isFinite(Number(s.frequency)) || Number(s.frequency) < 0 || Number(s.frequency) > 100 || s.actions.length !== EXECUTION_ROUNDS)) throw new Error("完成记录缺少频率或实际选择。");
  return structuredClone(s);
}
export function frequencySummary(task: FrequencyTask, session: WorkshopSession) {
  validateWorkshop(session);
  if (session.taskId !== task.id || session.status !== "complete") throw new Error("先完成对应频率专项。");
  const reference = polarizedReference(task);
  const target = task.role === "bluffer" ? reference.bluffFrequency : reference.callFrequency;
  const actual = session.actions.filter(a => a === "commit").length / session.actions.length;
  return { reference, target, planned: Number(session.frequency) / 100, actual, rounds: session.actions.length };
}
