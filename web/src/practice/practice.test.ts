import { describe, expect, it } from "vitest";
import { getLegalActions } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import { COURSES, DRILLS, CONTENT_VERSION } from "./catalogue";
import { createSession, playAction, continueSession, resultOf, fromHand, practicePoint, practiceHand } from "./runner";
import { evaluateDecision } from "./feedback";
import { opponentAction } from "./policy";
import { validatePracticeBackup, validateSession } from "./storage";
import { validateHand } from "../study/storage";
import type { PlayerAction } from "../domain/types";
import type { Session, Scope } from "./model";
function passive(s: Session): PlayerAction {
  const l = getLegalActions(s.state)!;
  return l.canCheck ? { type: "check" } : l.canCall ? { type: "call" } : { type: "fold" };
}
function finish(initial: Session): Session {
  let s = initial;
  for (let i = 0; i < 128; i++) {
    if (s.status === "complete") return s;
    s = s.status === "feedback" ? continueSession(s) : playAction(s, passive(s));
  }
  throw new Error("session did not terminate");
}
describe("practical curriculum uses real decision nodes", () => {
  it("has six skill modules and four practical drills in each", () => {
    expect(COURSES).toHaveLength(6); expect(DRILLS).toHaveLength(24);
    for (const c of COURSES) expect(DRILLS.filter(d => d.courseId === c.id)).toHaveLength(4);
  });
  it("compiles every configured case to a legal learner decision", () => {
    for (const drill of DRILLS) for (let i = 0; i < drill.cases.length; i++) {
      const s = createSession(drill.id, i, "spot", "guided", [], 100 + i);
      expect(getLegalActions(s.state)?.playerId, `${drill.id}:${i}`).toBe("hero");
      expect(s.state.config.players).toHaveLength(6);
      validateHand(practiceHand(s));
      const view = projectPlayerView(s.state, "hero");
      expect(view.players.filter(p => p.id !== "hero" && p.holeCards)).toHaveLength(0);
    }
  });
  it("completes spot, street and full-hand branches for every exercise", () => {
    for (const d of DRILLS) for (const scope of ["spot", "street", "hand"] as Scope[]) {
      const s = finish(createSession(d.id, 0, scope, "guided", [], 99));
      expect(s.status, `${d.id}:${scope}`).toBe("complete");
      expect(s.decisions.length).toBeGreaterThan(0);
      if (scope === "spot") expect(s.decisions).toHaveLength(1);
      expect(resultOf(s).decisions).toBe(s.decisions.length);
    }
  }, 20000);
  it("multi-street exercises contain actual follow-up decisions", () => {
    const s = finish(createSession("turn-plan", 0, "hand", "assessment", [], 93));
    expect(s.decisions.length).toBeGreaterThan(1);
    expect(s.decisions.some(d => d.phase === "river")).toBe(true);
  });
  it("opponents respond to a nonrecommended legal action and do not mutate the root", () => {
    const s = createSession("cbet-boards", 2, "hand", "guided", [], 100);
    const before = structuredClone(s);
    const next = playAction(s, { type: "raise", to: 120 });
    expect(s).toEqual(before); expect(next.status).toBe("feedback");
    expect(next.state.events.filter(e => e.type === "player-acted").length).toBeGreaterThan(s.state.events.filter(e => e.type === "player-acted").length + 1);
    expect(() => playAction(next, { type: "check" })).toThrow();
  });
  it("a rejected illegal input has no side effects", () => {
    const s = createSession("face-cbet", 0, "hand", "guided", [], 42); const copy = structuredClone(s);
    expect(() => playAction(s, { type: "check" })).toThrow(); expect(s).toEqual(copy);
  });
});
describe("feedback does not turn private results into strategy answers", () => {
  it("prices river call and fold from the declared range, never from actual cards", () => {
    const s = createSession("river-price", 1, "spot", "guided", [], 42);
    const actual = evaluateDecision(s, s.state, { type: "call" });
    expect(actual.kind).toBe("math"); expect(actual.equity).toBeCloseTo(0.75); expect(actual.evLoss).toBe(0);
    const altered = structuredClone(s.state); altered.hand!.deck.reverse(); altered.hand!.players.find(p => p.playerId === "v5")!.holeCards = ["2h", "2c"];
    expect(evaluateDecision(s, altered, { type: "call" })).toEqual(actual);
    const raise = evaluateDecision(s, s.state, { type: "raise", to: getLegalActions(s.state)!.maxRaiseTo });
    expect(raise.kind).toBe("ungraded"); expect(raise.evLoss).toBeUndefined();
  });
  it("does not reuse a root teaching answer for subsequent decisions", () => {
    const s = createSession("flop-to-river", 0, "hand", "guided", [], 13);
    const next = continueSession(playAction(s, { type: "check" }));
    expect(next.status).toBe("acting");
    const f = evaluateDecision(next, next.state, passive(next));
    expect(f.reference).toContain("continuation-policy"); expect(f.evLoss).toBeUndefined();
  });
  it("same seed gives the same cards and responses independent of record IDs", () => {
    const a = createSession("turn-plan", 0, "hand", "assessment", [], 7);
    const b = createSession("turn-plan", 0, "hand", "assessment", [], 7);
    expect(a.state.hand?.board).toEqual(b.state.hand?.board);
    expect(a.state.hand?.deck).toEqual(b.state.hand?.deck);
    const aa = playAction(a, passive(a)); const bb = playAction(b, passive(b));
    expect(aa.state.hand?.players).toEqual(bb.state.hand?.players);
  });
  it("opponent decisions accept only their own information projection", () => {
    const s = createSession("ep-open", 0, "hand", "guided", [], 3);
    const view = projectPlayerView(s.state, "hero");
    const action = opponentAction(view, "balanced", 5); expect(action).toBeTruthy();
    expect(view.players.filter(p => p.id !== "hero").some(p => p.holeCards)).toBe(false);
  });
  it("tracks duplicate situation families across different drill titles", () => {
    const done = finish(createSession("cbet-boards", 0, "spot", "assessment", [], 5));
    const s = createSession("flop-to-river", 0, "hand", "guided", [resultOf(done)], 66);
    expect(s.seen).toBe(true);
  });
});
describe("persistence contracts and personal practice", () => {
  it("roundtrips pending, feedback and completed sessions", () => {
    let s = createSession("btn-open", 0, "hand", "guided", [], 44);
    expect(validateSession(s)).toEqual(s);
    s = playAction(s, { type: "call" }); expect(validateSession(s)).toEqual(s);
    s = finish(s); expect(validateSession(s)).toEqual(s);
    const backup = { format: "rivercraft-practice", version: 1, exportedAt: Date.now(), session: s, results: [resultOf(s)] };
    expect(validatePracticeBackup(backup).results).toHaveLength(1);
    expect(() => validatePracticeBackup({ ...backup, results: [resultOf(s), resultOf(s)] })).toThrow();
    expect(() => validateSession({ ...s, scope: "whatever" })).toThrow();
  });
  it("preserves hints and review distinctions in completed scores", () => {
    const initial = createSession("btn-open", 0, "spot", "guided", [], 12); initial.hinted = true;
    const s = finish(initial); const r = resultOf(s);
    expect(r.assisted).toBe(true); expect(r.session.decisions[0].hinted).toBe(true);
    expect(r.contentVersion).toBe(CONTENT_VERSION);
  });
  it("imports a personal decision into isolated ungraded practice", () => {
    const s = createSession("cbet-boards", 0, "hand", "guided", [], 100);
    const p = practicePoint(s); const original = structuredClone(p.record);
    const practice = fromHand({ id: "personal", hand: p.record, sequence: p.sequence });
    expect(practice.sourceHandId).toBe(p.record.id);
    const next = playAction(practice, passive(practice));
    expect(next.decisions[0].feedback.kind).toBe("ungraded"); expect(p.record).toEqual(original);
  });
});
