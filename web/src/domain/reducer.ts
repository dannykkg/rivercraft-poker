import type { GameEvent, TournamentSnapshot, TournamentState } from "./types";

/**
 * Pure event reducer. Domain events are retained for audit/replay; the private
 * checkpoint emitted at each command boundary materializes the authoritative
 * state needed to resume a tournament exactly.
 */
export const reduceTournamentEvent = (
  snapshot: TournamentSnapshot | null,
  event: GameEvent,
): TournamentSnapshot | null => {
  if (event.type !== "state-checkpoint") return snapshot;
  const next = event.private?.snapshot;
  if (!next || typeof next !== "object") throw new Error("存档中的状态检查点无效。");
  return structuredClone(next) as TournamentSnapshot;
};

export const rehydrateTournament = (events: GameEvent[]): TournamentState => {
  const snapshot = events.reduce<TournamentSnapshot | null>(reduceTournamentEvent, null);
  if (!snapshot) throw new Error("存档缺少可恢复的状态检查点。");
  return { ...snapshot, events: structuredClone(events) };
};
