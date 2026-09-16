import type { TournamentState } from "../domain/types";

export interface PlayerStats {
  hands: number;
  vpipHands: number;
  pfrHands: number;
  potsWon: number;
  netChips: number;
  vpip: number;
  pfr: number;
}

export const calculatePlayerStats = (state: TournamentState, playerId: string): PlayerStats => {
  const dealtHands = new Set<number>();
  const vpipHands = new Set<number>();
  const pfrHands = new Set<number>();
  const wonHands = new Set<number>();
  for (const event of state.events) {
    if (!event.handNumber) continue;
    if (event.type === "hole-cards-dealt" && event.playerId === playerId) dealtHands.add(event.handNumber);
    if (event.type === "player-acted" && event.playerId === playerId && event.public.phase === "preflop") {
      const action = String(event.public.action);
      if (["call", "raise", "all-in"].includes(action) && Number(event.public.committed ?? 0) > 0) vpipHands.add(event.handNumber);
      if (["raise", "all-in"].includes(action) && Number(event.public.to ?? 0) > 0) pfrHands.add(event.handNumber);
    }
    if (event.type === "pot-awarded" && event.playerId === playerId) wonHands.add(event.handNumber);
  }
  const hands = dealtHands.size;
  const player = state.players.find((candidate) => candidate.id === playerId);
  const initial = state.config.startingStack;
  return {
    hands,
    vpipHands: vpipHands.size,
    pfrHands: pfrHands.size,
    potsWon: wonHands.size,
    netChips: (player?.stack ?? initial) - initial,
    vpip: hands > 0 ? vpipHands.size / hands : 0,
    pfr: hands > 0 ? pfrHands.size / hands : 0,
  };
};
