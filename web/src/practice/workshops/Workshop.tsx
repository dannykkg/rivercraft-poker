import { useEffect, useRef, useState } from "react";
import { errorText } from "../../study/model";
import { registerLeaveGuard } from "../../study/lifecycle";
import { downloadJSON, readJSON } from "../../study/storage";
import { WORKSHOP_TASKS, HAND_CLASSES, EXECUTION_ROUNDS, WORKSHOP_VERSION, newWorkshop, finishWorkshop, taskById, comboCount, gradeRange, polarizedReference, frequencySummary, type WorkshopSession, type FrequencyTask } from "./model";
import { loadWorkshops, saveWorkshop, exportWorkshops, importWorkshops, validateWorkshopBackup, type WorkshopBackup } from "./storage";
import "./workshops.css";

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
function ModelExplanation({ task }: { task: FrequencyTask }) {
  const reference = polarizedReference(task);
  return <div className="study-notice" data-testid="frequency-reference"><p>弱牌下注比例：{percent(reference.bluffFrequency)}；防守方跟注比例：{percent(reference.callFrequency)}。</p><p>防守跟注频率 q=P/(P+B)，使弱牌的诈唬与过牌同为0增量收益。弱牌下注频率 x=VB/[L(P+B)]，使下注范围中诈唬占 B/(P+2B)，防守的跟注与弃牌也同为0增量收益。</p><p>这里的 x 是“拿到弱牌后下注”的频率，不是“全部下注中有多少诈唬”。后者为 {percent(reference.bettingBluffShare)}。</p></div>;
}
export function Workshop() {
  const [session, setSession] = useState<WorkshopSession | null>(null), [records, setRecords] = useState<WorkshopSession[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [plan, setPlan] = useState(""), [pending, setPending] = useState<WorkshopBackup | null>(null);
  const writing = useRef<Promise<unknown>>(Promise.resolve()), lock = useRef(false);
  useEffect(() => registerLeaveGuard(async () => { await writing.current; }), []);
  const receive = async () => { const data = await loadWorkshops(); setSession(data.current); setRecords(data.records); setPlan(data.current?.frequency ?? ""); };
  useEffect(() => { let active = true; writing.current = loadWorkshops().then(data => { if (active) { setSession(data.current); setRecords(data.records); setPlan(data.current?.frequency ?? ""); } }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);
  const run = (operation: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setNotice("");
    writing.current = operation().catch(e => setError(errorText(e))).finally(() => { lock.current = false; setBusy(false); });
  };
  const commit = async (next: WorkshopSession | null) => {
    const accepted = await saveWorkshop(next, session); setSession(accepted);
    if (accepted?.status === "complete") setRecords(previous => [accepted, ...previous.filter(r => r.id !== accepted.id)]);
  };
  const start = (id: string) => run(async () => { setPlan(""); await commit(newWorkshop(id)); });
  const reset = () => run(async () => { await commit(null); setPlan(""); });
  const task = session ? taskById(session.taskId) : null;
  if (!ready) return <p role="status">正在恢复范围与频率进度…</p>;
  const done = session?.status === "complete";
  const range = task?.kind === "range" && session && done ? gradeRange(task, session.selected) : null;
  const distribution = task?.kind === "frequency" && session && done ? frequencySummary(task, session) : null;
  const independent = records.filter(r => !r.seen && !r.assisted).length;
  return <section className="practice-workshop" aria-label="范围与频率专项" aria-busy={busy}>
    <header><h2>范围构建与混合频率</h2><p>169格范围重建，以及明确数学模型中的计划与执行。与牌桌训练、基础课分别记录。</p><p className="study-muted">已完成 {records.length} 次 · 首次无辅助 {independent} 次；不代表未见局面的泛化认证。</p></header>
    {error && <p role="alert" className="study-error">{error}</p>}{notice && <p role="status" className="study-notice">{notice}</p>}
    {!session ? <div className="practice-drills">{WORKSHOP_TASKS.map(item => <article className="study-panel" key={item.id}>
      <span className="study-badge">{item.kind === "range" ? "A1 · 169格范围" : "A5 · 有限数学模型"}</span><h3>{item.title}</h3>
      <p>{item.kind === "range" ? "重建明示的教学核心范围，反馈漏选、多选和组合数；不提供完整开池表。" : "先填写混合比例，再连续选择；分别反馈计划与执行，而不是每次只选最高频动作。"}</p>
      <button disabled={busy} onClick={() => start(item.id)}>开始{item.title}</button>
    </article>)}</div> : <article className="study-panel">
      <div className="study-row"><h3>{task!.title}</h3><span className="study-badge">{session.seen ? "已见专项" : "首次专项"} · {session.assisted ? "已使用参考" : "未使用参考"}</span></div>
      {task?.kind === "range" && <>
        <p>{task.context}</p><p className="study-notice">{task.limitation}</p>
        <p>点击手牌类别选择本课核心开池范围。对子每格6种组合，同花每格4种，非同花每格12种。可横向滚动完整矩阵，键盘 Tab 和空格也能操作。</p>
        <p>已选 {session.selected.length} 类 · {session.selected.reduce((n, hand) => n + comboCount(hand), 0)} / 1326 种组合。</p>
        <div className="workshop-matrix-scroll" tabIndex={0} aria-label="可横向滚动的完整手牌矩阵"><div className="workshop-matrix" role="group" aria-label="169格手牌矩阵">{HAND_CLASSES.map(hand => {
          const selected = session.selected.includes(hand); const missing = range?.missing.includes(hand), excess = range?.excess.includes(hand);
          return <button type="button" key={hand} aria-label={hand} aria-pressed={selected} disabled={busy || done} className={`${selected ? "selected" : ""} ${missing ? "missing" : ""} ${excess ? "excess" : ""}`} title={`${hand} · ${comboCount(hand)}种组合${missing ? " · 漏选" : excess ? " · 多选" : ""}`} onClick={() => run(async () => { await commit({ ...session, selected: selected ? session.selected.filter(x => x !== hand) : [...session.selected, hand] }); })}>{hand}</button>;
        })}</div></div>
        {!done && <div className="study-inline"><button disabled={busy} onClick={() => run(async () => { await commit({ ...session, selected: [] }); })}>清空矩阵</button><button disabled={busy} className="study-primary" onClick={() => run(async () => { await commit(finishWorkshop(session)); })}>提交范围</button></div>}
        {range && <div className="study-feedback" role="status" data-testid="range-result"><h4>{range.exact ? "指定核心范围重建一致" : "与你要重建的教学范围存在差异"}</h4><p>漏选：{range.missing.join("、") || "无"}</p><p>多选：{range.excess.join("、") || "无"}</p><p>参考 {range.expectedCombos} 种组合；你的选择 {range.selectedCombos} 种组合。这些差异不是通用打法错误或EV损失。</p></div>}
        {(session.assisted || done) && <p className="study-notice" data-testid="range-reference">指定核心范围：<code>{task.target}</code>。来源：{task.source}。</p>}
      </>}
      {task?.kind === "frequency" && <>
        <p className="study-notice">抽象两人河牌模型：底池 P={task.pot}、唯一下注尺度 B={task.bet}；进攻方有 V={task.values} 份价值牌和 L={task.bluffs} 份弱牌。价值牌总胜抓诈牌，弱牌总输。无平局、阻断牌、加注、抽水或后续下注；不是完整德州扑克牌谱。</p>
        <p>{task.role === "bluffer" ? "价值牌均下注。本次每轮都条件化为拿到弱牌，练习下注／过牌的分配。" : "本次每轮都条件化为面对下注并持抓诈牌，练习跟注／弃牌的分配。"} 每一次选择都属于混合支持；不显示单手运气输赢。</p>
        {!done && <>
          <form className="study-inline" onSubmit={e => { e.preventDefault(); run(async () => {
            if (!plan.trim() || !Number.isFinite(Number(plan)) || Number(plan) < 0 || Number(plan) > 100) throw new Error("计划比例须为0–100%。");
            if (session.actions.length) throw new Error("开始执行后计划已锁定。");
            await commit({ ...session, frequency: plan });
          }); }}><label>你的{task.role === "bluffer" ? "下注" : "跟注"}计划（%）<input aria-label="计划频率" inputMode="decimal" value={plan} disabled={busy || session.actions.length > 0} onChange={e => setPlan(e.target.value)} /></label><button disabled={busy || session.actions.length > 0}>保存频率计划</button></form>
          {plan !== session.frequency && <p className="study-muted">输入尚未保存；点击“保存频率计划”后才开始执行。</p>}
          <fieldset className="practice-controls" aria-label="混合策略执行" disabled={busy || !session.frequency.trim() || plan !== session.frequency || session.actions.length >= EXECUTION_ROUNDS}>
            <legend>实际选择 {session.actions.length} / {EXECUTION_ROUNDS}</legend>
            <button onClick={() => run(async () => { await commit({ ...session, actions: [...session.actions, "pass"] }); })}>{task.role === "bluffer" ? "过牌" : "弃牌"}</button>
            <button onClick={() => run(async () => { await commit({ ...session, actions: [...session.actions, "commit"] }); })}>{task.role === "bluffer" ? `下注 ${task.bet}` : `跟注 ${task.bet}`}</button>
          </fieldset>
          <button className="study-primary" disabled={busy || session.actions.length !== EXECUTION_ROUNDS} onClick={() => run(async () => { await commit(finishWorkshop(session)); })}>完成频率练习</button>
        </>}
        {distribution && <div className="study-feedback" role="status" data-testid="frequency-result"><h4>计划比例与实际执行分别评价</h4><p>数学参考：{percent(distribution.target)}；你的计划：{percent(distribution.planned)}；实际选择：{percent(distribution.actual)}（{distribution.rounds}次）。</p><p>计划差：{((distribution.planned - distribution.target) * 100).toFixed(2)} 个百分点；执行相对计划差：{((distribution.actual - distribution.planned) * 100).toFixed(2)} 个百分点。</p><p>24次只描述本组样本；不把比例差判成统计显著错误，也不将样本偏差伪造成EV损失。该模型在参考对手策略下，两种动作的增量收益相同。</p></div>}
        {(session.assisted || done) && <ModelExplanation task={task} />}
      </>}
      {!done && !session.assisted && <button disabled={busy} onClick={() => run(async () => { await commit({ ...session, assisted: true }); })}>查看本专项参考（计为辅助）</button>}
      {done ? <button disabled={busy} onClick={reset}>返回专项列表</button> : <details><summary>结束本次专项</summary><p>未完成记录不计成绩，但已见状态会保留。</p><button disabled={busy} onClick={reset}>确认结束专项</button></details>}
      <p className="study-muted">内容版本：{WORKSHOP_VERSION}。客户端训练不提供防作弊认证。</p>
    </article>}
    <details className="study-panel"><summary>范围与频率专项备份</summary><p>这是范围与频率的独立进度包，不替代牌桌实战备份和基础课备份。导入只合并新增ID，不覆盖进行中的专项。</p>
      <div className="study-inline"><button disabled={busy} onClick={() => run(async () => { downloadJSON("rivercraft-range-frequency.json", await exportWorkshops()); setNotice("范围与频率进度已导出。"); })}>导出范围与频率进度</button>
      <label>选择范围频率备份<input type="file" accept=".json" aria-label="选择范围频率备份" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) run(async () => { setPending(validateWorkshopBackup(await readJSON(file))); }); e.target.value = ""; }} /></label></div>
      {pending && <div className="study-notice"><p>已验证 {pending.records.length} 条完成记录；不会覆盖同ID或当前专项。</p><button disabled={busy} onClick={() => run(async () => { const added = await importWorkshops(pending); await receive(); setPending(null); setNotice(`合并了 ${added} 条专项记录。`); })}>确认导入范围频率进度</button><button disabled={busy} onClick={() => setPending(null)}>取消专项导入</button></div>}
    </details>
  </section>;
}
