import { useEffect, useRef, useState } from "react";
import { decideBotAction } from "../bots/bot";
import { getLegalActions, submitAction } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import type { GameState, PlayerAction } from "../domain/types";
import { compileScenario, decisionContext, exampleScenario, recordHand, SeededRandom, validateScenario } from "./scenario";
import { gradeReference, validateReference } from "./grading";
import { errorText, uid, type Branch, type HandRecord, type Scenario, type StrategyReference } from "./model";
import { downloadJSON, loadReferences, readJSON, saveBranch, saveHand, saveReference } from "./storage";
import { StudyTable } from "./Table";
import { AnalysisPanel, RangeGrid } from "./Analysis";

export interface LabLaunch {
  id: string; scenario?: Scenario; state?: GameState;
  parent?: HandRecord; sequence?: number; mode?: Branch["mode"]; seed?: number; branch?: Branch;
}
export function Lab({ launch, onLibrary }: { launch: LabLaunch | null; onLibrary: () => void }) {
  const [scenario, setScenario] = useState(() => launch?.scenario ?? exampleScenario());
  const [editor, setEditor] = useState(() => JSON.stringify(launch?.scenario ?? exampleScenario(), null, 2));
  const [state, setState] = useState<GameState>(() => launch?.state ? structuredClone(launch.state) : compileScenario(launch?.scenario ?? exampleScenario()));
  const [root, setRoot] = useState(state); const [heroId, setHeroId] = useState(launch?.parent?.heroId ?? scenario.heroId);
  const [history, setHistory] = useState<GameState[]>([]); const [research, setResearch] = useState(false);
  const [parent, setParent] = useState(launch?.parent); const [title, setTitle] = useState(launch?.branch?.title ?? (launch?.parent ? `${launch.parent.title} · 研究分支` : scenario.title));
  const [assumptions, setAssumptions] = useState(launch?.branch?.assumptions ?? scenario.assumptions);
  const [seed, setSeed] = useState(launch?.seed ?? scenario.seed); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [references, setReferences] = useState<StrategyReference[]>([]); const [selectedRef, setSelectedRef] = useState(""); const [grade, setGrade] = useState<ReturnType<typeof gradeReference> | null>(null);
  const botRandom = useRef(new SeededRandom(seed));
  useEffect(() => { void loadReferences().then(setReferences).catch(e => setError(errorText(e))); }, []);
  const context = decisionContext(state, heroId, assumptions);
  useEffect(() => { setGrade(null); }, [assumptions, research, selectedRef]);
  const applyAction = (playerId: string, action: PlayerAction) => {
    try {
      const r = submitAction(state, playerId, action); if (!r.ok) throw new Error(r.error.message);
      if (playerId === heroId) setGrade(research ? { status: "ungraded", message: "研究视角已揭牌，不作为独立训练评分。" } : gradeReference(references.find(r => r.id === selectedRef), context, action));
      else setGrade(null);
      setHistory(h => [...h, state]); setState(r.state); setError(""); setMessage("");
    } catch (e) { setError(errorText(e)); }
  };
  const applyEditor = (value: unknown) => {
    try {
      const s = validateScenario(value); const compiled = compileScenario(s);
      setScenario(s); setEditor(JSON.stringify(s, null, 2)); setState(compiled); setRoot(compiled); setHeroId(s.heroId); setHistory([]); setParent(undefined);
      setTitle(s.title); setAssumptions(s.assumptions); setSeed(s.seed); botRandom.current = new SeededRandom(s.seed); setGrade(null); setResearch(false); setMessage("局面已通过合法性验证。"); setError("");
    } catch (e) { setError(errorText(e)); }
  };
  const save = async () => {
    setSaving(true); setError("");
    try {
      if (parent && launch?.sequence !== undefined) {
        const branch: Branch = { id: launch.branch?.id ?? uid("branch-record"), handId: parent.id, sequence: launch.sequence, title, mode: launch.mode ?? "original", seed, assumptions, events: structuredClone(state.events), createdAt: Date.now() };
        await saveHand(parent); await saveBranch(branch); setMessage("研究分支已保存，原牌谱没有改变。");
      } else { const record = recordHand(state, heroId, "lab", title); await saveHand({ ...record, title, tags: ["实验", state.hand?.phase ?? ""] }, false); setMessage("实验牌谱已保存到个人牌谱库。"); }
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  const botStep = () => {
    const legal = getLegalActions(state); if (!legal || legal.playerId === heroId) return;
    try { applyAction(legal.playerId, decideBotAction(projectPlayerView(state, legal.playerId), "normal", "balanced", botRandom.current)); }
    catch (e) { setError(errorText(e)); }
  };
  const legal = getLegalActions(state);
  return <div className="study-page"><header className="study-heading"><div><p className="study-eyebrow">SCENARIO LAB</p><h1>局面实验室</h1><p>只改变你要研究的条件。原牌复现不是长期收益证明。</p></div><button onClick={onLibrary}>打开个人牌谱库</button></header>
    {error && <p role="alert" className="study-error">{error}</p>}{message && <p role="status" className="study-notice">{message}</p>}
    {parent && <p className="study-notice">来源：{parent.title} · 决策点 {launch?.sequence} · {launch?.mode === "resample" ? "已重抽未知牌（原始历史不变）" : "固定原牌序"}。分支只由新动作推进，不会强行播放旧回应。</p>}
    <div className="study-two-column study-lab-layout"><div className="study-stack">
      <section className="study-panel"><label>研究名称<input aria-label="研究名称" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label><label>假设与笔记<textarea value={assumptions} onChange={e => setAssumptions(e.target.value)} rows={2} maxLength={10000} /></label>
        <div className="study-inline"><label className="study-check"><input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)} />研究视角：显示所有底牌</label><button onClick={() => { if (history.length) { setState(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setGrade(null); } }} disabled={!history.length}>撤回一步</button><button onClick={() => { setState(structuredClone(root)); setHistory([]); setGrade(null); botRandom.current = new SeededRandom(seed); }}>重置到起点</button></div>
        <StudyTable state={state} heroId={heroId} research={research} manualOpponents onAction={applyAction} />
        {legal && legal.playerId !== heroId && <button onClick={botStep}>让算法对手行动一步</button>}
        <p className="study-muted">算法对手只读取自己的玩家视角；其选择不是专业标准答案。所有按钮均经过生产规则引擎校验。</p>
        <div className="study-inline"><button className="study-primary" onClick={() => void save()} disabled={saving}>{parent ? "保存研究分支" : "保存实验牌谱"}</button></div>
      </section>
      <details className="study-panel"><summary>构造局面 · 固定发牌与合法前序动作</summary>
        {parent && <p className="study-warning">修改下面定义并应用会创建独立局面，不会继续沿用原牌谱的分支关联或评分。</p>}
        <div className="study-inline">{(["preflop", "flop", "turn", "river"] as const).map(street => <button key={street} onClick={() => setEditor(JSON.stringify(exampleScenario(street), null, 2))}>{({ preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌" })[street]}模板</button>)}</div>
        <p>players 的顺序是座位顺序，dealerSeat 从 0 开始；board 是预定公共牌，不一定已经发出；prefix 每一步必须合法。可设置 2–9 人及不同筹码。</p>
        <label>局面 JSON<textarea aria-label="局面 JSON" className="study-code" rows={18} value={editor} onChange={e => setEditor(e.target.value)} spellCheck={false} /></label>
        <div className="study-inline"><button onClick={() => { try { applyEditor(JSON.parse(editor)); } catch (e) { setError(errorText(e)); } }}>验证并应用局面</button><button onClick={() => downloadJSON("rivercraft-scenario.json", scenario)}>导出已应用局面</button><label className="study-file">导入局面<input type="file" accept="application/json,.json" onChange={e => { const f = e.target.files?.[0]; if (f) void readJSON(f).then(applyEditor).catch(x => setError(errorText(x))); e.target.value = ""; }} /></label></div>
      </details>
      <RangeGrid />
      <details className="study-panel"><summary>专业参考 · 严格匹配与导入</summary><p>这里只使用来源、版本、单位和误差齐全的本地参考。当前局面签名包含行动历史与上述假设；修改条件后旧参考会失效。导入前请确认数据有使用许可。</p>
        <label>参考策略<select value={selectedRef} onChange={e => { setSelectedRef(e.target.value); setGrade(null); }}><option value="">无参考（不计专业分）</option>{references.map(r => <option key={r.id} value={r.id}>{r.source} · {r.id} · {r.revision}</option>)}</select></label>
        <div className="study-inline"><button onClick={() => downloadJSON("rivercraft-decision-context.json", { context, assumptions, legalActions: legal, note: "这只是待匹配的局面签名，不是策略答案。" })}>导出当前决策签名</button><label className="study-file">导入参考 JSON<input type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (f) void readJSON(f).then(validateReference).then(async r => { await saveReference(r); setReferences(await loadReferences()); setSelectedRef(r.id); setMessage("参考已导入；仅在上下文完全匹配时评分。"); }).catch(x => setError(errorText(x))); e.target.value = ""; }} /></label></div>
        {selectedRef && <p className="study-muted">{references.find(r => r.id === selectedRef)?.context === context ? "当前条件匹配。下一次学习者行动可评价。" : "当前条件不匹配，不严格评分。"}</p>}
      </details>
      {grade && <div className="study-feedback" role="status"><strong>行动反馈</strong><p>{grade.message}</p>{grade.frequency !== undefined && <p>参考频率 {(grade.frequency * 100).toFixed(2)}% · 单次选择不作为频率误差证据。</p>}</div>}
    </div><AnalysisPanel key={root.id} state={state} heroId={heroId} /></div>
  </div>;
}
