import { useEffect, useMemo, useRef, useState } from "react";
import { submitAction } from "../domain/engine";
import { LEVELS, LESSONS, questionsFor } from "./curriculum";
import { checkAnswer } from "./grading";
import { compileScenario, exampleScenario } from "./scenario";
import { errorText, uid, type Attempt, type Level, type Progress, type Question, type Scenario } from "./model";
import { loadAttempts, loadProgress, saveAttempt, saveProgress } from "./storage";
import { registerLeaveGuard } from "./lifecycle";
import { CardTile, StudyTable } from "./Table";

type Session = Progress & { variant?: number };
const evidenceLabels = { rule: "规则校验", exact: "数学计算", teaching: "教学基准（非 GTO）", solver: "专业模型知识" };
function QuestionView({ question, submitted, onAnswer, onLab }: { question: Question; submitted: string | null; onAnswer: (answer: string) => void; onLab: (scenario: Scenario) => void }) {
  const [answer, setAnswer] = useState(""); const [selected, setSelected] = useState<string[]>([]);
  const initial = useMemo(() => question.scenario ? compileScenario(question.scenario) : null, [question]);
  const [state, setState] = useState(initial); const [error, setError] = useState("");
  const act = (index: number) => {
    if (submitted !== null) return; const action = question.actions?.[index];
    if (action && initial && question.scenario) {
      const r = submitAction(initial, question.scenario.heroId, action);
      if (!r.ok) { setError(r.error.message); return; } setState(r.state);
    }
    onAnswer(String(index));
  };
  return <div className="study-question">
    <div className="study-row"><span className="study-badge">{evidenceLabels[question.evidence]}</span><span className="study-muted">{question.assumptions}</span></div><h3>{question.prompt}</h3>
    {state && question.scenario && <StudyTable state={state} heroId={question.scenario.heroId} />}
    {question.cards && <div className="study-cards">{question.cards.map(card => <CardTile key={card} card={card} selected={selected.includes(card)} onClick={submitted !== null ? undefined : () => setSelected(s => s.includes(card) ? s.filter(c => c !== card) : s.length < (question.selectCount ?? 5) ? [...s, card] : s)} />)}</div>}
    {question.choices ? <div className="study-choices">{question.choices.map((label, i) => <button key={i} disabled={submitted !== null} className={submitted === String(i) ? "study-choice-selected" : ""} onClick={() => act(i)}>{label}</button>)}</div> : <form onSubmit={e => { e.preventDefault(); onAnswer(question.cards ? [...selected].sort().join(" ") : answer); }} className="study-inline">
      {!question.cards && <label>你的答案<input aria-label="你的答案" inputMode="decimal" value={answer} onChange={e => setAnswer(e.target.value)} disabled={submitted !== null} /> {question.unit}</label>}
      <button className="study-primary" disabled={submitted !== null || (question.cards ? selected.length !== question.selectCount : answer.trim() === "")}>提交答案</button></form>}
    {error && <p role="alert" className="study-error">{error}</p>}
    {submitted !== null && <div className={checkAnswer(question, submitted) ? "study-feedback" : "study-feedback study-feedback-wrong"} role="status"><strong>{checkAnswer(question, submitted) ? "回答正确" : "需要复习"}</strong><p>{question.explanation}</p>{typeof question.answer === "number" && <p>参考值：{question.answer.toFixed(2)} {question.unit}</p>}</div>}
    {question.scenario && <button onClick={() => onLab(question.scenario!)}>在实验室研究这个局面</button>}
  </div>;
}
export function Learning({ onLab }: { onLab: (scenario: Scenario) => void }) {
  const [level, setLevel] = useState<Level>(1); const [session, setSession] = useState<Session | null>(null); const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [ready, setReady] = useState(false); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const lock = useRef(false); const writes = useRef(Promise.resolve()); const answerTask = useRef(Promise.resolve());
  useEffect(() => registerLeaveGuard(async () => { await answerTask.current; await writes.current; }), []);
  useEffect(() => { let active = true; void Promise.all([loadAttempts(), loadProgress()]).then(([a, raw]) => {
    if (!active) return; setAttempts(a); const p = raw as Session | null;
    const lesson = LESSONS.find(l => l.id === p?.lessonId);
    if (p && lesson && Number.isInteger(p.index) && p.index >= 0 && p.index <= lesson.questions.length && ["guided", "test", "review"].includes(p.mode) && typeof p.hinted === "boolean" && (p.submitted === null || typeof p.submitted === "string")) {
      setSession({ ...p, variant: Number.isInteger(p.variant) && p.variant! >= 0 && p.variant! <= 4 ? p.variant : 0 }); setLevel(lesson.level);
    }
    setReady(true);
  }).catch(e => { if (active) { setError(errorText(e)); setReady(true); } }); return () => { active = false; }; }, []);
  const lesson = LESSONS.find(l => l.id === session?.lessonId); const variant = session?.variant ?? 0;
  const questions = useMemo(() => lesson ? questionsFor(lesson.id, variant) : [], [lesson, variant]); const question = session ? questions[session.index] : undefined;
  const persist = (p: Session | null) => {
    writes.current = writes.current.catch(() => undefined).then(() => saveProgress(p));
    return writes.current.then(() => { setSession(p); }).catch(e => { setError(errorText(e)); throw e; });
  };
  const change = (p: Session | null) => { if (!lock.current) void persist(p).catch(() => undefined); };
  const start = (id: string, mode: Attempt["mode"] = "guided") => change({ id: "session", lessonId: id, index: 0, mode, hinted: false, submitted: null, variant: 0 });
  const answer = (value: string) => {
    if (!session || !question || session.submitted !== null || lock.current) return;
    lock.current = true; setSaving(true); setError("");
    const attempt: Attempt = { id: uid("attempt"), version: 1, lessonId: session.lessonId, questionId: question.id, answer: value, correct: checkAnswer(question, value), hinted: session.hinted, seen: attempts.some(a => a.questionId === question.id), mode: session.mode, createdAt: Date.now() };
    answerTask.current = (async () => {
      try { await saveAttempt(attempt); setAttempts(a => [...a, attempt]); await persist({ ...session, submitted: value }); }
      catch (e) { setError(errorText(e)); } finally { lock.current = false; setSaving(false); }
    })();
  };
  const firstByQuestion = new Map<string, Attempt>();
  [...attempts].sort((a, b) => a.createdAt - b.createdAt).forEach(a => { if (!firstByQuestion.has(a.questionId)) firstByQuestion.set(a.questionId, a); });
  const independent = [...firstByQuestion.values()].filter(a => !a.hinted && !a.seen && a.mode !== "review");
  const reviews = LESSONS.filter(l => attempts.filter(a => a.lessonId === l.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 2).some(a => !a.correct));
  if (!ready) return <div className="study-page"><p role="status">正在读取学习进度…</p></div>;
  return <div className="study-page"><header className="study-heading"><div><p className="study-eyebrow">RIVERCRAFT ACADEMY</p><h1>学习中心</h1><p>理解条件，亲手决策，再回到牌桌验证。</p></div><div className="study-stat"><strong>{independent.filter(a => a.correct).length}/{independent.length}</strong><span>首次无提示答对 · 不含重复题</span></div></header>
    {error && <p className="study-error" role="alert">{error}</p>}
    <nav className="study-levels" aria-label="教学层次">{LEVELS.map(l => <button key={l.level} disabled={saving} aria-current={level === l.level ? "step" : undefined} onClick={() => { setLevel(l.level); change(null); }}><small>LEVEL {l.level}</small><strong>{l.title}</strong></button>)}</nav>
    <div className="study-two-column"><aside className="study-panel"><h2>{LEVELS[level - 1].title}</h2><p className="study-muted">{LEVELS[level - 1].description}</p><div className="study-lesson-list">{LESSONS.filter(l => l.level === level).map(l => <button key={l.id} disabled={saving} aria-current={session?.lessonId === l.id ? "true" : undefined} onClick={() => start(l.id)}>{l.title}<small>{attempts.filter(a => a.lessonId === l.id).length} 次练习</small></button>)}</div>
      <h3>待复习</h3>{reviews.length ? reviews.map(l => <button className="study-review-link" disabled={saving} key={l.id} onClick={() => { setLevel(l.level); start(l.id, "review"); }}>{l.title}</button>) : <p className="study-muted">错误会按知识点出现在这里。</p>}
    </aside><section className="study-panel study-main-panel" aria-busy={saving}>
      {!lesson || !session ? <div className="study-empty"><h2>选择一个知识单元</h2><p>每节课包含概念、条件说明、互动练习和反馈。可自由进入任意层次。</p><button className="study-primary" onClick={() => start(LESSONS.find(l => l.level === level)!.id)}>开始本层学习</button></div> : <>
        <div className="study-row"><h2>{lesson.title}</h2><span className="study-badge">{session.mode === "test" ? "无提示测验" : session.mode === "review" ? "复习" : "引导练习"}</span></div>
        {session.mode !== "test" && <><p>{lesson.concept}</p><p className="study-notice">{lesson.caution}</p>{lesson.prerequisites.length > 0 && <p className="study-muted">建议先了解：{lesson.prerequisites.map(id => LESSONS.find(l => l.id === id)?.title).join("、")}</p>}</>}
        {question ? <><div className="study-row"><span>练习 {session.index + 1}/{questions.length}</span>{session.mode !== "test" && !session.hinted && session.submitted === null && <button disabled={saving} onClick={() => change({ ...session, hinted: true })}>查看提示</button>}</div>
          {session.hinted && <p className="study-notice">提示：{question.hint} 本次会记为使用过提示。</p>}
          <fieldset disabled={saving} className="study-reset-fieldset"><QuestionView key={`${question.id}:${session.mode}:${variant}`} question={question} submitted={session.submitted} onAnswer={answer} onLab={onLab} /></fieldset>
          {session.submitted !== null && <button className="study-primary" disabled={saving} onClick={() => change({ ...session, index: session.index + 1, hinted: false, submitted: null })}>{session.index + 1 === questions.length ? "查看本节总结" : "下一题"}</button>}
        </> : <div className="study-empty" role="status"><h3>本节练习完成</h3><p>{lesson.caution}</p><div className="study-inline"><button onClick={() => start(lesson.id, "test")}>无提示重练</button><button onClick={() => change({ ...session, variant: (variant + 1) % 5, index: 0, hinted: false, submitted: null, mode: "review" })}>练习条件变式</button><button onClick={() => onLab(questions.find(q => q.scenario)?.scenario ?? exampleScenario())}>进入局面实验室</button></div><p className="study-muted">只改变已验证的题目条件；不变的概念题仍按重复题记录。变式编号和作答状态都会保存。尚不提供整套专业 GTO 范围认证。</p></div>}
      </>}
    </section></div></div>;
}
