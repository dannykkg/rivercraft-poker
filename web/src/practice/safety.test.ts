import { describe, expect, it } from "vitest";
import { getLegalActions } from "../domain/engine";
import { createSession, playAction, continueSession, resultOf } from "./runner";
import { evaluateDecision } from "./feedback";
import { validateSession } from "./storage";
import type { Session } from "./model";
const finish = (initial: Session): Session => {
  let s = initial;
  for (let i = 0; i < 128; i++) {
    if (s.status === "complete") return s;
    const l = getLegalActions(s.state);
    s = s.status === "feedback" ? continueSession(s) : playAction(s, l?.canCheck ? { type: "check" } : { type: "call" });
  }
  throw new Error("Session did not terminate");
};
describe("grading and restore regression boundaries", () => {
  it("does not reward oversized preflop shoves as normal opening sizes", () => {
    const s = createSession("btn-open", 0, "spot", "guided", [], 8);
    expect(evaluateDecision(s, s.state, { type: "all-in" }).verdict).toBe("deviation");
    expect(evaluateDecision(s, s.state, { type: "raise", to: 60 }).verdict).toBe("aligned");
  });
  it("rejects running-state tampering even when embedded event checkpoints remain intact", () => {
    const s = createSession("btn-open", 0, "hand", "guided", [], 44);
    const modified = structuredClone(s); modified.state.hand!.board = ["2c", "3c", "4c"];
    expect(() => validateSession(modified)).toThrow(/检查点/);
  });
  it("does not allow imported teaching feedback to pretend it has a numeric EV", () => {
    const s = finish(createSession("btn-open", 0, "spot", "guided", [], 44));
    s.decisions[0].feedback.evLoss = 10; s.decisions[0].feedback.unit = "chips";
    expect(() => validateSession(s)).toThrow(/收益/);
  });
  it("does not lengthen review intervals simply by saving a completed attempt twice", () => {
    const s = finish(createSession("river-price", 1, "spot", "assessment", [], 1));
    const first = resultOf(s);
    expect(resultOf(s, [first]).dueAt).toBe(first.dueAt);
  });
  it("never assigns a stale root answer to changed public context", () => {
    const s = createSession("cbet-boards", 0, "spot", "guided", [], 7);
    const changed = structuredClone(s.state); changed.hand!.board[0] = "2h";
    expect(evaluateDecision(s, changed, { type: "check" }).kind).toBe("ungraded");
  });
  it("has true negative and positive terminal decisions, not an always-call exercise", () => {
    const low = createSession("river-price", 0, "spot", "guided", [], 1);
    const high = createSession("river-price", 1, "spot", "guided", [], 1);
    expect(evaluateDecision(low, low.state, { type: "fold" }).verdict).toBe("aligned");
    expect(evaluateDecision(low, low.state, { type: "call" }).evLoss).toBeGreaterThan(0);
    expect(evaluateDecision(high, high.state, { type: "call" }).verdict).toBe("aligned");
  });
});
