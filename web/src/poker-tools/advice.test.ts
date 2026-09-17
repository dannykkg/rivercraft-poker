import { describe, expect, it } from "vitest";
import { buildPokerAdvice } from "./advice";

const legal = {
  playerId: "hero", seat: 0, toCall: 50, canFold: true, canCheck: false, canCall: true,
  callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 1000, canAllIn: true,
};

describe("poker advice", () => {
  it("folds when effective equity does not cover the pot odds", () => {
    expect(buildPokerAdvice({ win: 0.12, tie: 0.02, loss: 0.86, samples: 500 }, legal, 100)?.action).toBe("弃牌");
  });

  it("raises a strong hand when raising is legal", () => {
    expect(buildPokerAdvice({ win: 0.78, tie: 0.02, loss: 0.2, samples: 500 }, legal, 300)?.action).toBe("加注");
  });

  it("checks without a forced investment", () => {
    expect(buildPokerAdvice({ win: 0.42, tie: 0.03, loss: 0.55, samples: 500 }, { ...legal, toCall: 0, canFold: false, canCheck: true, canCall: false }, 200)?.action).toBe("过牌");
  });
});
