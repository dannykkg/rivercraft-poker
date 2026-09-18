import { rehydrateTournament } from "../domain/reducer";
import { getLegalActions, submitAction } from "../domain/engine";
import { recordHand, validAction } from "../study/scenario";
import { validateHand } from "../study/storage";
import type { PracticeBackup, Result, Session } from "./model";
import { resultOf } from "./runner";

const DATABASE = "rivercraft-practice";
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DATABASE, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("session"); r.result.createObjectStore("results", { keyPath: "id" }); r.result.createObjectStore("exposures"); };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); opening = undefined; }; resolve(db); };
    r.onerror = () => reject(r.error ?? new Error("无法打开实战训练资料库。"));
    r.onblocked = () => reject(new Error("请关闭旧版本标签页后重试。"));
  }).catch(e => { opening = undefined; throw e; });
  return opening;
}
export async function loadPractice(): Promise<{ session: Session | null; results: Result[]; exposures: string[] }> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["session", "results", "exposures"]); const exposure = tx.objectStore("exposures").getAllKeys(); const s = tx.objectStore("session").get("current"), r = tx.objectStore("results").getAll();
    tx.oncomplete = () => { try { resolve({ exposures: exposure.result as string[], session: s.result ? validateSession(s.result) : null, results: (r.result as Result[]).sort((a, b) => b.createdAt - a.createdAt) }); } catch (e) { reject(e); } };
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("读取实战记录失败。"));
  });
}
/** Session checkpoint and a completed result commit in one transaction. Retrying the same id is idempotent. */
export async function savePractice(session: Session | null, result?: Result): Promise<Session | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["session", "results", "exposures"], "readwrite");
    let accepted = structuredClone(session);
    const write = () => {
      tx.objectStore("session").put(accepted, "current");
      if (result && accepted) tx.objectStore("results").put({ ...structuredClone(result), seen: accepted.seen, session: accepted });
    };
    if (accepted) {
      const exposure = tx.objectStore("exposures").get(accepted.family);
      exposure.onsuccess = () => {
        if (accepted && accepted.decisions.length === 0 && exposure.result && exposure.result !== accepted.id) accepted.seen = true;
        if (accepted && !exposure.result) tx.objectStore("exposures").put(accepted.id, accepted.family);
        write();
      };
    } else write();
    tx.oncomplete = () => resolve(accepted); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("实战进度未保存，请重试或导出备份。"));
  });
}
const text = (x: unknown, max = 20000): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
function validateMaterializedState(value: Session["state"], heroId: string): void {
  validateHand(recordHand(value, heroId, "lesson"));
  const rebuilt = rehydrateTournament(value.events);
  const snapshot = ({ events: _events, ...rest }: Session["state"]) => rest;
  if (JSON.stringify(snapshot(value)) !== JSON.stringify(snapshot(rebuilt))) throw new Error("运行状态与权威检查点不一致。");
}
export function validateSession(value: unknown): Session {
  if (!value || typeof value !== "object") throw new Error("训练会话格式无效。");
  const s = value as Session;
  if (s.schema !== 1 || ![s.id, s.contentVersion, s.drillId, s.caseId, s.family, s.title, s.heroId, s.range].every(x => text(x)) || !["spot", "street", "hand"].includes(s.scope) || !["guided", "assessment", "review"].includes(s.mode) || !["balanced", "caller", "tight", "pressure"].includes(s.opponent) || !["acting", "feedback", "complete"].includes(s.status) || !["preflop", "flop", "turn", "river"].includes(s.startPhase)) throw new Error("训练配置无效或版本不支持。");
  if (![s.hinted, s.assisted, s.seen].every(x => typeof x === "boolean") || !finite(s.seed) || !Number.isSafeInteger(s.seed) || s.seed > 0xffffffff || !finite(s.createdAt) || !finite(s.updatedAt) || !Array.isArray(s.decisions) || s.decisions.length > 128) throw new Error("训练记录字段无效。");
  if (!s.initial || !s.state || !Array.isArray(s.initial.events) || !Array.isArray(s.state.events)) throw new Error("训练缺少检查点。");
  validateMaterializedState(s.initial, s.heroId); validateMaterializedState(s.state, s.heroId);
  if (s.initial.id !== s.state.id || s.initial.handNumber !== s.state.handNumber || s.initial.hand?.phase !== s.startPhase) throw new Error("训练局面身份不一致。");
  if (getLegalActions(s.initial)?.playerId !== s.heroId || (s.status === "acting" && getLegalActions(s.state)?.playerId !== s.heroId)) throw new Error("训练不在学习者决策点。");
  let sequence = -1;
  for (const d of s.decisions) {
    if (!d || !text(d.id) || !Number.isSafeInteger(d.sequence) || d.sequence <= sequence || !validAction(d.action) || typeof d.hinted !== "boolean" || !d.before?.events) throw new Error("训练决策顺序无效。");
    sequence = d.sequence; validateMaterializedState(d.before, s.heroId);
    if (d.before.events.at(-1)?.sequence !== d.sequence || d.phase !== d.before.hand?.phase || d.before.id !== s.initial.id || getLegalActions(d.before)?.playerId !== s.heroId || !submitAction(d.before, s.heroId, d.action).ok) throw new Error("决策检查点或实际动作无效。");
    const f = d.feedback;
    if (!f || !["teaching", "math", "ungraded"].includes(f.kind) || !["aligned", "discuss", "deviation", "ungraded"].includes(f.verdict) || !text(f.title) || !text(f.explanation) || !text(f.reference) || !Array.isArray(f.tags) || !Array.isArray(f.sourceIds) || !Array.isArray(f.recommended) || [...f.tags, ...f.sourceIds, ...f.recommended].some(x => !text(x))) throw new Error("训练反馈无效。");
    if (f.evLoss !== undefined && (!finite(f.evLoss) || f.kind !== "math" || f.unit !== "chips")) throw new Error("收益字段无效。");
    for (const number of [f.equity, f.threshold]) if (number !== undefined && (!finite(number) || number > 1)) throw new Error("权益字段无效。");
  }
  if (s.status !== "acting" && !s.decisions.length) throw new Error("反馈或完成状态缺少决策。");
  return structuredClone(s);
}
export function validatePracticeBackup(value: unknown): PracticeBackup {
  if (!value || typeof value !== "object") throw new Error("不是实战备份。"); const b = value as PracticeBackup;
  if (b.format !== "rivercraft-practice" || b.version !== 1 || !finite(b.exportedAt) || !Array.isArray(b.results) || b.results.length > 1000 || (b.session !== null && typeof b.session !== "object")) throw new Error("实战备份格式或数量无效。");
  if (b.exposures !== undefined && (!Array.isArray(b.exposures) || b.exposures.length > 10000 || b.exposures.some(x => !text(x)))) throw new Error("已见局面索引无效。");
  const ids = new Set<string>();
  const results = b.results.map(r => {
    if (!r || !text(r.id) || ids.has(r.id) || !finite(r.dueAt)) throw new Error("记录ID重复或字段无效。"); ids.add(r.id);
    const session = validateSession(r.session);
    if (session.id !== r.id || session.status !== "complete") throw new Error("完成记录与会话不一致。");
    // Recompute derived counts rather than trusting imported totals.
    return { ...resultOf(session), dueAt: r.dueAt };
  });
  return { format: "rivercraft-practice", version: 1, exportedAt: b.exportedAt, results, exposures: [...new Set([...(b.exposures ?? []), ...results.map(r => r.family)])], session: b.session === null ? null : validateSession(b.session) };
}
export async function exportPractice(): Promise<PracticeBackup> {
  const value = await loadPractice(); return { format: "rivercraft-practice", version: 1, exportedAt: Date.now(), ...value };
}
export async function importPractice(value: unknown): Promise<number> {
  const b = validatePracticeBackup(value); const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["session", "results", "exposures"], "readwrite"); let added = 0;
    for (const family of b.exposures ?? []) { const store = tx.objectStore("exposures"); const r = store.get(family); r.onsuccess = () => { if (!r.result) store.put("imported", family); }; }
    for (const result of b.results) { const store = tx.objectStore("results"); const r = store.get(result.id); r.onsuccess = () => { if (!r.result) { store.add(result); added++; } }; }
    const current = tx.objectStore("session").get("current"); current.onsuccess = () => { if (!current.result && b.session) tx.objectStore("session").put(b.session, "current"); };
    tx.oncomplete = () => resolve(added); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("导入失败，事务已回滚。"));
  });
}
