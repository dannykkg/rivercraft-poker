import { getLegalActions } from "./engine";
import type { PlayerView, TournamentState } from "./types";

export const projectPlayerView = (state: TournamentState, heroId: string): PlayerView => {
  const hero = state.players.find((player) => player.id === heroId);
  if (!hero) throw new Error(`Unknown player ${heroId}.`);
  const legal = getLegalActions(state);
  const showdown = state.hand?.reachedShowdown === true;
  return {
    tournamentId: state.id,
    status: state.status,
    handNumber: state.handNumber,
    blindLevel: state.config.blindLevels[state.blindLevelIndex],
    heroId,
    players: state.players.map((player) => {
      const handPlayer = state.hand?.players.find((candidate) => candidate.playerId === player.id);
      const reveal = player.id === heroId || Boolean(showdown && handPlayer && !handPlayer.folded);
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        stack: player.stack,
        eliminated: player.eliminated,
        folded: handPlayer?.folded,
        allIn: handPlayer?.allIn,
        streetContribution: handPlayer?.streetContribution,
        totalContribution: handPlayer?.totalContribution,
        ...(reveal && handPlayer ? { holeCards: [...handPlayer.holeCards] } : {}),
      };
    }),
    hand: state.hand ? {
      phase: state.hand.phase,
      dealerSeat: state.hand.dealerSeat,
      smallBlindSeat: state.hand.smallBlindSeat,
      bigBlindSeat: state.hand.bigBlindSeat,
      currentPlayerSeat: state.hand.currentPlayerSeat,
      board: [...state.hand.board],
      currentBet: state.hand.currentBet,
      potTotal: state.hand.players.reduce((total, player) => total + player.totalContribution, 0),
      pots: clonePots(state.hand.pots),
      winners: state.hand.winners.map((winner) => ({ ...winner, ...(winner.bestFive ? { bestFive: [...winner.bestFive] } : {}) })),
    } : null,
    legalActions: legal?.playerId === heroId ? legal : null,
  };
};

const clonePots = (pots: TournamentState["hand"] extends infer _ ? NonNullable<TournamentState["hand"]>["pots"] : never) =>
  pots.map((pot) => ({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] }));
