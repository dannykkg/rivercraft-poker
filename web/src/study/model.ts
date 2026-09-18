import type { Card, GameEvent, GameMode, PlayerAction } from "../domain/types";

export type Level = 1 | 2 | 3 | 4 | 5 | 6;
export type Evidence = "rule" | "exact" | "teaching" | "solver";
export interface Scenario {
  version: 1; id: string; title: string; seed: number; mode: GameMode;
  smallBlind: number; bigBlind: number; dealerSeat: number; heroId: string;
  players: Array<{ id: string; name: string; stack: number; cards?: Card[] }>;
  board: Card[];
  prefix: Array<{ playerId: string; action: PlayerAction }>;
  assumptions: string;
}
export interface HandRecord {
  version: 1; id: string; gameId: string; handNumber: number; heroId: string;
  title: string; tags: string[]; starred: boolean; source: "play" | "lesson" | "lab";
  mode: GameMode; complete: boolean; createdAt: number; updatedAt: number; events: GameEvent[];
}
export type HandSummary = Omit<HandRecord, "events">;
export interface Note { id: string; handId: string; sequence: number; text: string; skill: string; createdAt: number }
export interface Branch {
  id: string; handId: string; sequence: number; title: string;
  mode: "original" | "resample"; seed: number; assumptions: string; events: GameEvent[]; createdAt: number;
}
export interface Question {
  id: string; prompt: string; hint: string; explanation: string; evidence: Evidence; assumptions: string;
  choices?: string[]; answer: string | number; tolerance?: number; unit?: string;
  cards?: Card[]; selectCount?: number; scenario?: Scenario; actions?: PlayerAction[];
}
export interface Lesson {
  id: string; level: Level; title: string; concept: string; caution: string;
  prerequisites: string[]; questions: Question[];
}
export interface Attempt {
  id: string; lessonId: string; questionId: string; version: 1; correct: boolean;
  hinted: boolean; seen: boolean; mode: "guided" | "test" | "review"; answer: string; createdAt: number;
}
export interface Progress { id: "session"; lessonId: string; index: number; mode: Attempt["mode"]; hinted: boolean; submitted: string | null }
export interface StrategyReference {
  version: 1; id: string; revision: string; context: string;
  source: string; license: string; assumptions: string; unit: "chips" | "prize-equity";
  errorBound: number; actions: Array<{ key: string; frequency: number; ev: number }>;
}
export interface Backup {
  format: "rivercraft-study"; version: 1; exportedAt: number;
  hands: HandRecord[]; notes: Note[]; branches: Branch[]; attempts: Attempt[]; references: StrategyReference[];
}
export const uid = (prefix: string): string => `${prefix}:${crypto.randomUUID()}`;
export const actionKey = (action: PlayerAction): string => action.type === "raise" ? `raise:${action.to}` : action.type;
export const summaryOf = ({ events: _events, ...summary }: HandRecord): HandSummary => summary;
export const errorText = (error: unknown): string => error instanceof Error ? error.message : "操作失败。";
