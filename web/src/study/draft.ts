import type { GameState } from "../domain/types";
import type { Branch, HandRecord, Scenario } from "./model";
import { integer, recordHand, validateScenario } from "./scenario";
import { loadProgress, validateHand } from "./storage";

export interface LabDraft {
  version: 1; state: GameState; root: GameState; scenario: Scenario; heroId: string;
  title: string; assumptions: string; seed: number; parent?: HandRecord;
  sequence?: number; mode: Branch["mode"]; branchId: string;
}
const openExisting = async (): Promise<IDBDatabase> => {
  // Initialize through the canonical schema owner; do not duplicate migrations.
  await loadProgress();
  return new Promise((resolve, reject) => { const r = indexedDB.open("rivercraft-study", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
};
export const saveLabDraft = async (draft: LabDraft): Promise<void> => {
  const db = await openExisting();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("preferences", "readwrite"); tx.objectStore("preferences").put({ id: "lab-draft", value: structuredClone(draft) }); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("实验草稿保存失败。")); }).finally(() => db.close());
};
export const loadLabDraft = async (): Promise<LabDraft | null> => {
  const db = await openExisting();
  const stored = await new Promise<{ value: LabDraft } | undefined>((resolve, reject) => { const r = db.transaction("preferences").objectStore("preferences").get("lab-draft"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }).finally(() => db.close());
  if (!stored) return null; const d = stored.value;
  if (!d || d.version !== 1 || typeof d.heroId !== "string" || typeof d.title !== "string" || typeof d.assumptions !== "string" || !integer(d.seed, 0, 0xffffffff) || !["original", "resample"].includes(d.mode) || typeof d.branchId !== "string") throw new Error("实验草稿格式无效。");
  validateScenario(d.scenario); validateHand(recordHand(d.state, d.heroId, "lab")); validateHand(recordHand(d.root, d.heroId, "lab"));
  if (d.parent) { validateHand(d.parent); if (!d.parent.events.some(e => e.type === "state-checkpoint" && e.sequence === d.sequence)) throw new Error("实验草稿分支来源无效。"); }
  return structuredClone(d);
};
