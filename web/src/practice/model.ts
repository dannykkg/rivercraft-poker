import type { GameState, HandPhase, PlayerAction } from "../domain/types";
import type { HandRecord, Scenario } from "../study/model";

export type CourseId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
export type Scope = "spot" | "street" | "hand";
export type Mode = "guided" | "assessment" | "review";
export type Opponent = "balanced" | "caller" | "tight" | "pressure";
export type Goal = "open" | "defend" | "reraise" | "value" | "check" | "draw" | "barrel" | "river-call" | "adapt";
export interface Source { id: string; title: string; url?: string; role: "concept" | "method" | "authored"; note: string }
export interface Course { id: CourseId; title: string; objective: string; foundations: string[] }
export interface CaseDefinition {
  id: string; family: string; scenario: Scenario; range: string; goal: Goal;
  preferred: Array<"fold" | "check" | "call" | "small" | "large">;
  explanation: string; terminal?: boolean;
}
export interface Drill {
  id: string; courseId: CourseId; title: string; objective: string; foundations: string[];
  defaultScope: Scope; opponent: Opponent; sourceIds: string[]; cases: CaseDefinition[];
}
export interface Feedback {
  kind: "teaching" | "math" | "ungraded";
  verdict: "aligned" | "discuss" | "deviation" | "ungraded";
  title: string; explanation: string; tags: string[]; sourceIds: string[];
  reference: string; recommended: string[];
  equity?: number; threshold?: number; evLoss?: number; unit?: "chips";
}
export interface Decision {
  id: string; sequence: number; phase: HandPhase; action: PlayerAction;
  feedback: Feedback; hinted: boolean; before: GameState;
}
export interface Session {
  schema: 1; contentVersion: string; id: string; drillId: string; caseId: string; family: string;
  title: string; heroId: string; mode: Mode; scope: Scope; opponent: Opponent; seed: number;
  range: string; initial: GameState; state: GameState; startPhase: HandPhase;
  decisions: Decision[]; hinted: boolean; assisted: boolean; seen: boolean;
  status: "acting" | "feedback" | "complete"; createdAt: number; updatedAt: number;
  sourceHandId?: string; sourceSequence?: number;
}
export interface Result {
  id: string; contentVersion: string; drillId: string; caseId: string; family: string;
  mode: Mode; scope: Scope; seen: boolean; assisted: boolean; createdAt: number;
  decisions: number; aligned: number; deviations: number; ungraded: number;
  mathLoss: number; mathDecisions: number; dueAt: number; session: Session;
}
export interface PracticeLaunch { id: string; hand: HandRecord; sequence: number }
export interface PracticeBackup { format: "rivercraft-practice"; version: 1; exportedAt: number; results: Result[]; session: Session | null; exposures?: string[] }
