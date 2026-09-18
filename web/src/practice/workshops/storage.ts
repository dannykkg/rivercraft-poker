import { WORKSHOP_VERSION, taskById, validateWorkshop, type WorkshopSession } from "./model";

const DATABASE = "rivercraft-practice-workshops";
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("current"); request.result.createObjectStore("records", { keyPath: "id" }); request.result.createObjectStore("exposures"); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = undefined; }; resolve(db); };
    request.onerror = () => reject(request.error ?? new Error("无法打开范围与频率记录。"));
    request.onblocked = () => reject(new Error("请关闭旧标签页再试。"));
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
export interface WorkshopData { current: WorkshopSession | null; records: WorkshopSession[]; exposures: string[] }
export async function loadWorkshops(): Promise<WorkshopData> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["current", "records", "exposures"]);
    const current = tx.objectStore("current").get("current"), records = tx.objectStore("records").getAll(), exposures = tx.objectStore("exposures").getAllKeys();
    tx.oncomplete = () => { try { resolve({ current: current.result ? validateWorkshop(current.result) : null, records: records.result.map(validateWorkshop).sort((a, b) => b.updatedAt - a.updatedAt), exposures: exposures.result as string[] }); } catch (error) { reject(error); } };
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("读取范围与频率记录失败。"));
  });
}
/** Optimistic concurrency prevents a stale browser tab overwriting a newer attempt.
 * Exposure, current state and final record are written in one transaction. */
export async function saveWorkshop(next: WorkshopSession | null, expected: WorkshopSession | null): Promise<WorkshopSession | null> {
  const validated = next ? validateWorkshop(next) : null;
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["current", "records", "exposures"], "readwrite");
    const store = tx.objectStore("current"), read = store.get("current");
    let accepted: WorkshopSession | null = null; let failure: Error | undefined;
    const abort = (message: string) => { failure = new Error(message); tx.abort(); };
    read.onsuccess = () => {
      const current = read.result as WorkshopSession | undefined;
      if (expected ? !current || current.id !== expected.id || current.revision !== expected.revision : Boolean(current)) { abort("另一标签页已修改专项，请刷新后继续；没有覆盖较新的记录。"); return; }
      if (!validated) { store.delete("current"); return; }
      if (current && (current.status === "complete" || validated.id !== current.id || validated.taskId !== current.taskId || validated.createdAt !== current.createdAt)) { abort("已完成记录或专项身份不能改写。"); return; }
      if (current && (validated.actions.length < current.actions.length || validated.actions.length > current.actions.length + 1 || current.actions.some((action, i) => validated.actions[i] !== action) || (current.actions.length > 0 && validated.frequency !== current.frequency))) { abort("已执行动作和锁定的频率计划不能改写。"); return; }
      accepted = { ...validated, revision: (current?.revision ?? -1) + 1, updatedAt: Date.now(), assisted: Boolean(current?.assisted || validated.assisted), seen: Boolean(current?.seen || validated.seen) };
      const exposures = tx.objectStore("exposures"); const key = `${WORKSHOP_VERSION}:${accepted.taskId}`;
      const exposure = exposures.get(key);
      exposure.onsuccess = () => {
        if (!accepted) return;
        if (!current && exposure.result && exposure.result !== accepted.id) accepted.seen = true;
        if (!exposure.result) exposures.put(accepted.id, key);
        store.put(accepted, "current");
        if (accepted.status === "complete") tx.objectStore("records").add(accepted);
      };
    };
    tx.oncomplete = () => resolve(accepted); tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("专项未保存，事务已回滚。"));
  });
}
export interface WorkshopBackup extends WorkshopData { format: "rivercraft-practice-workshops"; version: 1; contentVersion: typeof WORKSHOP_VERSION; exportedAt: number }
export function validateWorkshopBackup(value: unknown): WorkshopBackup {
  if (!value || typeof value !== "object") throw new Error("专项备份无效。");
  const b = value as WorkshopBackup;
  if (b.format !== "rivercraft-practice-workshops" || b.version !== 1 || b.contentVersion !== WORKSHOP_VERSION || !Number.isFinite(b.exportedAt) || b.exportedAt < 0 || !Array.isArray(b.records) || b.records.length > 1000 || !Array.isArray(b.exposures) || b.exposures.length > 10000) throw new Error("专项备份格式、版本或数量无效。");
  const records = b.records.map(validateWorkshop), current = b.current === null ? null : validateWorkshop(b.current);
  if (new Set(records.map(r => r.id)).size !== records.length || records.some(r => r.status !== "complete")) throw new Error("备份中的完成记录无效或重复。");
  const prefix = `${WORKSHOP_VERSION}:`;
  for (const key of b.exposures) { if (typeof key !== "string" || !key.startsWith(prefix)) throw new Error("已见专项标记无效。"); taskById(key.slice(prefix.length)); }
  const matching = current && records.find(r => r.id === current.id);
  if (matching && JSON.stringify(matching) !== JSON.stringify(current)) throw new Error("当前专项与同ID完成记录不一致。");
  const exposures = [...new Set([...b.exposures, ...records.map(r => prefix + r.taskId), ...(current ? [prefix + current.taskId] : [])])];
  return { format: b.format, version: 1, contentVersion: WORKSHOP_VERSION, exportedAt: b.exportedAt, current, records, exposures };
}
export async function exportWorkshops(): Promise<WorkshopBackup> {
  return { format: "rivercraft-practice-workshops", version: 1, contentVersion: WORKSHOP_VERSION, exportedAt: Date.now(), ...await loadWorkshops() };
}
export async function importWorkshops(value: unknown): Promise<number> {
  const backup = validateWorkshopBackup(value), db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["current", "records", "exposures"], "readwrite"); let added = 0;
    for (const key of backup.exposures) { const store = tx.objectStore("exposures"), request = store.get(key); request.onsuccess = () => { if (!request.result) store.put("imported", key); }; }
    for (const record of backup.records) { const store = tx.objectStore("records"), request = store.get(record.id); request.onsuccess = () => { if (!request.result) { store.add(record); added++; } }; }
    const current = tx.objectStore("current").get("current");
    current.onsuccess = () => {
      if (current.result || !backup.current) return;
      const existing = tx.objectStore("records").get(backup.current.id);
      existing.onsuccess = () => tx.objectStore("current").put(existing.result ?? backup.current, "current");
    };
    tx.oncomplete = () => resolve(added); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("专项导入失败，未部分写入。"));
  });
}
