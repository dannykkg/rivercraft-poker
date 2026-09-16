import { describe, expect, it } from "vitest";
import { SeededRandomSource } from "../domain/cards";
import type { PlayerView } from "../domain/types";
import { decideBotAction } from "./bot";

const view: PlayerView = {
  tournamentId: "t1",
  status: "playing",
  handNumber: 1,
  blindLevel: { smallBlind: 5, bigBlind: 10, hands: 8 },
  heroId: "bot",
  players: [
    { id: "bot", name: "Bot", seat: 0, stack: 100, eliminated: false, holeCards: ["As", "7s"] },
    { id: "villain", name: "Villain", seat: 1, stack: 100, eliminated: false },
  ],
  hand: {
    phase: "preflop", dealerSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1,
    currentPlayerSeat: 0, board: [], currentBet: 10, potTotal: 15, pots: [], winners: [],
  },
  legalActions: {
    playerId: "bot", seat: 0, toCall: 0, canFold: false, canCheck: true, canCall: false,
    callAmount: 0, canRaise: true, minRaiseTo: 20, maxRaiseTo: 100, canAllIn: true,
  },
};

describe("algorithm bot profiles", () => {
  it("makes the aggressive style observably more raise-heavy than the tight style", () => {
    const raiseRate = (style: "tight" | "aggressive") => Array.from({ length: 200 }, (_, seed) =>
      decideBotAction(view, "normal", style, new SeededRandomSource(seed + 1)).type,
    ).filter((action) => action === "raise" || action === "all-in").length;
    expect(raiseRate("aggressive")).toBeGreaterThan(raiseRate("tight") + 100);
  });
});
