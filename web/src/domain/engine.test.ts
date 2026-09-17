import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createDeck, SeededRandomSource } from "./cards";
import { compareHands, evaluateHand } from "./evaluator";
import {
  beginNextHand,
  createCashGame,
  createTournament,
  currentBlindLevel,
  defaultBlindLevels,
  endCashGame,
  getLegalActions,
  pauseTournament,
  rebuyCashPlayer,
  resumeTournament,
  submitAction,
} from "./engine";
import { projectPlayerView } from "./view";
import { normalizeGameState, rehydrateTournament } from "./reducer";
import type { Card, CashGameConfig, PlayerConfig, TournamentConfig, TournamentState } from "./types";
import { decideBotAction } from "../bots/bot";

const players = (count: number): PlayerConfig[] => Array.from({ length: count }, (_, seat) => ({
  id: `p${seat}`,
  name: seat === 0 ? "Hero" : `Bot ${seat}`,
  kind: seat === 0 ? "human" : "bot",
  seat,
  difficulty: "normal",
  style: "balanced",
}));

const config = (count = 3, startingStack = 100): TournamentConfig => ({
  mode: "tournament",
  players: players(count),
  startingStack,
  blindLevels: [{ smallBlind: 5, bigBlind: 10, hands: 8 }],
});

const customStacks = (stacks: number[]): TournamentState => {
  const created = createTournament(config(stacks.length, Math.max(...stacks)), new SeededRandomSource(3)).state;
  created.hand = null;
  created.handNumber = 0;
  created.dealerSeat = null;
  created.events = [];
  created.players.forEach((player, index) => { player.stack = stacks[index]; });
  return created;
};

const riggedDeck = (drawOrder: Card[]): Card[] => [
  ...createDeck().filter((card) => !drawOrder.includes(card)),
  ...[...drawOrder].reverse(),
];

const cashConfig = (): CashGameConfig => ({
  mode: "cash",
  players: players(2),
  startingStack: 100,
  smallBlind: 5,
  bigBlind: 10,
  buyIn: 100,
  minBuyIn: 40,
  maxBuyIn: 200,
  botAutoRebuy: true,
});

const completedCashAllIn = (heroWins: boolean): TournamentState => {
  const drawOrder: Card[] = heroWins
    ? ["2c", "As", "2d", "Ah", "3c", "Kc", "Qc", "Jd", "4c", "9h", "5c", "7s"]
    : ["As", "2c", "Ah", "2d", "3c", "Kc", "Qc", "Jd", "4c", "9h", "5c", "7s"];
  let state = createCashGame(cashConfig(), new SeededRandomSource(31), riggedDeck(drawOrder)).state;
  let result = submitAction(state, "p0", { type: "all-in" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  state = result.state;
  result = submitAction(state, "p1", { type: "call" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};

describe("cash-game lifecycle", () => {
  it("uses fixed blinds, keeps busted players uneliminated, and auto-rebuys bots", () => {
    const completed = completedCashAllIn(true);
    expect(completed.hand?.phase).toBe("complete");
    expect(completed.players.find((player) => player.id === "p1")?.stack).toBe(0);
    expect(completed.players.every((player) => !player.eliminated)).toBe(true);
    expect(completed.status).toBe("playing");

    const next = beginNextHand(completed, new SeededRandomSource(32)).state;
    expect(currentBlindLevel(next)).toMatchObject({ smallBlind: 5, bigBlind: 10 });
    expect(next.blindLevelIndex).toBe(0);
    expect(next.players.find((player) => player.id === "p1")?.stack).toBe(95);
    expect(next.cashSession?.ledgers.p1).toMatchObject({ totalBuyIn: 200, rebuyCount: 1 });
    expect(next.events.some((event) => event.type === "cash-player-rebought" && event.playerId === "p1" && event.public.automatic === true)).toBe(true);
  });

  it("blocks a busted human until rebuy and records the added buy-in", () => {
    const completed = completedCashAllIn(false);
    expect(completed.players.find((player) => player.id === "p0")?.stack).toBe(0);
    expect(() => beginNextHand(completed, new SeededRandomSource(33))).toThrow(/重新买入/);

    const rebought = rebuyCashPlayer(completed, "p0").state;
    expect(rebought.players.find((player) => player.id === "p0")?.stack).toBe(100);
    expect(rebought.cashSession?.ledgers.p0).toMatchObject({ totalBuyIn: 200, rebuyCount: 1 });
    expect(beginNextHand(rebought, new SeededRandomSource(34)).state.handNumber).toBe(2);
  });

  it("ends only between hands and preserves cash-session results", () => {
    const active = createCashGame(cashConfig(), new SeededRandomSource(30)).state;
    expect(() => endCashGame(active)).toThrow(/本手结束后/);
    const completed = completedCashAllIn(false);
    const ended = endCashGame(completed).state;
    const hero = ended.players.find((player) => player.id === "p0")!;
    const buyIn = ended.cashSession?.ledgers.p0.totalBuyIn ?? 0;
    expect(ended.status).toBe("finished");
    expect(ended.championId).toBeUndefined();
    expect(hero.stack - buyIn).toBe(-100);
    expect(ended.cashSession?.endedAt).toBeTypeOf("number");
    expect(() => endCashGame(ended)).toThrow(/already ended/);
  });

  it("migrates legacy states without a mode to tournament mode", () => {
    const state = createTournament(config(2), new SeededRandomSource(35)).state;
    const legacy = structuredClone(state) as TournamentState;
    delete (legacy.config as unknown as { mode?: string }).mode;
    expect(normalizeGameState(legacy).config.mode).toBe("tournament");
  });
});

describe("hand evaluator adapter", () => {
  it("recognizes a royal flush and compares it correctly", () => {
    const royal = ["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"] as const;
    const quads = ["Ah", "Ad", "Ac", "As", "9d", "2c", "3h"] as const;
    expect(evaluateHand(royal).name).toMatch(/Straight Flush|Royal Flush/);
    expect(compareHands(royal, quads)).toBe(1);
  });

  it("returns all five cards for an ace-low straight", () => {
    const wheel = ["As", "4c", "5d", "2h", "3c", "9c", "5h"] as const;
    const evaluated = evaluateHand(wheel);

    expect(evaluated.name).toBe("Straight");
    expect(evaluated.bestFive).toHaveLength(5);
    expect(evaluated.bestFive).toEqual(["5d", "4c", "3c", "2h", "As"]);
  });

  it("returns the ace for an ace-low straight flush", () => {
    const wheelFlush = ["As", "2s", "3s", "4s", "5s", "9c", "Th"] as const;
    const evaluated = evaluateHand(wheelFlush);

    expect(evaluated.name).toBe("Straight Flush");
    expect(evaluated.bestFive).toEqual(["5s", "4s", "3s", "2s", "As"]);
  });
});

describe("tournament engine", () => {
  it("uses the correct heads-up blind and preflop action order", () => {
    const state = createTournament(config(2), new SeededRandomSource(1)).state;
    expect(state.hand?.dealerSeat).toBe(0);
    expect(state.hand?.smallBlindSeat).toBe(0);
    expect(state.hand?.bigBlindSeat).toBe(1);
    expect(state.hand?.currentPlayerSeat).toBe(0);
  });

  it("rotates the dealer position between hands", () => {
    let state = createTournament(config(3), new SeededRandomSource(5)).state;
    expect(state.hand?.dealerSeat).toBe(0);
    let result = submitAction(state, "p0", { type: "fold" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p1", { type: "fold" });
    expect(result.ok).toBe(true);
    state = result.state;

    state = beginNextHand(state, new SeededRandomSource(6)).state;

    expect(state.hand?.dealerSeat).toBe(1);
    expect(state.hand?.smallBlindSeat).toBe(2);
    expect(state.hand?.bigBlindSeat).toBe(0);
  });

  it("does not mutate state when an illegal action is submitted", () => {
    const state = createTournament(config(3), new SeededRandomSource(2)).state;
    const snapshot = structuredClone(state);
    const result = submitAction(state, "p1", { type: "raise", to: 50 });
    expect(result.ok).toBe(false);
    expect(result.state).toEqual(snapshot);
  });

  it("settles immediately when everyone else folds", () => {
    let state = createTournament(config(3), new SeededRandomSource(4)).state;
    expect(getLegalActions(state)?.playerId).toBe("p0");
    let result = submitAction(state, "p0", { type: "fold" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p1", { type: "fold" });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.hand?.phase).toBe("complete");
    expect(state.hand?.winners[0].playerId).toBe("p2");
    expect(state.hand?.reachedShowdown).toBe(false);
    expect(projectPlayerView(state, "p0").players.find((player) => player.id === "p2")?.holeCards).toBeUndefined();
    expect(projectPlayerView(state, "p2").players.find((player) => player.id === "p0")?.holeCards).toBeUndefined();
    expect(projectPlayerView(state, "p2", { revealMuckedCards: true }).players.find((player) => player.id === "p0")?.holeCards).toHaveLength(2);
    expect(projectPlayerView(state, "p0", { revealMuckedCards: true }).players.find((player) => player.id === "p1")?.holeCards).toBeUndefined();
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(300);
  });

  it("builds main and side pots for unequal all-ins", () => {
    let state = beginNextHand(customStacks([50, 100, 200]), new SeededRandomSource(9)).state;
    let result = submitAction(state, "p0", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p1", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p2", { type: "call" });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.hand?.phase).toBe("complete");
    expect(state.hand?.pots.map((pot) => pot.amount)).toEqual([150, 100]);
    expect(state.hand?.winners.reduce((sum, winner) => sum + winner.amount, 0)).toBe(250);
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(350);
  });

  it("returns an unmatched overbet instead of counting it as a won pot", () => {
    let state = beginNextHand(customStacks([200, 100, 50]), new SeededRandomSource(19)).state;
    let result = submitAction(state, "p0", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p1", { type: "fold" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p2", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    const refund = state.events.find((event) => event.type === "uncalled-bet-returned");
    expect(refund?.playerId).toBe("p0");
    expect(refund?.public.amount).toBe(150);
    expect(state.hand?.players.find((player) => player.playerId === "p0")?.totalContribution).toBe(50);
    expect(state.hand?.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(105);
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(350);
  });

  it("splits a tied odd pot clockwise from the dealer", () => {
    const drawOrder: Card[] = [
      "2c", "4d", "6h", "3c", "5d", "7h", // hole cards: seats 1, 2, 0
      "8c", "As", "Ks", "Qs", // burn + flop
      "9c", "Js", // burn + turn
      "Td", "Ts", // burn + river
    ];
    let state = createTournament(config(3, 100), new SeededRandomSource(1), riggedDeck(drawOrder)).state;
    const act = (playerId: string, action: Parameters<typeof submitAction>[2]) => {
      const result = submitAction(state, playerId, action);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    };
    act("p0", { type: "call" });
    act("p1", { type: "fold" });
    act("p2", { type: "check" });
    for (let street = 0; street < 3; street += 1) {
      act("p1" === getLegalActions(state)?.playerId ? "p1" : "p2", { type: "check" });
      act("p0", { type: "check" });
    }
    expect(state.hand?.board).toEqual(["As", "Ks", "Qs", "Js", "Ts"]);
    expect(state.hand?.reachedShowdown).toBe(true);
    expect(projectPlayerView(state, "p0").players.find((player) => player.id === "p2")?.holeCards).toHaveLength(2);
    expect(state.hand?.winners).toEqual([
      expect.objectContaining({ playerId: "p2", amount: 13, handName: expect.stringMatching(/Straight Flush|Royal Flush/), bestFive: ["As", "Ks", "Qs", "Js", "Ts"] }),
      expect.objectContaining({ playerId: "p0", amount: 12, handName: expect.stringMatching(/Straight Flush|Royal Flush/), bestFive: ["As", "Ks", "Qs", "Js", "Ts"] }),
    ]);
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(300);
  });

  it("does not reopen raising after a short all-in", () => {
    let state = beginNextHand(customStacks([100, 55, 100]), new SeededRandomSource(11)).state;
    let result = submitAction(state, "p0", { type: "raise", to: 40 });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p1", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p2", { type: "call" });
    expect(result.ok).toBe(true);
    state = result.state;
    const legal = getLegalActions(state);
    expect(legal?.playerId).toBe("p0");
    expect(legal?.toCall).toBe(15);
    expect(legal?.canRaise).toBe(false);
    expect(legal?.canAllIn).toBe(false);
  });

  it("reopens raising after cumulative short all-ins equal a full raise", () => {
    let state = beginNextHand(customStacks([50, 60, 70, 200, 200]), new SeededRandomSource(17)).state;
    let result = submitAction(state, "p3", { type: "raise", to: 40 });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p4", { type: "call" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p0", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p1", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    result = submitAction(state, "p2", { type: "all-in" });
    expect(result.ok).toBe(true);
    state = result.state;
    const legal = getLegalActions(state);
    expect(legal?.playerId).toBe("p3");
    expect(legal?.toCall).toBe(30);
    expect(legal?.canRaise).toBe(true);
  });

  it("never exposes another live player's hole cards", () => {
    const state = createTournament(config(3), new SeededRandomSource(7)).state;
    const view = projectPlayerView(state, "p0");
    expect(view.players.find((player) => player.id === "p0")?.holeCards).toHaveLength(2);
    expect(view.players.find((player) => player.id === "p1")?.holeCards).toBeUndefined();
    expect(view.players.find((player) => player.id === "p2")?.holeCards).toBeUndefined();
  });

  it("provides a practical standard blind schedule", () => {
    const levels = defaultBlindLevels("standard");
    expect(levels[0]).toEqual({ smallBlind: 10, bigBlind: 20, hands: 8 });
    expect(levels.at(-1)?.bigBlind).toBeGreaterThan(levels[0].bigBlind);
  });

  it("rebuilds the exact current state from its event journal", () => {
    let state = createTournament(config(4), new SeededRandomSource(29)).state;
    for (let step = 0; step < 12 && state.hand?.phase !== "complete"; step += 1) {
      const actor = state.players.find((player) => player.seat === state.hand?.currentPlayerSeat)!;
      const result = submitAction(
        state,
        actor.id,
        decideBotAction(projectPlayerView(state, actor.id), "normal", "balanced", new SeededRandomSource(step + 100)),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expect(rehydrateTournament(state.events)).toEqual(state);
  });

  it("pauses without allowing an action and resumes from the same turn", () => {
    const playing = createTournament(config(3), new SeededRandomSource(31)).state;
    const actorId = getLegalActions(playing)?.playerId;
    const paused = pauseTournament(playing).state;
    expect(paused.status).toBe("paused");
    expect(getLegalActions(paused)).toBeNull();
    expect(submitAction(paused, actorId!, { type: "fold" }).ok).toBe(false);
    const resumed = resumeTournament(paused).state;
    expect(resumed.status).toBe("playing");
    expect(getLegalActions(resumed)?.playerId).toBe(actorId);
    expect(rehydrateTournament(resumed.events)).toEqual(resumed);
  });

  it("finishes seeded six-player tournaments without losing chips or deadlocking", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = new SeededRandomSource(seed * 97);
      let state = createTournament({
        mode: "tournament",
        players: players(6).map((player) => ({ ...player, kind: "bot" })),
        startingStack: 300,
        blindLevels: defaultBlindLevels("fast").map((level) => ({ ...level, hands: 2 })),
      }, random).state;
      const totalChips = 1800;
      let guard = 0;
      while (state.status !== "finished" && guard < 10_000) {
        guard += 1;
        if (state.hand?.phase === "complete") {
          expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(totalChips);
          state = beginNextHand(state, random).state;
          continue;
        }
        const seat = state.hand?.currentPlayerSeat;
        expect(seat).not.toBeNull();
        const actor = state.players.find((player) => player.seat === seat)!;
        const view = projectPlayerView(state, actor.id);
        const action = decideBotAction(view, "normal", "balanced", random);
        const result = submitAction(state, actor.id, action);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        state = result.state;
        if (state.hand?.phase !== "complete") {
          const stacks = state.players.reduce((sum, player) => sum + player.stack, 0);
          const committed = state.hand?.players.reduce((sum, player) => sum + player.totalContribution, 0) ?? 0;
          expect(stacks + committed).toBe(totalChips);
        }
      }
      expect(guard).toBeLessThan(10_000);
      expect(state.status).toBe("finished");
      expect(state.players.filter((player) => !player.eliminated)).toHaveLength(1);
      expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(totalChips);
    }
  }, 20_000);

  it("preserves tournament invariants across generated table sizes and seeds", () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 9 }),
      fc.integer({ min: 1, max: 1_000_000 }),
      (playerCount, seed) => {
        const random = new SeededRandomSource(seed);
        const totalChips = playerCount * 240;
        let state = createTournament({
          mode: "tournament",
          players: players(playerCount).map((player) => ({ ...player, kind: "bot" })),
          startingStack: 240,
          blindLevels: defaultBlindLevels("fast").map((level) => ({ ...level, hands: 1 })),
        }, random).state;
        let guard = 0;
        while (state.status !== "finished" && guard < 6000) {
          guard += 1;
          if (state.hand?.phase === "complete") state = beginNextHand(state, random).state;
          else {
            const actor = state.players.find((player) => player.seat === state.hand?.currentPlayerSeat)!;
            const result = submitAction(state, actor.id, decideBotAction(projectPlayerView(state, actor.id), "normal", "balanced", random));
            if (!result.ok) throw new Error(`illegal bot action at guard ${guard}: ${result.error.message}`);
            state = result.state;
          }
          const visibleCards = [
            ...(state.hand?.board ?? []),
            ...(state.hand?.players.flatMap((player) => player.holeCards) ?? []),
            ...(state.hand?.deck ?? []),
          ];
          if (new Set(visibleCards).size !== visibleCards.length) throw new Error(`duplicate card at guard ${guard}`);
          if (state.hand?.phase === "complete") {
            const total = state.players.reduce((sum, player) => sum + player.stack, 0);
            if (total !== totalChips) throw new Error(`chip loss after hand at guard ${guard}: ${total} != ${totalChips}; ${JSON.stringify({ players: state.players.map((player) => ({ id: player.id, stack: player.stack })), pots: state.hand?.pots, winners: state.hand?.winners, contributions: state.hand?.players.map((player) => ({ id: player.playerId, total: player.totalContribution, folded: player.folded })) })}`);
          } else {
            const stacks = state.players.reduce((sum, player) => sum + player.stack, 0);
            const committed = state.hand?.players.reduce((sum, player) => sum + player.totalContribution, 0) ?? 0;
            if (stacks + committed !== totalChips) throw new Error(`chip loss during hand at guard ${guard}: ${stacks}+${committed} != ${totalChips}`);
          }
        }
        if (guard >= 6000) throw new Error("simulation guard exhausted");
        return state.status === "finished" && state.players.filter((player) => !player.eliminated).length === 1;
      },
    ), { numRuns: 30, examples: [[7, 999997]] });
  }, 30_000);
});
