import { useEffect, useRef, useState } from "react";
import { decideBotAction } from "../bots/bot";
import { getLegalActions, submitAction } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import type { GameState, PlayerAction } from "../domain/types";
import { compileScenario, decisionContext, exampleScenario, recordHand, SeededRandom, validateScenario } from "./scenario";
import { gradeReference, validateReference } from "./grading";
import { errorText, uid, type Backup, type Branch, type HandRecord, type Scenario, type StrategyReference } from "./model";
import { downloadJSON, loadReferences, readJSON, saveBranch, saveHand, saveReference } from "./storage";
import { loadLabDraft, saveLabDraft, type LabDraft } from "./draft";
import { registerLeaveGuard } from "./lifecycle";
import { StudyTable } from "./Table";
import { AnalysisPanel, RangeGrid } from "./Analysis";

export interface LabLaunch { id: string; scenario?: Scenario; state?: GameState; parent?: HandRecord; sequence?: number; mode?: Branch["mode"]; seed?: number; branch?: Branch }
const archive = async (draft: LabDraft, automatic: boolean) => {
  if (draft.parent && draft.sequence !== undefined) {
    await saveHand(draft.parent);
    await saveBranch({ id: draft.branchId, handId: draft.parent.id, sequence: draft.sequence, title: draft.title, mode: draft.mode, seed: draft.seed, assumptions: draft.assumptions, events: structuredClone(draft.state.events), createdAt: Date.now() });
  } else {
    const record = recordHand(draft.state, draft.heroId, "lab", draft.title);
    await saveHand({ ...record, title: draft.title, tags: ["实验", draft.state.hand?.phase ?? ""] }, automatic);
  }
};
export function Lab({ launch, onLibrary }: { launch: LabLaunch | null; onLibrary: () => void }) {
  const [scenario, setScenario] = useState(() => launch?.scenario ?? exampleScenario());
  const [editor, setEditor] = useState(() => JSON.stringify(launch?.scenario ?? exampleScenario(), null, 2));
  const [state, setState] = useState<GameState>(() => launch?.state ? structuredClone(launch.state) : compileScenario(launch?.scenario ?? exampleScenario()));
  const [root, setRoot] = useState(state); const [heroId, setHeroId] = useState(launch?.parent?.heroId ?? scenario.heroId);
  const [history, setHistory] = useState<GameState[]>([]); const [research, setResearch] = useState(false); const [ready, setReady] = useState(Boolean(launch));
  const [parent, setParent] = useState(launch?.parent); const [originSequence, setOriginSequence] = useState(launch?.sequence); const [originMode, setOriginMode] = useState<Branch["mode"]>(launch?.mode ?? "original");
  const [branchId, setBranchId] = useState(launch?.branch?.id ?? uid("branch-record"));
  const [title, setTitle] = useState(launch?.branch?.title ?? (launch?.parent ? `${launch.parent.title} · 研究分支` : scenario.title));
  const [assumptions, setAssumptions] = useState(launch?.branch?.assumptions ?? scenario.assumptions); const [seed, setSeed] = useState(launch?.seed ?? scenario.seed);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [draftStatus, setDraftStatus] = useState("");
  const [references, setReferences] = useState<StrategyReference[]>([]); const [selectedRef, setSelectedRef] = useState(""); const [grade, setGrade] = useState<ReturnType<typeof gradeReference> | null>(null);
  const writes = useRef(Promise.resolve()); const generation = useRef(0); const mounted = useRef(true);
  const draft: LabDraft = { version: 1, state, root, scenario, heroId, title, assumptions, seed, parent, sequence: originSequence, mode: originMode, branchId };
  const latest = useRef(draft); latest.current = draft; const isReady = useRef(ready); isReady.current = ready;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => registerLeaveGuard(async () => {
    if (!isReady.current) return; await writes.current;
    const d = latest.current;
    if (d.parent || d.state.events.length !== d.root.events.length || d.title !== d.scenario.title || d.assumptions !== d.scenario.assumptions) await archive(d, true);
  }), []);
  useEffect(() => {
    let active = true;
    void loadReferences().then(r => { if (active) setReferences(r); }).catch(e => { if (active) setError(errorText(e)); });
    if (!launch) void loadLabDraft().then(d => {
      if (!active) return;
      if (d) { setState(d.state); setRoot(d.root); setScenario(d.scenario); setEditor(JSON.stringify(d.scenario, null, 2)); setHeroId(d.heroId); setTitle(d.title); setAssumptions(d.assumptions); setSeed(d.seed); setParent(d.parent); setOriginSequence(d.sequence); setOriginMode(d.mode); setBranchId(d.branchId); setMessage("已恢复上一次实验草稿，隐藏信息仍按学习者视角显示。"); }
      setReady(true);
    }).catch(e => { if (active) { setError(`草稿恢复失败：${errorText(e)}`); setReady(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const revision = ++generation.current; const value = latest.current; setDraftStatus("正在保存草稿…");
    writes.current = writes.current.catch(() => undefined).then(async () => { if (revision !== generation.current) return; await saveLabDraft(value); if (mounted.current && revision === generation.current) setDraftStatus("草稿已保存"); });
    void writes.current.catch(e => { if (mounted.current) { setDraftStatus("草稿保存失败，请导出当前研究备份"); setError(errorText(e)); } });
  }, [ready, state, root, scenario, heroId, title, assumptions, seed, parent, originSequence, originMode, branchId]);
  const context = decisionContext(state, heroId, assumptions);
  useEffect(() => { setGrade(null); }, [assumptions, research, selectedRef]);
  const applyAction = (playerId: string, action: PlayerAction) => {
    try {
      const r = submitAction(state, playerId, action); if (!r.ok) throw new Error(r.error.message);
      if (playerId === heroId) setGrade(research ? { status: "ungraded", message: "研究视角已揭牌，不作为独立训练评分。" } : gradeReference(references.find(r => r.id === selectedRef), context, action)); else setGrade(null);
      setHistory(h => [...h.slice(-29), state]); setState(r.state); setError(""); setMessage("");
    } catch (e) { setError(errorText(e)); }
  };
  const applyEditor = (value: unknown) => {
    try {
      const s = validateScenario(value); const compiled = compileScenario(s);
      setScenario(s); setEditor(JSON.stringify(s, null, 2)); setState(compiled); setRoot(compiled); setHeroId(s.heroId); setHistory([]); setParent(undefined); setOriginSequence(undefined); setOriginMode("original"); setBranchId(uid("branch-record"));
      setTitle(s.title); setAssumptions(s.assumptions); setSeed(s.seed); setGrade(null); setResearch(false); setMessage("局面已通过合法性验证。"); setError("");
    } catch (e) { setError(errorText(e)); }
  };
  const save = async () => {
    setSaving(true); setError("");
    try { await writes.current; await archive(latest.current, false); setMessage(parent ? "研究分支已保存，原牌谱没有改变。" : "实验牌谱已保存到个人牌谱库。"); }
    catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  const exportCurrent = () => {
    try {
      const h = recordHand(state, heroId, "lab", title); const sequence = h.events.filter(e => e.type === "state-checkpoint").at(-1)?.sequence ?? 1;
      const backup: Backup = { format: "rivercraft-study", version: 1, exportedAt: Date.now(), hands: [h], notes: [{ id: uid("note"), handId: h.id, sequence, text: assumptions, skill: "self-review", createdAt: Date.now() }], branches: [], attempts: [], references: [] };
      downloadJSON("rivercraft-current-research.json", backup);
    } catch (e) { setError(errorText(e)); }
  };
  const botStep = () => {
    const legal = getLegalActions(state); if (!legal || legal.playerId === heroId) return;
    const actions = state.events.filter(e => e.type === "player-acted").length;
    try { applyAction(legal.playerId, decideBotAction(projectPlayerView(state, legal.playerId), "normal", "balanced", new SeededRandom((seed ^ Math.imul(actions + 1, 0x9e3779b9)) >>> 0))); }
    catch (e) { setError(errorText(e)); }
  };
  const legal = getLegalActions(state);
  if (!ready) return <div className="study-page" role="status">正在恢复实验草稿…</div>;
  return <div className="study-page"><header className="study-heading"><div><p className="study-eyebrow">SCENARIO LAB</p><h1>局面实验室</h1><p>只改变你要研究的条件。原牌复现不是长期收益证明。</p><small className="study-muted" aria-live="polite">{draftStatus}</small></div><button onClick={onLibrary}>打开个人牌谱库</button></header>
    {error && <p role="alert" className="study-error">{error}</p>}{message && <p role="status" className="study-notice">{message}</p>}
    {parent && <p className="study-notice">来源：{parent.title} · 决策点 {originSequence} · {originMode === "resample" ? "已重抽未知牌（原始历史不变）" : "固定原牌序"}。分支只由新动作推进，不会强行播放旧回应。</p>}
    <div className="study-two-column study-lab-layout"><div className="study-stack"><section className="study-panel">
      <label>研究名称<input aria-label="研究名称" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label><label>假设与笔记<textarea value={assumptions} onChange={e => setAssumptions(e.target.value)} rows={2} maxLength={10000} /></label>
      <div className="study-inline"><label className="study-check"><input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)} />研究视角：显示所有底牌</label><button onClick={() => { if (history.length) { setState(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setGrade(null); } }} disabled={!history.length}>撤回一步</button><button onClick={() => { setState(structuredClone(root)); setHistory([]); setGrade(null); }}>重置到起点</button></div>
      <StudyTable state={state} heroId={heroId} research={research} manualOpponents onAction={applyAction} />
      {legal && legal.playerId !== heroId && <button onClick={botStep}>让算法对手行动一步</button>}
      <p className="study-muted">算法对手只读取自己的玩家视角，其选择不是专业标准答案。草稿自动保存；切换入口前会归档已修改的研究。刷新后仍可重置到起点，但临时撤回栈不恢复。</p>
      <div className="study-inline"><button className="study-primary" onClick={() => void save()} disabled={saving}>{parent ? "保存研究分支" : "保存实验牌谱"}</button><button onClick={exportCurrent}>导出当前研究备份</button></div>
    </section>
    <details className="study-panel"><summary>构造局面 · 固定发牌与合法前序动作</summary>{parent && <p className="study-warning">应用下面定义会创建独立局面，不再沿用原牌谱的分支关联或评分。</p>}
      <div className="study-inline">{(["preflop", "flop", "turn", "river"] as const).map(street => <button key={street} onClick={() => setEditor(JSON.stringify(exampleScenario(street), null, 2))}>{({ preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌" })[street]}模板</button>)}</div>
      <p>players 顺序为座位顺序，dealerSeat 从 0 开始；board 是预定公共牌；prefix 每一步必须合法。可设置 2–9 人及不同筹码。编辑后须点击应用。</p>
      <label>局面 JSON<textarea aria-label="局面 JSON" className="study-code" rows={18} value={editor} onChange={e => setEditor(e.target.value)} spellCheck={false} /></label>
      <div className="study-inline"><button onClick={() => { try { applyEditor(JSON.parse(editor)); } catch (e) { setError(errorText(e)); } }}>验证并应用局面</button><button onClick={() => downloadJSON("rivercraft-scenario.json", scenario)}>导出已应用局面</button><label className="study-file">导入局面<input type="file" accept="application/json,.json" onChange={e => { const f = e.target.files?.[0]; if (f) void readJSON(f).then(applyEditor).catch(x => setError(errorText(x))); e.target.value = ""; }} /></label></div>
    </details><RangeGrid />
    <details className="study-panel"><summary>专业参考 · 严格匹配与导入</summary><p>这里只使用来源、版本、单位和误差齐全的本地参考。局面签名包含行动历史与上述假设；修改条件后旧参考失效。导入前请确认数据有使用许可。</p>
      <label>参考策略<select value={selectedRef} onChange={e => { setSelectedRef(e.target.value); setGrade(null); }}><option value="">无参考（不计专业分）</option>{references.map(r => <option key={r.id} value={r.id}>{r.source} · {r.id} · {r.revision}</option>)}</select></label>
      <div className="study-inline"><button onClick={() => downloadJSON("rivercraft-decision-context.json", { context, assumptions, legalActions: legal, note: "局面签名，不是策略答案。" })}>导出当前决策签名</button><label className="study-file">导入参考 JSON<input type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (f) void readJSON(f).then(validateReference).then(async r => { await saveReference(r); setReferences(await loadReferences()); setSelectedRef(r.id); setMessage("参考已导入；仅在上下文完全匹配时评分。"); }).catch(x => setError(errorText(x))); e.target.value = ""; }} /></label></div>
      {selectedRef && <p className="study-muted">{references.find(r => r.id === selectedRef)?.context === context ? "当前条件匹配。下一次学习者行动可评价。" : "当前条件不匹配，不严格评分。"}</p>}
    </details>{grade && <div className="study-feedback" role="status"><strong>行动反馈</strong><p>{grade.message}</p>{grade.frequency !== undefined && <p>参考频率 {(grade.frequency * 100).toFixed(2)}% · 单次选择不作为频率误差证据。</p>}</div>}
    </div><AnalysisPanel key={root.id} state={state} heroId={heroId} /></div></div>;
}
