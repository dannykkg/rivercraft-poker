import { describe, expect, it } from "vitest";
import { solveRiver } from "../../study/math";
import { HAND_CLASSES, WORKSHOP_TASKS, WORKSHOP_VERSION, EXECUTION_ROUNDS, comboCount, rangeClasses, gradeRange, polarizedReference, newWorkshop, finishWorkshop, frequencySummary, validateWorkshop, taskById, type FrequencyTask, type RangeTask } from "./model";
import { validateWorkshopBackup } from "./storage";

const range = taskById("core-range-0") as RangeTask;
const frequency = taskById("polarized-0-bluffer") as FrequencyTask;
const finishedFrequency = () => finishWorkshop({ ...newWorkshop(frequency.id), frequency: "50", actions: Array.from({ length: EXECUTION_ROUNDS }, (_, i) => i % 2 ? "commit" : "pass") });
const backup = () => { const s = finishedFrequency(); return { format: "rivercraft-practice-workshops", version: 1, contentVersion: WORKSHOP_VERSION, exportedAt: 1, current: s, records: [s], exposures: [] }; };

describe("full 169-class range construction", () => {
  it("covers all 1326 unordered starting combinations without weighting classes equally", () => {
    expect(HAND_CLASSES).toHaveLength(169); expect(new Set(HAND_CLASSES).size).toBe(169);
    expect(HAND_CLASSES.reduce((n, hand) => n + comboCount(hand), 0)).toBe(52 * 51 / 2);
    expect(rangeClasses("AA,AKs,AKo")).toEqual(["AA", "AKs", "AKo"]);
  });
  it("expands teaching baselines and reports missing/excess instead of universal EV errors", () => {
    const expected = rangeClasses(range.target); expect(gradeRange(range, expected).exact).toBe(true);
    const result = gradeRange(range, ["AA", "72o"]);
    expect(result.selectedCombos).toBe(18); expect(result.excess).toEqual(["72o"]);
    expect(result.missing).toContain("KK"); expect(result).not.toHaveProperty("evLoss");
  });
  it("rejects invalid or partial combinations that a full-class grid cannot represent", () => {
    expect(() => rangeClasses("AsKh")).toThrow(/整类/);
    expect(() => rangeClasses("AKs:0.5")).toThrow(/权重/);
    expect(() => gradeRange(range, ["AA", "AA"])).toThrow();
    expect(() => comboCount("KKs")).toThrow();
  });
});
describe("restricted polarized river mixing, independently checkable indifference", () => {
  it("distinguishes weak-hand bet frequency from bluff share of the betting range", () => {
    const result = polarizedReference(frequency);
    expect(result.bluffFrequency).toBeCloseTo(.5); expect(result.callFrequency).toBeCloseTo(2/3);
    expect(result.bettingBluffShare).toBeCloseTo(.25);
  });
  it("makes both players indifferent throughout every published model", () => {
    for (const task of WORKSHOP_TASKS) if (task.kind === "frequency") {
      const r = polarizedReference(task);
      expect(r.bluffBetEV).toBeCloseTo(0, 10); expect(r.catcherCallEV).toBeCloseTo(0, 10);
      expect(r.bluffFrequency).toBeGreaterThan(0); expect(r.bluffFrequency).toBeLessThan(1);
      expect(r.callFrequency).toBeGreaterThan(0); expect(r.callFrequency).toBeLessThan(1);
    }
  });
  it("matches an independently iterated finite-card CFR model without blockers", () => {
    const solution = solveRiver({ board: ["2h", "3d", "5c", "9s", "Jc"], bettorRange: "AA,KK,T8s,T7s", defenderRange: "QQ", pot: 100, bet: 50, iterations: 5000 });
    const bluffs = solution.bettor.filter(row => row.hand.startsWith("T"));
    expect(bluffs).toHaveLength(8);
    expect(bluffs.reduce((n, row) => n + row.bet, 0) / bluffs.length).toBeCloseTo(.5, 1);
    expect(solution.defender.reduce((n, row) => n + row.call, 0) / solution.defender.length).toBeCloseTo(2/3, 1);
    expect(solution.gap).toBeLessThan(.5);
  });
  it("rejects boundary cases rather than clamping them into fictitious mixed strategies", () => {
    expect(() => polarizedReference({ ...frequency, bluffs: 1 })).toThrow(/内部混合/);
    expect(() => polarizedReference({ ...frequency, pot: NaN })).toThrow();
  });
  it("separates planned and executed frequencies without assigning single-action EV penalties", () => {
    const result = frequencySummary(frequency, finishedFrequency());
    expect(result.target).toBeCloseTo(.5); expect(result.actual).toBe(.5); expect(result.planned).toBe(.5);
    expect(result).not.toHaveProperty("passed"); expect(result).not.toHaveProperty("evLoss");
  });
});
describe("versioned workshop records and import boundaries", () => {
  it("requires an explicit frequency plan and 24 choices to complete a frequency session", () => {
    expect(() => finishWorkshop(newWorkshop(frequency.id))).toThrow();
    expect(() => finishWorkshop({ ...newWorkshop(frequency.id), frequency: "NaN", actions: Array(24).fill("pass") })).toThrow();
    expect(() => validateWorkshop({ ...newWorkshop(frequency.id), actions: ["commit"] })).toThrow();
    expect(() => finishWorkshop(finishedFrequency())).toThrow(/重复/);
  });
  it("keeps range and frequency payloads distinct", () => {
    expect(() => validateWorkshop({ ...newWorkshop(range.id), actions: ["pass"] })).toThrow();
    expect(() => validateWorkshop({ ...newWorkshop(frequency.id), selected: ["AA"] })).toThrow();
    expect(() => validateWorkshop({ ...newWorkshop(range.id), selected: ["garbage"] })).toThrow();
  });
  it("rebuilds exposures for backups without trusting a missing exposure array", () => {
    const b = validateWorkshopBackup(backup());
    expect(b.exposures).toEqual([`${WORKSHOP_VERSION}:${frequency.id}`]);
    expect(b.current).toEqual(b.records[0]);
  });
  it("rejects duplicate IDs, fabricated tasks, mismatched final records, and future versions", () => {
    const b = backup();
    expect(() => validateWorkshopBackup({ ...b, records: [...b.records, ...b.records] })).toThrow();
    expect(() => validateWorkshopBackup({ ...b, current: { ...b.current, frequency: "25" } })).toThrow(/不一致/);
    expect(() => validateWorkshopBackup({ ...b, exposures: [`${WORKSHOP_VERSION}:missing`] })).toThrow();
    expect(() => validateWorkshopBackup({ ...b, contentVersion: "future" })).toThrow();
  });
});
