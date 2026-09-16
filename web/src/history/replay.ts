import type { Card, GameEvent, HandPhase, TournamentState } from "../domain/types";

export interface ReplayFrame {
  sequence: number;
  eventType: GameEvent["type"];
  label: string;
  phase: HandPhase;
  board: Card[];
  heroCards: Card[];
  pot: number;
  actions: Array<{ playerId: string; label: string }>;
}

const actionLabel: Record<string, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  raise: "加注",
  "all-in": "全下",
};

export const availableHands = (state: TournamentState): number[] =>
  [...new Set(state.events.flatMap((event) => event.handNumber ? [event.handNumber] : []))].sort((a, b) => b - a);

export const buildReplayFrames = (state: TournamentState, handNumber: number, heroId: string): ReplayFrame[] => {
  const events = state.events.filter((event) => event.handNumber === handNumber && event.type !== "state-checkpoint");
  let phase: HandPhase = "preflop";
  let board: Card[] = [];
  let heroCards: Card[] = [];
  let pot = 0;
  const actions: Array<{ playerId: string; label: string }> = [];
  const frames: ReplayFrame[] = [];

  for (const event of events) {
    let label: string = event.type;
    if (event.type === "blind-posted") {
      const amount = Number(event.public.amount ?? 0);
      pot += amount;
      label = `${event.public.kind === "small" ? "小盲" : "大盲"} ${amount}`;
    } else if (event.type === "hole-cards-dealt") {
      if (event.playerId === heroId && Array.isArray(event.private?.cards)) heroCards = event.private.cards as Card[];
      label = "发底牌";
    } else if (event.type === "player-acted") {
      phase = String(event.public.phase ?? phase) as HandPhase;
      const committed = Number(event.public.committed ?? 0);
      pot += committed;
      label = `${actionLabel[String(event.public.action)] ?? event.public.action}${committed > 0 ? ` ${committed}` : ""}`;
      actions.push({ playerId: event.playerId ?? "unknown", label });
    } else if (event.type === "community-cards-dealt") {
      phase = String(event.public.phase ?? phase) as HandPhase;
      board = [...board, ...((event.public.cards as Card[]) ?? [])];
      label = phase === "flop" ? "发翻牌" : phase === "turn" ? "发转牌" : "发河牌";
    } else if (event.type === "pot-awarded") {
      label = `赢得 ${event.public.amount}`;
    } else if (event.type === "uncalled-bet-returned") {
      const amount = Number(event.public.amount ?? 0);
      pot = Math.max(0, pot - amount);
      label = `退回未跟注筹码 ${amount}`;
    } else if (event.type === "hand-completed") {
      phase = "complete";
      label = "本手结算";
    } else if (event.type === "hand-started") label = "开始新手牌";
    frames.push({
      sequence: event.sequence,
      eventType: event.type,
      label,
      phase,
      board: [...board],
      heroCards: [...heroCards],
      pot,
      actions: actions.map((action) => ({ ...action })),
    });
  }
  return frames;
};
