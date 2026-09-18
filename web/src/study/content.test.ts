import { describe, expect, it } from "vitest";
import { LESSONS, LEVELS, curriculum, PREFLOP_BASELINES } from "./curriculum";
import { checkAnswer } from "./grading";
import { compileScenario, decisionPoints, exampleScenario, forkHand, recordHand } from "./scenario";
import { validateBackup, validateHand } from "./storage";
import { parseRange } from "./math";
import { submitAction } from "../domain/engine";
import type { Backup } from "./model";

const sampleBackup = (): Backup => ({ format: "rivercraft-study", version: 1, exportedAt: Date.now(), hands: [recordHand(compileScenario(exampleScenario()), "hero", "lab")], notes: [], branches: [], attempts: [], references: [] });

describe("six-level content contract", () => {
  it("contains six independent units at each of six levels", () => {
    expect(LEVELS).toHaveLength(6); expect(LESSONS).toHaveLength(36);
    for (const level of LEVELS) expect(LESSONS.filter(l => l.level === level.level)).toHaveLength(6);
    expect(LESSONS.flatMap(l => l.questions)).toHaveLength(74);
    expect(new Set(LESSONS.map(l => l.id)).size).toBe(36);
  });
  it("validates every answer, dependency, compiled scenario and controlled numerical variant", () => {
    for (let variant = 0; variant < 5; variant++) {
      const lessons = curriculum(variant); const ids = new Set<string>();
      for (const l of lessons) {
        expect(l.concept.length).toBeGreaterThan(10); expect(l.caution.length).toBeGreaterThan(10);
        for (const p of l.prerequisites) expect(lessons.some(x => x.id === p)).toBe(true);
        for (const q of l.questions) {
          expect(ids.has(q.id)).toBe(false); ids.add(q.id);
          expect(checkAnswer(q, String(q.answer))).toBe(true);
          expect(q.explanation.length).toBeGreaterThan(5); expect(q.assumptions.length).toBeGreaterThan(5);
          if (q.choices) expect(q.choices[Number(q.answer)]).toBeTruthy();
          if (q.scenario) {
            const state = compileScenario(q.scenario);
            if (q.actions) for (const action of q.actions) expect(submitAction(state, q.scenario.heroId, action).ok).toBe(true);
          }
        }
      }
    }
  });
  it("keeps repeated concept question identity stable and labels preflop data honestly", () => {
    expect(curriculum(0).find(l => l.id === "position")!.questions[0].id).toBe(curriculum(4).find(l => l.id === "position")!.questions[0].id);
    expect(curriculum(0).find(l => l.id === "pot-odds")!.questions[0].id).not.toBe(curriculum(4).find(l => l.id === "pot-odds")!.questions[0].id);
    for (const baseline of PREFLOP_BASELINES) { expect(parseRange(baseline.range).length).toBeGreaterThan(0); expect(baseline.label).toContain("不是"); }
  });
});

describe("backup validation before transactional imports", () => {
  it("accepts its own facts and independent resampled branches", () => {
    const b = sampleBackup(); const hand = b.hands[0]; const point = decisionPoints(hand.events, hand.heroId).at(-1)!;
    const branch = forkHand(hand, point.sequence, true, 42);
    b.branches.push({ id: "branch-test", handId: hand.id, sequence: point.sequence, title: "对比", mode: "resample", seed: 42, assumptions: "随机未知牌", events: branch.events, createdAt: Date.now() });
    b.notes.push({ id: "note", handId: hand.id, sequence: point.sequence, text: "为什么在这里下注？", skill: "value", createdAt: Date.now() });
    expect(validateBackup(b)).toEqual(b);
    expect(validateHand(hand)).not.toBe(hand);
  });
  it("rejects wrong versions, duplicate identifiers, dangling notes and tampered sequences", () => {
    const b = sampleBackup(); expect(() => validateBackup({ ...b, version: 9 })).toThrow();
    expect(() => validateBackup({ ...b, hands: [b.hands[0], b.hands[0]] })).toThrow();
    expect(() => validateBackup({ ...b, notes: [{ id: "n", handId: "missing", sequence: 1, text: "x", skill: "y", createdAt: 1 }] })).toThrow();
    b.hands[0].events[0].sequence = 99; expect(() => validateBackup(b)).toThrow();
  });
  it("rejects malformed checkpoints and hidden duplicate cards", () => {
    const b = sampleBackup(); const point = b.hands[0].events.find(e => e.type === "state-checkpoint")!;
    const snapshot = point.private!.snapshot as ReturnType<typeof compileScenario>;
    snapshot.hand!.players[1].holeCards[0] = snapshot.hand!.players[0].holeCards[0];
    expect(() => validateBackup(b)).toThrow(/重复|无效/);
  });
  it("rejects invalid attempt booleans and unlicensed reference documents", () => {
    const b = sampleBackup();
    expect(() => validateBackup({ ...b, attempts: [{ id: "a", version: 1, lessonId: "x", questionId: "y", answer: "1", correct: "true", hinted: false, seen: false, mode: "test", createdAt: 1 }] })).toThrow();
    expect(() => validateBackup({ ...b, references: [{ id: "r", version: 1 }] })).toThrow();
  });
});
