import { normalizeGameState, rehydrateTournament } from "../domain/reducer";
import type { GameEvent, GameState } from "../domain/types";

const DATABASE_NAME = "rivercraft-poker";
const DATABASE_VERSION = 3;
const STORE_NAME = "game-state";
const HISTORY_STORE_NAME = "tournament-history";
const CURRENT_KEY = "current-tournament";

export interface GameRepository {
  save(state: GameState): Promise<void>;
  loadCurrent(): Promise<GameState | null>;
  loadHistory(): Promise<GameState[]>;
  clearCurrent(): Promise<void>;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    if (!database.objectStoreNames.contains(HISTORY_STORE_NAME)) database.createObjectStore(HISTORY_STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const saveGame = async (state: GameState): Promise<void> => {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const stores = state.status === "finished" ? [STORE_NAME, HISTORY_STORE_NAME] : [STORE_NAME];
    const transaction = database.transaction(stores, "readwrite");
    const persisted = { version: 4, events: state.events };
    transaction.objectStore(STORE_NAME).put(persisted, CURRENT_KEY);
    if (state.status === "finished") transaction.objectStore(HISTORY_STORE_NAME).put(persisted, state.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

export const loadGame = async (): Promise<GameState | null> => {
  const database = await openDatabase();
  const saved = await new Promise<
    { version: 1; state: GameState } | { version: 2 | 3 | 4; events: GameEvent[] } | undefined
  >((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(CURRENT_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  if (!saved) return null;
  if (saved.version === 1) return normalizeGameState(saved.state);
  if (saved.version === 2 || saved.version === 3 || saved.version === 4) return rehydrateTournament(saved.events);
  throw new Error("存档版本暂不受支持。");
};

export const loadGameHistory = async (): Promise<GameState[]> => {
  const database = await openDatabase();
  const saved = await new Promise<Array<{ version: number; events: GameEvent[] }>>((resolve, reject) => {
    const request = database.transaction(HISTORY_STORE_NAME, "readonly").objectStore(HISTORY_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return saved
    .filter((entry) => (entry.version === 2 || entry.version === 3 || entry.version === 4) && Array.isArray(entry.events))
    .map((entry) => rehydrateTournament(entry.events))
    .sort((first, second) => (second.events.at(-1)?.timestamp ?? 0) - (first.events.at(-1)?.timestamp ?? 0));
};

export const clearCurrentGame = async (): Promise<void> => {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(CURRENT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

/** Browser adapter; a future authenticated HTTP repository can implement the same port. */
export const indexedDbGameRepository: GameRepository = {
  save: saveGame,
  loadCurrent: loadGame,
  loadHistory: loadGameHistory,
  clearCurrent: clearCurrentGame,
};
