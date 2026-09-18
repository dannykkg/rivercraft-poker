import { useEffect, useRef, useState } from "react";
import { getLegalActions } from "../domain/engine";
import type { PlayerAction } from "../domain/types";
import { projectPlayerView } from "../domain/view";
import { StudyTable } from "../study/Table";
import { LESSONS } from "../study/curriculum";
import { registerLeaveGuard } from "../study/lifecycle";
import { downloadJSON, readJSON, saveHand } from "../study/storage";
import { errorText, uid } from "../study/model";
import type { LabLaunch } from "../study/Lab";
import { COURSES, DRILLS, SOURCES, OPPONENTS, findDrill, CONTENT_VERSION } from "./catalogue";
import { createSession, fromHand, playAction, continueSession, resultOf, practiceHand, practicePoint, initialHint } from "./runner";
import { actionLabel } from "./feedback";
import { raiseByPot } from "./policy";
import { exportPractice, importPractice, loadPractice, savePractice, validatePracticeBackup } from "./storage";
import type { CourseId, Feedback, Mode, PracticeBackup, PracticeLaunch, Result, Scope, Session } from "./model";
import "./practice.css";

const scopeLabels: Record<Scope, string> = { spot: "单点", street: "单街", hand: "整手" };
const modeLabels: Record<Mode, string> = { guided: "引导练习", assessment: "无提示测验", review: "复练" };
function FeedbackCard({ feedback }: { feedback: Feedback }) {
  return <div className={`practice-feedback practice-${feedback.verdict}`} data-testid="decision-feedback"><span className="study-badge">{feedback.kind === "math" ? "终局数学比较" : feedback.kind === "teaching" ? "教学指导 · 非 GTO" : "无适用参考"}</span><h3>{feedback.title}</h3><p>{feedback.explanation}</p>{feedback.recommended.length > 0 && <p>本模型建议：{feedback.recommended.join(" / ")}</p>}{feedback.evLoss !== undefined && <p>相对已比较动作损失：{feedback.evLoss.toFixed(2)} 筹码</p>}<small className="study-muted">参考版本：{feedback.reference}</small></div>;
}
export function Practice({ launch, onLab, onLibrary }: { launch?: PracticeLaunch | null; onLab: (launch: LabLaunch) => void; onLibrary: () => void }) {
  const [results, setResults] = useState<Result[]>([]); const [session, setSession] = useState<Session | null>(null); const [ready, setReady] = useState(false);
  const [course, setCourse] = useState<CourseId>("A1"); const [view, setView] = useState<"courses" | "drills" | "review">("courses");
  const [scope, setScope] = useState<Scope>("spot"); const [mode, setMode] = useState<Mode>("guided"); const [caseIndex, setCaseIndex] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [pending, setPending] = useState<PracticeBackup | null>(null);
  const [showHelp, setShowHelp] = useState(false); const [customRaise, setCustomRaise] = useState(0);
  const lock = useRef(false); const task = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => registerLeaveGuard(async () => { await task.current; }), []);
  useEffect(() => { let active = true; task.current = loadPractice().then(async data => {
    let next = data.session;
    if (launch && data.session?.caseId !== launch.id) {
      if (data.session && data.session.status !== "complete") { if (active) setMessage("已有未完成训练；请先完成或结束当前训练，再从牌谱库创建新复练。"); }
      else { next = await savePractice(fromHand(launch)); }
    }
    if (active) { setResults(data.results); setSession(next); if (next) { const d = findDrill(next.drillId); if (d) setCourse(d.courseId); } }
  }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, [launch?.id]);
  const run = (fn: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setMessage("");
    task.current = fn().catch(e => setError(errorText(e))).finally(() => { lock.current = false; setBusy(false); });
  };
  const commit = async (next: Session | null) => {
    const result = next?.status === "complete" ? resultOf(next, results) : undefined;
    const accepted = await savePractice(next, result); setSession(accepted);
    if (result) setResults(old => [result, ...old.filter(r => r.id !== result.id)]);
  };
  const start = (id: string, index = caseIndex, nextMode = mode, nextScope = scope) => run(async () => {
    await commit(createSession(id, index, nextScope, nextMode, results)); setShowHelp(false);
  });
  const perform = (action: PlayerAction) => { if (session) run(async () => { await commit(playAction(session, action)); }); };
  const nextCase = () => {
    if (!session || session.sourceHandId) return;
    const drill = findDrill(session.drillId)!;
    const next = (drill.cases.findIndex(c => c.id === session.caseId) + 1) % drill.cases.length;
    setCaseIndex(next); start(session.drillId, next, session.mode, session.scope);
  };
  const study = (index?: number) => {
    if (!session) return; run(async () => {
      if (session.mode === "assessment" && session.status !== "complete") throw new Error("测验结束后才可进入实验室，避免提前查看参考信息。");
      const point = practicePoint(session, index); const next = { ...session, assisted: true, updatedAt: Date.now() };
      await commit(next); await saveHand(point.record);
      onLab({ id: uid("practice-lab"), state: point.state, parent: point.record, sequence: point.sequence, mode: "original", seed: session.seed });
    });
  };
  const latestByFamily = new Map<string, Result>(); results.forEach(r => { if (!latestByFamily.has(r.family)) latestByFamily.set(r.family, r); });
  const review = [...latestByFamily.values()].filter(r => r.deviations || r.assisted || r.dueAt <= Date.now());
  const independent = results.filter(r => !r.seen && !r.assisted && r.mode === "assessment");
  const drill = findDrill(session?.drillId ?? "");
  const current = session?.status === "feedback" ? session.decisions.at(-1)!.before : session?.state;
  const legal = session?.status === "acting" ? getLegalActions(session.state) : null;
  useEffect(() => { setCustomRaise(legal?.minRaiseTo ?? 0); }, [legal?.minRaiseTo, legal?.playerId, legal?.toCall]);
  const exported = () => run(async () => { downloadJSON("rivercraft-practice-backup.json", await exportPractice()); setMessage("实战进度已导出；基础课与牌谱备份保持独立。备份含底牌，请私下保管。"); });
  if (!ready) return <div className="study-page" role="status">正在恢复实战进度…</div>;
  return <div className="study-page practice-page"><header className="study-heading"><div><p className="study-eyebrow">PRACTICE · DECIDE · REVIEW</p><h1>实战训练</h1><p>不回答概念题：在牌桌作出选择，应对对手，再比较自己的路线。</p></div><div className="study-stat"><strong>{results.length}</strong><span>已完成训练 · {independent.length} 次首次无提示测验</span></div></header>
    {error && <p role="alert" className="study-error">{error}</p>}{message && <p role="status" className="study-notice">{message}</p>}
    <p className="practice-boundary">教学环境：六人桌100BB、无前注／抽水。普通反馈是本项目简化教学计划；只有明确标出的河牌终局比较提供精确数学收益。不是完整 GTO 课程或职业认证。</p>
    {session ? <section aria-label="当前实战训练" className="practice-session" aria-busy={busy}>
      <div className="study-row"><h2>{session.mode === "assessment" && session.status !== "complete" ? "无提示牌局测验" : session.title}</h2><span className="study-badge">{scopeLabels[session.scope]} · {modeLabels[session.mode]} · {session.seen ? "已见局面族" : "首次局面族"}</span></div>
      {session.contentVersion !== CONTENT_VERSION && <p className="study-warning">这是旧课程版本。保留历史，不再按新版本严格评分。</p>}
      <div className="practice-context"><span>对手：{OPPONENTS[session.opponent].label}</span><span>{session.startPhase} 起点</span><span>已决策 {session.decisions.length} 次</span><span>{session.assisted ? "已使用辅助" : "未使用辅助"}</span></div>
      <details className="study-panel"><summary>本局公开条件与对手模型</summary><p>{OPPONENTS[session.opponent].detail}</p><p>起点练习范围：<code>{session.range}</code></p><p>范围仅是本题给定的条件，不是算法从隐藏牌或未来信息读出的答案。继续行动后，后续教学指导不把这个起点范围冒充更新后的精确范围。</p></details>
      {current && <StudyTable state={current} heroId={session.heroId} />}
      {legal && <fieldset disabled={busy} className="practice-controls" aria-label="实战行动"><legend>你的决策 · 跟注成本 {legal.callAmount}</legend>
        {legal.canFold && <button onClick={() => perform({ type: "fold" })}>弃牌</button>}{legal.canCheck && <button onClick={() => perform({ type: "check" })}>过牌</button>}{legal.canCall && <button onClick={() => perform({ type: "call" })}>跟注 {legal.callAmount}</button>}
        {legal.canRaise && <>{session.state.hand?.phase === "preflop" ? [50, 60, Math.max(legal.minRaiseTo!, session.state.hand.currentBet * 3)].filter((v, i, a) => a.indexOf(v) === i && v >= legal.minRaiseTo! && v <= legal.maxRaiseTo).map(to => <button key={to} onClick={() => perform({ type: "raise", to })}>加注到 {to}</button>) : [1/3, 2/3, 1].map((ratio, i) => { const a = raiseByPot(projectPlayerView(session.state, session.heroId), ratio); return a ? <button key={i} onClick={() => perform(a)}>{["1/3池", "2/3池", "满池"][i]} · {a.type === "raise" ? a.to : "全下"}</button> : null; })}
        <label>自定义加注到<input aria-label="实战加注到" type="number" min={legal.minRaiseTo!} max={legal.maxRaiseTo} step={1} value={customRaise} onChange={e => setCustomRaise(Number(e.target.value))} /></label><button onClick={() => perform({ type: "raise", to: customRaise })}>提交自定义加注</button></>}
        {legal.canAllIn && <button onClick={() => perform({ type: "all-in" })}>全下</button>}
      </fieldset>}
      {session.status === "feedback" && <div role="status"><p className="study-muted">实际回应：{session.state.events.filter(e => e.type === "player-acted" && e.sequence > session.decisions.at(-1)!.sequence && e.playerId !== session.heroId).map(e => `${session.state.players.find(p => p.id === e.playerId)?.name} ${String(e.public.action)}${Number(e.public.committed) > 0 ? ` ${e.public.committed}` : ""}`).join("；") || "本手结束或没有需要回应的对手。"}</p><FeedbackCard feedback={session.decisions.at(-1)!.feedback} /><button className="study-primary" disabled={busy} onClick={() => run(async () => { await commit(continueSession(session)); })}>继续牌局／查看总结</button></div>}
      {session.status === "acting" && session.mode !== "assessment" && <div className="study-inline"><button disabled={busy} onClick={() => run(async () => { await commit({ ...session, hinted: true, assisted: true }); })}>查看本决策提示</button><button disabled={busy} onClick={() => study()}>暂停并在实验室研究</button><button disabled={busy} onClick={() => run(async () => { await commit({ ...session, hinted: true, assisted: true }); setShowHelp(true); })}>回看关联基础知识</button></div>}
      {session.hinted && session.status === "acting" && <p className="study-notice">提示：{initialHint(session)} 本次单独记为辅助练习。</p>}
      {showHelp && <section className="study-panel"><h3>基础知识速查（读取原课程，不改动原进度）</h3>{LESSONS.filter(l => drill?.foundations.includes(l.id)).map(l => <p key={l.id}><strong>{l.title}：</strong>{l.concept} {l.caution}</p>)}</section>}
      {session.status === "complete" && <section className="study-panel" data-testid="practice-summary"><h2>本次实战总结</h2><p>完成 {session.decisions.length} 个实际决策；单手输赢不计入能力评分。教学计划与数学评价分别列示。</p>
        {session.decisions.map((d, i) => <article className="practice-decision" key={d.id}><h3>{i + 1} · {d.phase} · {actionLabel(d.action)}{d.hinted ? " · 使用提示" : ""}</h3><FeedbackCard feedback={d.feedback} /><button disabled={busy} onClick={() => study(i)}>研究这个决策点</button></article>)}
        <div className="study-inline">{drill && <><button className="study-primary" disabled={busy} onClick={nextCase}>下一组同类局面</button><button disabled={busy} onClick={() => start(drill.id, drill.cases.findIndex(c => c.id === session.caseId), "review", session.scope)}>重抽未知牌复练</button></>}<button disabled={busy} onClick={() => run(async () => { await saveHand(practiceHand(session)); setMessage("训练牌谱已保存到个人牌谱库，不计正常对局成绩。"); })}>收藏训练牌谱</button><button disabled={busy} onClick={onLibrary}>打开个人牌谱库</button><button disabled={busy} onClick={() => run(async () => { await commit(null); })}>返回训练目录</button>{drill && DRILLS[DRILLS.indexOf(drill) + 1] && <button disabled={busy} onClick={() => { const next = DRILLS[DRILLS.indexOf(drill) + 1]; setCourse(next.courseId); start(next.id, 0, session.mode, next.defaultScope); }}>进入下一专项</button>}</div>
      </section>}
      {session.status !== "complete" && <details className="study-panel"><summary>结束当前训练</summary><p>未完成训练不会计入成绩。已完成的历史记录和基础课进度保持不变。</p><button disabled={busy} onClick={() => run(async () => { await commit(null); })}>确认结束并返回目录</button></details>}
      {session.status === "complete" || session.mode !== "assessment" ? <details className="study-panel"><summary>教学依据与评分边界</summary>{SOURCES.filter(s => !drill || drill.sourceIds.includes(s.id)).map(s => <p key={s.id}><strong>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</strong>：{s.note}</p>)}</details> : null}
    </section> : <>
      <nav className="practice-tabs" aria-label="实战学习方式">{[["courses", "系统课程"], ["drills", "专项练习"], ["review", "我的复练"]].map(([id, label]) => <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id as typeof view)}>{label}</button>)}</nav>
      {view !== "review" ? <><nav className="practice-courses" aria-label="实战课程模块">{COURSES.map(c => <button key={c.id} aria-current={course === c.id ? "step" : undefined} onClick={() => { setCourse(c.id); setScope(c.id === "A1" || c.id === "A5" ? "spot" : c.id === "A2" || c.id === "A3" ? "street" : "hand"); }}><small>{c.id}</small><strong>{c.title}</strong></button>)}</nav><p>{COURSES.find(c => c.id === course)!.objective}</p>
        <div className="study-panel practice-settings"><label>训练范围<select aria-label="训练范围" value={scope} onChange={e => setScope(e.target.value as Scope)}><option value="spot">单点 · 一次决策与即时回应</option><option value="street">单街 · 本轮行动结束</option><option value="hand">整手 · 连续打到弃牌或摊牌</option></select></label><label>反馈模式<select aria-label="反馈模式" value={mode} onChange={e => setMode(e.target.value as Mode)}><option value="guided">引导练习 · 每次行动后反馈</option><option value="assessment">无提示测验 · 结束后反馈</option><option value="review">复练 · 独立统计</option></select></label><label>起点条件<select aria-label="起点条件" value={caseIndex} onChange={e => setCaseIndex(Number(e.target.value))}>{[0,1,2,3].map(i => <option key={i} value={i}>条件组 {i + 1}</option>)}</select></label></div>
        <div className="practice-drills">{DRILLS.filter(d => d.courseId === course).map(d => <article className="study-panel" key={d.id}><small className="study-eyebrow">{d.courseId} · 建议{scopeLabels[d.defaultScope]}</small><h2>{d.title}</h2><p>{d.cases.length} 个起点配置 · {OPPONENTS[d.opponent].label}</p><p className="study-muted">同一局面族出现在不同课程时仍记为已见。更换未知牌不冒充新的独立掌握证据。</p><button className="study-primary" disabled={busy} onClick={() => start(d.id)}>开始{d.title}</button></article>)}</div>
        {view === "courses" && <p className="study-notice">按 A1–A6 顺序练习，但不强制先完成基础课全部六层。主线完整度以实际训练能力为准，不以目录或题目数代替专业策略覆盖。</p>}
      </> : <section className="study-panel"><h2>按局面族复练</h2><p>偏离教学计划、使用过辅助或到期的记录优先列出；教学建议不等于职业策略错误诊断。</p>{review.length ? review.map(r => <article className="practice-review" key={r.id}><div><strong>{r.session.title}</strong><p>{r.deviations} 次计划偏离 · {r.mathDecisions} 次数学比较 · {new Date(r.dueAt).toLocaleDateString()} 复习</p></div><button disabled={busy || !findDrill(r.drillId)} onClick={() => { const d = findDrill(r.drillId)!; start(d.id, d.cases.findIndex(c => c.id === r.caseId), "review", r.scope); }}>开始复练</button></article>) : <p>暂无待复练记录。先完成一组训练。</p>}<p>来自个人牌谱的未评分局面，可在牌谱库再次打开。</p></section>}
    </>}
    <details className="study-panel practice-backup"><summary>实战进度备份与恢复</summary><p>使用独立的实战资料库，不迁移、不覆盖现有基础课进度。备份含完整牌序和底牌，勿公开分享。</p><div className="study-inline"><button disabled={busy} onClick={exported}>导出实战进度</button><label>选择实战备份<input aria-label="选择实战备份" type="file" accept=".json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) run(async () => { setPending(validatePracticeBackup(await readJSON(file))); }); e.target.value = ""; }} /></label></div>{pending && <div className="study-notice"><p>验证通过，合并新增记录；同ID和正在进行的训练不覆盖。</p><button disabled={busy} onClick={() => run(async () => { const n = await importPractice(pending); const data = await loadPractice(); setResults(data.results); setSession(data.session); setPending(null); setMessage(`已合并 ${n} 条实战记录。`); })}>确认导入实战进度</button><button onClick={() => setPending(null)}>取消</button></div>}</details>
  </div>;
}
