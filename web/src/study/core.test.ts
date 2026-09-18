import { describe, expect, it } from "vitest";
import { parseRange, rangeMatrix, rangeEquity, requiredEquity, terminalCallEV, icmEquities, solveRiver } from "./math";
import { compileScenario, exampleScenario, decisionPoints, decisionContext, forkHand, recordHand, restoreDecision, SeededRandom } from "./scenario";
import { checkAnswer, gradeReference, validateReference } from "./grading";
import { getLegalActions, submitAction } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import type { StrategyReference } from "./model";

describe("range grammar and mathematical assumptions", () => {
  it("expands weighted classes, plus ranges and blockers", () => {
    expect(parseRange("AA")).toHaveLength(6); expect(parseRange("AKs")).toHaveLength(4); expect(parseRange("AKo")).toHaveLength(12);
    expect(parseRange("QQ+")).toHaveLength(18); expect(parseRange("ATs+")).toHaveLength(16);
    expect(parseRange("AA", ["As"])).toHaveLength(3); expect(parseRange("random", ["As", "Kh"])).toHaveLength(1225);
    expect(rangeMatrix().flat()).toHaveLength(169);
    expect(() => parseRange("AA,AA")).toThrow(); expect(() => parseRange("AsAs")).toThrow(); expect(() => parseRange("AKs:0")).toThrow(); expect(() => parseRange("AKs:NaN")).toThrow();
  });
  it("counts an actual third of a three-way tied pot", () => {
    const r = rangeEquity({ hero: ["2c", "3c"], board: ["As", "Ks", "Qs", "Js", "Ts"], ranges: ["4c5c", "6c7c"], samples: 50, seed: 1 });
    expect(r.equity).toBeCloseTo(1 / 3); expect(r.tie).toBe(1); expect(r.margin95).toBeGreaterThan(0);
  });
  it("enumerates exact weighted heads-up river equity", () => {
    const r = rangeEquity({ hero: ["Qs", "Qc"], board: ["Ah", "7d", "2c", "9s", "3h"], ranges: ["AsKh:0.7,JsTs:0.3"], samples: 50, seed: 1 });
    expect(r.equity).toBeCloseTo(0.3); expect(r.exact).toBe(true); expect(r.margin95).toBe(0);
  });
  it("rejects mutually incompatible opponent ranges", () => {
    expect(() => rangeEquity({ hero: ["Qs", "Qc"], board: [], ranges: ["AsKh", "AsKd"], samples: 50, seed: 1 })).toThrow();
  });
  it("uses declared terminal costs and prize units", () => {
    expect(requiredEquity(50, 150)).toBe(0.25); expect(terminalCallEV(0.3, 50, 150)).toBeCloseTo(10);
    expect(() => requiredEquity(-1, 100)).toThrow(); expect(() => terminalCallEV(NaN, 50, 100)).toThrow();
    icmEquities([100, 100, 100], [50, 30, 20]).forEach(n => expect(n).toBeCloseTo(100 / 3));
    expect(icmEquities([200, 100, 50], [100])[0]).toBeCloseTo(200 / 350 * 100);
    expect(() => icmEquities([200, 0], [100])).toThrow();
  });
});

describe("finite river solving", () => {
  const input = { board: ["Ac", "7d", "2c", "9s", "3h"] as const, bettorRange: "AsAd,JsTs", defenderRange: "KsKd", pot: 100, bet: 50, iterations: 4000 };
  it("converges on a two-type bluff game and reports exact best-response bounds", () => {
    const r = solveRiver({ ...input, board: [...input.board] });
    expect(r.lower).toBeLessThanOrEqual(r.value + 1e-6); expect(r.upper).toBeGreaterThanOrEqual(r.value - 1e-6); expect(r.gap).toBeLessThan(1);
    expect(r.bettor.find(x => x.hand === "JsTs")!.bet).toBeCloseTo(1 / 3, 1);
    expect(r.defender[0].call).toBeCloseTo(2 / 3, 1);
  });
  it("labels and bounds a response to a fixed calling opponent", () => {
    const r = solveRiver({ ...input, board: [...input.board], lockedCall: 1 });
    expect(r.bettor.find(x => x.hand === "JsTs")!.bet).toBeLessThan(0.01); expect(r.lower).toBe(r.value);
    expect(r.assumptions).toContain("锁定");
  });
});

describe("scenario compilation and branch integrity", () => {
  it("reuses production transitions with fixed cards and custom stacks", () => {
    const s = exampleScenario("preflop"); s.players[1].stack = 600;
    const state = compileScenario(s);
    expect(state.players.map(p => p.stack)).toEqual([1990, 580]); expect(getLegalActions(state)?.playerId).toBe("hero");
    expect(projectPlayerView(state, "hero").players[1].holeCards).toBeUndefined();
    expect(compileScenario(exampleScenario("flop")).hand?.board).toEqual(["Ah", "9d", "4c"]);
    expect(compileScenario(exampleScenario("river")).hand?.board).toHaveLength(5);
  });
  it("rejects duplicate cards and illegal histories", () => {
    expect(() => compileScenario({ ...exampleScenario(), board: ["As", "9d", "4c"] })).toThrow();
    expect(() => compileScenario({ ...exampleScenario("preflop"), prefix: [{ playerId: "v", action: { type: "fold" } }] })).toThrow();
  });
  it("restores decisions rather than display-only events", () => {
    const state = compileScenario(exampleScenario()); const point = decisionPoints(state.events, "hero").at(-1)!;
    expect(restoreDecision(state.events, point.sequence).hand).toEqual(state.hand); expect(() => restoreDecision(state.events, 1)).toThrow();
  });
  it("resamples private information without modifying facts or creating duplicate event sequences", () => {
    const state = compileScenario(exampleScenario()); const record = recordHand(state, "hero", "play"); const copy = structuredClone(record);
    const point = decisionPoints(record.events, "hero").at(-1)!; const fork = forkHand(record, point.sequence, true, 9881);
    expect(record).toEqual(copy); expect(fork.hand?.board).toEqual(state.hand?.board);
    expect(decisionContext(fork, "hero", "random")).toBe(decisionContext(point.state, "hero", "random"));
    expect(fork.events.some(e => e.type === "hole-cards-dealt" && e.playerId === "v" && e.private)).toBe(false);
    const next = submitAction(fork, "hero", { type: "check" }); expect(next.ok).toBe(true);
    expect(new Set(next.state.events.map(e => e.sequence)).size).toBe(next.state.events.length);
  });
  it("creates independent reproducible random sources", () => { const a = new SeededRandom(42), b = new SeededRandom(42); expect(Array.from({ length: 10 }, () => a.next())).toEqual(Array.from({ length: 10 }, () => b.next())); });
});

describe("reference safety", () => {
  const reference: StrategyReference = { version: 1, id: "r", revision: "v1", context: "x", source: "analytic test", license: "test", assumptions: "terminal", unit: "chips", errorBound: 0.1, actions: [{ key: "call", frequency: 0.5, ev: 1 }, { key: "fold", frequency: 0.5, ev: 0.95 }] };
  it("refuses stale or off-tree reference grades", () => { expect(gradeReference(reference, "changed", { type: "call" }).status).toBe("ungraded"); expect(gradeReference(reference, "x", { type: "raise", to: 100 }).status).toBe("ungraded"); });
  it("does not rank differences below the error bound", () => expect(gradeReference(reference, "x", { type: "fold" }).status).toBe("close"));
  it("validates normalized frequencies and does not coerce an empty numerical answer to zero", () => {
    expect(() => validateReference({ ...reference, actions: [{ key: "call", frequency: 0.2, ev: 1 }] })).toThrow();
    expect(checkAnswer({ id: "n", prompt: "n", hint: "", explanation: "", evidence: "exact", assumptions: "", answer: 0 }, "")).toBe(false);
  });
});
