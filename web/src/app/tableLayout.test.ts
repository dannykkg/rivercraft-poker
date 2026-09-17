import { describe, expect, it } from "vitest";
import { visualPlayersBySeat } from "./tableLayout";

describe("table layout", () => {
  it("anchors the human player at the bottom-center visual seat", () => {
    const players = [
      { id: "bot-1", seat: 0 },
      { id: "bot-2", seat: 1 },
      { id: "bot-3", seat: 2 },
      { id: "bot-4", seat: 3 },
      { id: "hero", seat: 4 },
      { id: "bot-5", seat: 5 },
    ];

    const seats = visualPlayersBySeat(players, "hero");

    expect(seats[0]?.id).toBe("hero");
    expect(seats.filter(Boolean).map((player) => player?.id)).toEqual([
      "hero", "bot-5", "bot-1", "bot-2", "bot-3", "bot-4",
    ]);
  });
});
