import { describe, expect, it } from "vitest";
import { candidateActions, compareActions } from "./rollout";
import { compileScenario, decisionPoints, exampleScenario, recordHand } from "./scenario";

describe("counterfactual fixed-policy evaluation", () => {
  it("uses common unknown-card samples without mutating original facts", () => {
    const scenario = exampleScenario("river"); scenario.board = ["As", "Ks", "Qs", "Js", "Ts"]; scenario.players[0].cards = ["2c", "3c"];
    scenario.prefix[scenario.prefix.length - 1] = { playerId: "v", action: { type: "raise", to: 60 } };
    const state = compileScenario(scenario); const record = recordHand(state, "hero", "lab"); const copy = structuredClone(record);
    const point = decisionPoints(record.events, "hero").at(-1)!;
    const result = compareActions({ record, sequence: point.sequence, actions: [{ type: "fold" }, { type: "call" }], trials: 10, seed: 42 });
    expect(result.actions[0].mean).toBe(0); expect(result.actions[1].mean).toBe(60); expect(result.actions[1].standardError).toBe(0);
    expect(result.actions[1].lower95).toBeLessThan(result.actions[1].mean); expect(record).toEqual(copy);
    expect(result.assumptions).toContain("不是 GTO");
  });
  it("does not condition the estimate on recorded opponent hole cards or unrevealed runout", () => {
    const a = exampleScenario("flop"), b = exampleScenario("flop"); a.players[1].cards = ["Qs", "Qc"]; b.players[1].cards = ["7h", "8h"];
    const run = (s: typeof a) => { const state = compileScenario(s); const record = recordHand(state, "hero", "lab"); return compareActions({ record, sequence: decisionPoints(record.events, "hero").at(-1)!.sequence, actions: [{ type: "check" }], trials: 10, seed: 123 }); };
    expect(run(a).actions).toEqual(run(b).actions);
  });
  it("validates candidates and sample limits before simulation", () => {
    const state = compileScenario(exampleScenario()); const record = recordHand(state, "hero", "lab"); const sequence = decisionPoints(record.events, "hero").at(-1)!.sequence;
    expect(candidateActions(state, "hero").length).toBeGreaterThan(1);
    expect(() => compareActions({ record, sequence, actions: [{ type: "raise", to: 1 }], trials: 10, seed: 1 })).toThrow();
    expect(() => compareActions({ record, sequence, actions: [{ type: "check" }], trials: 0, seed: 1 })).toThrow();
    expect(() => compareActions({ record, sequence: 1, actions: [{ type: "check" }], trials: 10, seed: 1 })).toThrow();
  });
});
