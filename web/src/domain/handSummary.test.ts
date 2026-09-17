import { describe, expect, it } from "vitest";
import { summarizeCurrentHand } from "./handSummary";

describe("current hand summary", () => {
  it("describes the live hand as community cards arrive", () => {
    expect(summarizeCurrentHand(["As", "4c"], [])).toMatchObject({ stage: "起手牌", label: "A 高" });
    expect(summarizeCurrentHand(["As", "4c"], ["Kd", "8h", "2c", "7s"])).toMatchObject({ stage: "转牌", label: "高牌 A" });
    expect(summarizeCurrentHand(["As", "4c"], ["Kd", "8h", "2c", "7s", "4d"])).toMatchObject({ stage: "河牌", label: "一对 4" });
  });

  it("describes an ace-low straight with five cards", () => {
    expect(summarizeCurrentHand(["As", "4c"], ["5d", "2h", "3c"]))
      .toEqual({ stage: "翻牌", label: "顺子 · 5 高", bestFive: ["5d", "4c", "3c", "2h", "As"] });
  });
});
