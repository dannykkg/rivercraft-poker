import { describe, expect, it } from "vitest";
import { SeededRandomSource } from "../domain/cards";
import { calculatePotOdds, estimateEquity } from "./equity";

describe("poker tools", () => {
  it("calculates exact pot odds", () => {
    expect(calculatePotOdds(25, 75)).toBe(0.25);
    expect(calculatePotOdds(0, 100)).toBe(0);
  });

  it("returns a deterministic normalized equity estimate with a seeded source", () => {
    const first = estimateEquity(["As", "Ah"], ["2c", "7d", "9h"], 2, 200, new SeededRandomSource(42));
    const second = estimateEquity(["As", "Ah"], ["2c", "7d", "9h"], 2, 200, new SeededRandomSource(42));
    expect(first).toEqual(second);
    expect(first.win + first.tie + first.loss).toBeCloseTo(1, 10);
    expect(first.samples).toBe(200);
  });
});
