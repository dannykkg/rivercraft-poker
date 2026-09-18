import type { GameState } from "../domain/types";
import { rehydrateTournament } from "../domain/reducer";
import { projectPlayerView } from "../domain/view";
import { validateReference } from "./grading";
import { isCard, integer, recordHand } from "./scenario";
import { summaryOf, type Attempt, type Backup, type Branch, type HandRecord, type HandSummary, type Note, type Progress, type StrategyReference } from "./model";

const DB = "rivercraft-study";
const NAMES = ["hands", "summaries", "notes", "branches", "attempts", "references", "preferences"] as const;
type Store = typeof NAMES[number];
let opening: Promise<IDBDatabase> | undefined;
const open = (): Promise<IDBDatabase> => {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const name of NAMES) {
        const store = request.result.createObjectStore(name, { keyPath: "id" });
        if (name === "summaries") store.createIndex("updated", ["updatedAt", "id"]);
        if (name === "notes" || name === "branches") store.createIndex("handId", "handId");
        if (name === "attempts") { store.createIndex("lessonId", "lessonId"); store.createIndex("questionId", "questionId"); }
      }
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = undefined; }; resolve(db); };
    request.onerror = () => reject(request.error ?? new Error("无法打开学习资料库。"));
    request.onblocked = () => reject(new Error("请关闭仍打开旧版本的标签页后重试。"));
  }).catch(error => { opening = undefined; throw error; });
  return opening;
};
const read = async <T>(name: Store, id: string): Promise<T | undefined> => {
  const db = await open(); return new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).get(id); r.onsuccess = () => resolve(r.result as T | undefined); r.onerror = () => reject(r.error); });
};
const all = async <T>(name: Store, index?: string, key?: string): Promise<T[]> => {
  const db = await open(); return new Promise((resolve, reject) => { const store = db.transaction(name).objectStore(name); const r = index ? store.index(index).getAll(key) : store.getAll(); r.onsuccess = () => resolve(r.result as T[]); r.onerror = () => reject(r.error); });
};
const write = async (name: Store, value: unknown): Promise<void> => {
  const db = await open(); return new Promise((resolve, reject) => { const tx = db.transaction(name, "readwrite"); tx.objectStore(name).put(structuredClone(value)); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("学习记录写入失败。")); });
};
export const loadHand = (id: string) => read<HandRecord>("hands", id);
export const loadNotes = (handId: string) => all<Note>("notes", "handId", handId);
export const loadBranches = (handId: string) => all<Branch>("branches", "handId", handId);
export const loadAttempts = () => all<Attempt>("attempts");
export const loadReferences = () => all<StrategyReference>("references");
export const saveNote = (note: Note) => write("notes", note);
export const saveBranch = (branch: Branch) => write("branches", branch);
export const saveAttempt = (attempt: Attempt) => write("attempts", attempt);
export const saveReference = (reference: StrategyReference) => write("references", validateReference(reference));
export const saveProgress = (value: Progress | null) => write("preferences", { id: "progress", value });
export const loadProgress = async () => (await read<{ value: Progress | null }>("preferences", "progress"))?.value ?? null;

export const saveHand = async (record: HandRecord, keepDetails = true): Promise<void> => {
  const db = await open(); return new Promise((resolve, reject) => {
    const tx = db.transaction(["hands", "summaries"], "readwrite"); const store = tx.objectStore("hands"); const r = store.get(record.id);
    r.onsuccess = () => {
      const previous = r.result as HandRecord | undefined;
      const next = previous && keepDetails ? { ...record, title: previous.title, tags: previous.tags, starred: previous.starred, createdAt: previous.createdAt } : record;
      // Never replace a completed fact record with an older partial capture.
      const selected = previous?.complete && !record.complete ? { ...previous, ...(keepDetails ? {} : { title: record.title, tags: record.tags, starred: record.starred }) } : next;
      store.put(selected); tx.objectStore("summaries").put(summaryOf(selected));
    };
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("保存牌谱失败。"));
  });
};
export interface HandPage { items: HandSummary[]; next?: [number, string] }
export const listHands = async (query = "", favorites = false, cursor?: [number, string]): Promise<HandPage> => {
  const db = await open(); const text = query.trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const items: HandSummary[] = []; const r = db.transaction("summaries").objectStore("summaries").index("updated").openCursor(cursor ? IDBKeyRange.upperBound(cursor, true) : null, "prev");
    r.onerror = () => reject(r.error); r.onsuccess = () => {
      const c = r.result; if (!c) { resolve({ items }); return; } const h = c.value as HandSummary;
      if ((!favorites || h.starred) && (!text || `${h.title} ${h.tags.join(" ")} ${h.mode} ${h.source}`.toLowerCase().includes(text))) items.push(h);
      if (items.length === 30) { resolve({ items, next: [h.updatedAt, h.id] }); return; } c.continue();
    };
  });
};
let queue: Promise<void> = Promise.resolve(); const captured = new Map<string, number>();
export const captureCompleted = (state: GameState): Promise<void> => {
  const hero = state.players.find(p => p.kind === "human"); if (!hero) return Promise.resolve();
  const snapshot = structuredClone(state);
  queue = queue.catch(() => undefined).then(async () => {
    const after = captured.get(snapshot.id) ?? 0; const seen = new Set<number>();
    for (let i = 0; i < snapshot.events.length; i++) {
      const e = snapshot.events[i]; if (e.sequence <= after || e.type !== "state-checkpoint") continue;
      const s = e.private?.snapshot as GameState | undefined;
      if (s?.hand?.phase !== "complete" || seen.has(s.handNumber)) continue;
      seen.add(s.handNumber); await saveHand(recordHand(rehydrateTournament(snapshot.events.slice(0, i + 1)), hero.id, "play"));
    }
    captured.set(snapshot.id, snapshot.events.at(-1)?.sequence ?? 0);
  }); return queue;
};
export const flushCapture = () => queue;
const text = (x: unknown, max = 1000): x is string => typeof x === "string" && x.length <= max;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Validate imported structures before any write or engine use. Imports are local data, never code. */
export const validateHand = (value: unknown): HandRecord => {
  if (!value || typeof value !== "object") throw new Error("牌谱不是对象。"); const h = value as HandRecord;
  if (h.version !== 1 || !text(h.id) || !h.id || !text(h.gameId) || !text(h.heroId) || !text(h.title, 300) || !integer(h.handNumber, 1) || !["play", "lesson", "lab"].includes(h.source) || !["cash", "tournament"].includes(h.mode) || !finite(h.createdAt) || !finite(h.updatedAt) || typeof h.starred !== "boolean" || typeof h.complete !== "boolean" || !Array.isArray(h.tags) || h.tags.length > 40 || h.tags.some(t => !text(t, 100))) throw new Error("牌谱索引字段无效。");
  if (!Array.isArray(h.events) || !h.events.length || h.events.length > 10000) throw new Error("牌谱事件数量无效。"); let checkpoint = false;
  for (const [i, e] of h.events.entries()) {
    if (!e || e.sequence !== i + 1 || !text(e.id) || !text(e.type) || !finite(e.timestamp) || !e.public || typeof e.public !== "object") throw new Error("牌谱事件顺序或格式无效。");
    if (e.type !== "state-checkpoint") continue; checkpoint = true;
    const s = e.private?.snapshot as GameState | undefined;
    if (!s?.hand || !s.config || !["cash", "tournament"].includes(s.config.mode) || !["playing", "paused", "finished"].includes(s.status) || !Array.isArray(s.players) || s.players.length < 2 || s.players.length > 9 || !integer(s.handNumber, 1) || !integer(s.blindLevelIndex)) throw new Error("检查点结构无效。");
    const ids = new Set<string>(); const seats = new Set<number>();
    for (const p of s.players) { if (!p || !text(p.id) || !p.id || ids.has(p.id) || ["__proto__", "constructor", "prototype"].includes(p.id) || !text(p.name) || !integer(p.seat, 0, 8) || seats.has(p.seat) || !integer(p.stack) || typeof p.eliminated !== "boolean") throw new Error("检查点玩家无效。"); ids.add(p.id); seats.add(p.seat); }
    const hand = s.hand;
    if (!Array.isArray(hand.players) || hand.players.length < 2 || hand.players.length > s.players.length || !Array.isArray(hand.board) || ![0, 3, 4, 5].includes(hand.board.length) || !Array.isArray(hand.deck) || !Array.isArray(hand.winners) || !Array.isArray(hand.pots) || !Array.isArray(hand.actedSinceFullRaise) || !hand.lastActedAtBet || !["preflop", "flop", "turn", "river", "showdown", "complete"].includes(hand.phase)) throw new Error("检查点手牌结构无效。");
    if (!integer(hand.currentBet) || !integer(hand.lastFullRaiseSize, 1) || !integer(hand.dealerSeat, 0, 8) || (hand.currentPlayerSeat !== null && !seats.has(hand.currentPlayerSeat))) throw new Error("检查点行动状态无效。");
    for (const p of hand.players) if (!ids.has(p.playerId) || !seats.has(p.seat) || !Array.isArray(p.holeCards) || p.holeCards.length !== 2 || !integer(p.stack) || !integer(p.totalContribution) || !integer(p.streetContribution, 0, p.totalContribution) || typeof p.folded !== "boolean" || typeof p.allIn !== "boolean") throw new Error("检查点投入或底牌无效。");
    const cards = [...hand.board, ...hand.deck, ...hand.players.flatMap(p => p.holeCards)]; if (!cards.every(isCard) || new Set(cards).size !== cards.length || cards.length > 52) throw new Error("检查点存在重复或无效牌。");
    if (s.config.mode === "tournament" && (!Array.isArray(s.config.blindLevels) || !s.config.blindLevels[s.blindLevelIndex] || s.config.blindLevels.some(b => !integer(b.smallBlind, 1) || !integer(b.bigBlind, b.smallBlind + 1) || !integer(b.hands, 1, Number.MAX_SAFE_INTEGER)))) throw new Error("锦标赛盲注无效。");
    if (s.config.mode === "cash" && (!integer(s.config.smallBlind, 1) || !integer(s.config.bigBlind, s.config.smallBlind + 1))) throw new Error("现金桌盲注无效。");
  }
  if (!checkpoint) throw new Error("牌谱缺少可恢复检查点。");
  const state = rehydrateTournament(h.events);
  if (state.handNumber !== h.handNumber || state.config.mode !== h.mode || !state.players.some(p => p.id === h.heroId)) throw new Error("牌谱索引与检查点不一致。");
  projectPlayerView(state, h.heroId); return structuredClone(h);
};
export const validateBackup = (value: unknown): Backup => {
  if (!value || typeof value !== "object") throw new Error("备份格式无效。"); const b = value as Backup;
  if (b.format !== "rivercraft-study" || b.version !== 1 || !finite(b.exportedAt)) throw new Error("不支持的备份版本。");
  for (const name of ["hands", "notes", "branches", "attempts", "references"] as const) {
    if (!Array.isArray(b[name]) || b[name].length > 50000) throw new Error("备份条目数量无效。");
    const ids = new Set<string>(); for (const item of b[name]) { if (!item || !text(item.id, 2000) || !item.id || ids.has(item.id)) throw new Error("备份含重复或无效标识。"); ids.add(item.id); }
  }
  b.hands.forEach(validateHand); b.references.forEach(validateReference);
  for (const n of b.notes) if (!b.hands.some(h => h.id === n.handId && h.events.some(e => e.sequence === n.sequence)) || !text(n.text, 10000) || !text(n.skill, 100) || !finite(n.createdAt)) throw new Error("笔记内容或关联无效。");
  for (const a of b.attempts) if (a.version !== 1 || !text(a.lessonId, 100) || !text(a.questionId, 2000) || !text(a.answer, 1000) || typeof a.correct !== "boolean" || typeof a.hinted !== "boolean" || typeof a.seen !== "boolean" || !["guided", "test", "review"].includes(a.mode) || !finite(a.createdAt)) throw new Error("练习记录无效。");
  for (const branch of b.branches) {
    const parent = b.hands.find(h => h.id === branch.handId);
    if (!parent || !parent.events.some(e => e.sequence === branch.sequence && e.type === "state-checkpoint") || !["original", "resample"].includes(branch.mode) || !text(branch.title, 300) || !text(branch.assumptions, 10000) || !integer(branch.seed, 0, 0xffffffff) || !finite(branch.createdAt)) throw new Error("分支关联或条件无效。");
    validateHand({ ...parent, id: branch.id, events: branch.events });
  }
  return structuredClone(b);
};
export const exportBackup = async (): Promise<Backup> => {
  await flushCapture(); const db = await open(); const names = ["hands", "notes", "branches", "attempts", "references"] as const;
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...names]); const result = { format: "rivercraft-study", version: 1, exportedAt: Date.now() } as Backup;
    for (const name of names) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { (result as unknown as Record<string, unknown>)[name] = r.result; }; }
    tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("导出失败。"));
  });
};
/** Whole-package validation and one transaction; existing records are never overwritten. */
export const importBackup = async (value: unknown): Promise<number> => {
  const b = validateBackup(value); const db = await open(); let count = 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...NAMES], "readwrite");
    for (const name of ["hands", "notes", "branches", "attempts", "references"] as const) for (const item of b[name]) {
      const store = tx.objectStore(name); const r = store.get(item.id); r.onsuccess = () => { if (r.result !== undefined) return; store.put(item); if (name === "hands") tx.objectStore("summaries").put(summaryOf(item as HandRecord)); count++; };
    }
    tx.oncomplete = () => resolve(count); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("导入已回滚，未保存部分数据。"));
  });
};
export const downloadJSON = (name: string, value: unknown): void => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const readJSON = async (file: File): Promise<unknown> => {
  if (file.size > 32 * 1024 * 1024) throw new Error("导入文件不能超过 32 MB。");
  try { return JSON.parse(await file.text()) as unknown; } catch { throw new Error("无法解析 JSON 文件。"); }
};
