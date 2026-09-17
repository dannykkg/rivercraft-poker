import { describe, expect, it } from "vitest";
import { SeededRandomSource } from "../domain/cards";
import { createTournament, submitAction } from "../domain/engine";
import type { PlayerConfig } from "../domain/types";
import { availableHands, buildReplayFrames } from "./replay";
import { calculatePlayerStats } from "./stats";

const players: PlayerConfig[] = [
  { id: "hero", name: "Hero", kind: "human", seat: 0 },
  { id: "bot-1", name: "Bot 1", kind: "bot", seat: 1, difficulty: "normal", style: "balanced" },
  { id: "bot-2", name: "Bot 2", kind: "bot", seat: 2, difficulty: "normal", style: "balanced" },
];

describe("history projections", () => {
  it("builds public replay frames and basic player statistics", () => {
    let state = createTournament({
      mode: "tournament",
      players,
      startingStack: 200,
      blindLevels: [{ smallBlind: 5, bigBlind: 10, hands: 8 }],
    }, new SeededRandomSource(23)).state;
    const first = submitAction(state, "hero", { type: "call" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const second = submitAction(state, "bot-1", { type: "fold" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    state = second.state;
    const frames = buildReplayFrames(state, 1, "hero");
    expect(availableHands(state)).toEqual([1]);
    expect(frames.length).toBeGreaterThan(4);
    expect(frames.some((frame) => frame.heroCards.length === 2)).toBe(true);
    expect(frames.at(-1)?.actions.some((action) => action.playerId === "hero" && action.label.includes("跟注"))).toBe(true);
    const stats = calculatePlayerStats(state, "hero");
    expect(stats.hands).toBe(1);
    expect(stats.vpipHands).toBe(1);
    expect(stats.pfrHands).toBe(0);
  });
});
