import { useEffect, useMemo, useRef, useState } from "react";
import { getLegalActions } from "../domain/engine";
import { rehydrateTournament } from "../domain/reducer";
import { buildReplayFrames } from "../history/replay";
import { indexedDbGameRepository } from "../storage/repository";
import { LESSONS } from "./curriculum";
import { decisionPoints, forkHand, recordHand } from "./scenario";
import { actionKey, errorText, uid, type Branch, type HandRecord, type HandSummary, type Note } from "./model";
import { captureCompleted, downloadJSON, exportBackup, flushCapture, importBackup, listHands, loadBranches, loadHand, loadNotes, readJSON, saveHand, saveNote, validateBackup } from "./storage";
import { ActionControls, CardTile, StudyTable } from "./Table";
import type { LabLaunch } from "./Lab";

export function Library({ onLab }: { onLab: (launch: LabLaunch) => void }) {
  const [items, setItems] = useState<HandSummary[]>([]); const [cursor, setCursor] = useState<[number, string] | undefined>();
  const [query, setQuery] = useState(""); const [favorites, setFavorites] = useState(false); const [record, setRecord] = useState<HandRecord | null>(null);
  const [notes, setNotes] = useState<Note[]>([]); const [branches, setBranches] = useState<Branch[]>([]); const [point, setPoint] = useState(0);
  const [selfTest, setSelfTest] = useState(true); const [revealed, setRevealed] = useState(false); const [answer, setAnswer] = useState(""); const [frameIndex, setFrameIndex] = useState(0);
  const [note, setNote] = useState(""); const [skill, setSkill] = useState("information"); const [seed, setSeed] = useState(42);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<unknown>(null); const [quota, setQuota] = useState(""); const generation = useRef(0); const opened = useRef(0);
  const refresh = async (append = false) => {
    const ticket = ++generation.current;
    try { const page = await listHands(query, favorites, append ? cursor : undefined); if (ticket !== generation.current) return; setItems(old => append ? [...old, ...page.items] : page.items); setCursor(page.next); } catch (e) { setError(errorText(e)); }
  };
  useEffect(() => { void flushCapture().catch(() => undefined).then(() => refresh()); return () => { generation.current++; }; }, [query, favorites]);
  const select = async (id: string) => {
    const ticket = ++opened.current; setError("");
    try { const [h, n, b] = await Promise.all([loadHand(id), loadNotes(id), loadBranches(id)]); if (ticket !== opened.current) return; if (!h) throw new Error("牌谱不存在。"); setRecord(h); setNotes(n); setBranches(b); setPoint(0); setFrameIndex(0); setRevealed(false); setAnswer(""); setNote(""); }
    catch (e) { setError(errorText(e)); }
  };
  const points = useMemo(() => record ? decisionPoints(record.events, record.heroId) : [], [record]);
  const decision = points[point];
  const frames = useMemo(() => record ? buildReplayFrames(rehydrateTournament(record.events), record.handNumber, record.heroId) : [], [record]);
  const frame = frames[frameIndex];
  const actual = record && decision ? record.events.find(e => e.sequence > decision.sequence && e.type === "player-acted" && e.playerId === record.heroId) : undefined;
  const updateDetails = async (patch: Partial<Pick<HandRecord, "title" | "tags" | "starred">>) => {
    if (!record) return; try { const next = { ...record, ...patch, updatedAt: Date.now() }; await saveHand(next, false); setRecord(next); await refresh(); } catch (e) { setError(errorText(e)); }
  };
  const launchBranch = (resample: boolean) => {
    if (!record || !decision) return;
    try { const state = forkHand(record, decision.sequence, resample, seed); onLab({ id: uid("launch"), state, parent: record, sequence: decision.sequence, mode: resample ? "resample" : "original", seed }); }
    catch (e) { setError(errorText(e)); }
  };
  const migrate = async () => {
    setBusy(true); setError("");
    try { const [current, old] = await Promise.all([indexedDbGameRepository.loadCurrent(), indexedDbGameRepository.loadHistory()]); const all = [...old, ...(current ? [current] : [])]; for (const s of all) await captureCompleted(s); setMessage(`已检索 ${all.length} 份旧对局，完成的手牌已加入资料库；已有条目不重复创建。`); await refresh(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const saveCurrent = async () => {
    setBusy(true); try { const s = await indexedDbGameRepository.loadCurrent(); const hero = s?.players.find(p => p.kind === "human"); if (!s || !hero || !s.hand) throw new Error("没有可收藏的当前牌局。"); await saveHand(recordHand(s, hero.id, "play")); setMessage("当前手牌已收藏，包括尚未完成的决策记录。"); await refresh(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const inspectStorage = async (persist = false) => {
    try { const kept = persist ? await navigator.storage?.persist?.() : await navigator.storage?.persisted?.(); const estimate = await navigator.storage?.estimate?.(); setQuota(`此站点使用约 ${((estimate?.usage ?? 0)/1048576).toFixed(1)} MB，可用配额约 ${((estimate?.quota ?? 0)/1048576).toFixed(1)} MB。${kept ? "已获得持久存储授权。" : "浏览器仍可能清理，请定期导出备份。"}`); }
    catch (e) { setError(errorText(e)); }
  };
  return <div className="study-page"><header className="study-heading"><div><p className="study-eyebrow">PERSONAL HAND LIBRARY</p><h1>个人牌谱库</h1><p>把一次疑问，变成可以反复研究的学习资料。</p></div><button onClick={() => void saveCurrent()} disabled={busy}>收藏当前手牌</button></header>
    {error && <p role="alert" className="study-error">{error}</p>}{message && <p role="status" className="study-notice">{message}</p>}
    <details className="study-panel"><summary>备份、旧存档与本地存储</summary><p>数据保存在此浏览器。备份可能包含完整底牌、牌序与个人笔记，请妥善保存，不要公开上传。</p><div className="study-inline">
      <button onClick={() => void migrate()} disabled={busy}>整理旧对局</button><button onClick={() => { void exportBackup().then(b => downloadJSON("rivercraft-study-backup.json", b)).catch(e => setError(errorText(e))); }}>导出完整备份</button>
      <label className="study-file">选择备份文件<input type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (f) void readJSON(f).then(validateBackup).then(b => { setPending(b); setError(""); }).catch(x => { setPending(null); setError(errorText(x)); }); e.target.value = ""; }} /></label>
      <button onClick={() => void inspectStorage()}>查看存储用量</button><button onClick={() => void inspectStorage(true)}>申请持久存储</button></div>{quota && <p>{quota}</p>}
      {pending !== null && <div className="study-notice"><p>格式验证通过。确认后合并新增资料；同 ID 已有资料保持不变，不会覆盖。</p><button onClick={() => { setBusy(true); void importBackup(pending).then(async n => { setPending(null); setMessage(`已新增 ${n} 条资料。`); await refresh(); }).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }} disabled={busy}>确认导入备份</button><button onClick={() => setPending(null)}>取消导入</button></div>}
    </details>
    <div className="study-two-column"><aside className="study-panel"><label>搜索标题、标签、模式<input aria-label="搜索牌谱" value={query} onChange={e => setQuery(e.target.value)} placeholder="例如：价值下注 / lab" /></label><label className="study-check"><input type="checkbox" checked={favorites} onChange={e => setFavorites(e.target.checked)} />只看收藏</label>
      <div className="study-lesson-list">{items.map(h => <button key={h.id} aria-current={record?.id === h.id ? "true" : undefined} onClick={() => void select(h.id)}>{h.starred ? "★ " : ""}{h.title}<small>{h.source} · {h.mode} · {new Date(h.createdAt).toLocaleDateString()} · {h.complete ? "完整手牌" : "决策片段"}</small></button>)}</div>
      {!items.length && <p className="study-muted">还没有匹配的牌谱。正常对局完成一手后会自动保存；也可以在实验室保存。</p>}{cursor && <button onClick={() => void refresh(true)}>加载更多牌谱</button>}
    </aside><section className="study-stack">
      {!record ? <div className="study-panel study-empty"><h2>选择一手牌</h2><p>按决策点自测、记录疑问，或创建不覆盖原牌局的研究分支。</p></div> : <>
        <section className="study-panel"><div className="study-row"><h2>{record.title}</h2><button onClick={() => void updateDetails({ starred: !record.starred })}>{record.starred ? "取消收藏" : "收藏牌谱"}</button></div>
          <details><summary>编辑标题和标签</summary><form className="study-form-grid" key={record.id} onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void updateDetails({ title: String(data.get("title")).slice(0, 200), tags: String(data.get("tags")).split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 30) }); }}><label>标题<input name="title" defaultValue={record.title} maxLength={200} /></label><label>标签（逗号分隔）<input name="tags" defaultValue={record.tags.join(",")} /></label><button>保存标题和标签</button></form></details>
          <label className="study-check"><input type="checkbox" checked={selfTest} onChange={e => { setSelfTest(e.target.checked); setRevealed(false); setAnswer(""); }} />遮挡后续过程，先做决策自测</label>
          {selfTest ? decision ? <>
            <label>学习者决策点<select aria-label="学习者决策点" value={point} onChange={e => { setPoint(Number(e.target.value)); setRevealed(false); setAnswer(""); setNote(""); }}>{points.map((d, i) => <option value={i} key={d.sequence}>{i + 1} · {d.state.hand?.phase} · 事件 {d.sequence}</option>)}</select></label>
            <StudyTable state={decision.state} heroId={record.heroId} />
            {!revealed && <><p>先选择你的动作。没有匹配参考的自测不计专业对错。</p><ActionControls legal={getLegalActions(decision.state)} onAction={a => { setAnswer(actionKey(a)); setRevealed(true); }} /></>}
            {revealed && <div className="study-feedback" role="status"><p>你的选择：{answer}。原行动：{actual ? `${actual.public.action}${Number(actual.public.to) > 0 ? `（本轮投入到 ${actual.public.to}）` : ""}` : "此记录没有保存后续行动"}。</p><p>这只是与原选择对照，并不意味着原行动是正确答案。</p><button onClick={() => { setRevealed(false); setAnswer(""); }}>重新自测</button></div>}
          </> : <p>这份记录没有学习者可恢复的决策点，请关闭自测查看事件回放。</p>
            : <><p className="study-warning">完整回放会展示后续公共牌与结果，不再作为首次无提示测试。</p>{frame && <><div className="study-inline"><button disabled={frameIndex === 0} onClick={() => setFrameIndex(i => i - 1)}>上一步</button><input aria-label="回放进度" type="range" min="0" max={Math.max(0, frames.length - 1)} value={frameIndex} onChange={e => setFrameIndex(Number(e.target.value))} /><button disabled={frameIndex === frames.length - 1} onClick={() => setFrameIndex(i => i + 1)}>下一步</button></div><h3>{frame.label} · {frame.phase}</h3><div className="study-cards">{frame.heroCards.map(c => <CardTile key={c} card={c} />)}</div><div className="study-cards">{frame.board.map(c => <CardTile key={c} card={c} />)}</div><p>底池 {frame.pot}</p><div className="study-scroll">{frame.actions.map((a, i) => <p key={i}>{a.playerId}：{a.label}</p>)}</div></>}
            </>}
        </section>
        {decision && <section className="study-panel"><h3>从决策点 {decision.sequence} 研究</h3><label>未知牌抽样种子<input aria-label="分支种子" type="number" min="0" max="4294967295" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label><div className="study-inline"><button onClick={() => launchBranch(false)}>按原牌序重打</button><button onClick={() => launchBranch(true)}>重抽未知牌后练习</button></div><p className="study-muted">未知牌重抽保留当时的底牌和公共牌，不读取历史对手底牌作为答案。</p>
          {(!selfTest || revealed) && <><label>决策笔记<textarea aria-label="决策笔记" value={note} onChange={e => setNote(e.target.value)} maxLength={10000} rows={3} /></label><label>关联知识点<select value={skill} onChange={e => setSkill(e.target.value)}>{LESSONS.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label><button disabled={!note.trim()} onClick={() => { const n: Note = { id: uid("note"), handId: record.id, sequence: decision.sequence, text: note.trim(), skill, createdAt: Date.now() }; void saveNote(n).then(() => { setNotes(ns => [...ns, n]); setNote(""); setMessage("决策笔记已保存。"); }).catch(e => setError(errorText(e))); }}>保存决策笔记</button>{notes.filter(n => n.sequence === decision.sequence).map(n => <article className="study-note" key={n.id}><small>{LESSONS.find(l => l.id === n.skill)?.title ?? n.skill}</small><p>{n.text}</p></article>)}</>}
        </section>}
        {branches.length > 0 && (!selfTest || revealed) && <section className="study-panel"><h3>已保存研究分支</h3><div className="study-lesson-list">{branches.map(b => <button key={b.id} onClick={() => { try { onLab({ id: uid("launch"), state: rehydrateTournament(b.events), parent: record, sequence: b.sequence, mode: b.mode, seed: b.seed, branch: b }); } catch (e) { setError(errorText(e)); } }}>{b.title}<small>{b.mode === "resample" ? "未知牌重抽" : "原牌序"} · {b.assumptions}</small></button>)}</div><p>分支按过程独立保存；这里不以单次赢得筹码作为策略排名。</p></section>}
      </>}
    </section></div>
  </div>;
}
