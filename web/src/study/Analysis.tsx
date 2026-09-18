import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../domain/types";
import { projectPlayerView } from "../domain/view";
import { PREFLOP_BASELINES } from "./curriculum";
import { errorText } from "./model";
import { parseCards } from "./scenario";
import { parseRange, rangeMatrix, requiredEquity, terminalCallEV, type EquityResult, type RiverResult } from "./math";
import type { AnalysisRequest } from "./analysis.worker";
import { downloadJSON } from "./storage";

type Payload = AnalysisRequest extends infer Q ? Q extends AnalysisRequest ? Omit<Q, "id"> : never : never;
function useAnalysis() {
  const worker = useRef<Worker | null>(null); const sequence = useRef(0); const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState<unknown>(null);
  const cancel = (clear = true) => { sequence.current++; worker.current?.terminate(); worker.current = null; clearTimeout(timeout.current); setBusy(false); if (clear) setResult(null); };
  useEffect(() => () => { sequence.current++; worker.current?.terminate(); clearTimeout(timeout.current); }, []);
  const run = (payload: Payload) => {
    cancel(); setError(""); setBusy(true); const id = ++sequence.current;
    try {
      const w = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" }); worker.current = w;
      const finish = () => { clearTimeout(timeout.current); w.terminate(); worker.current = null; setBusy(false); };
      w.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => { if (worker.current !== w || event.data.id !== sequence.current) return; if (event.data.error) setError(event.data.error); else setResult(event.data.result); finish(); };
      w.onerror = () => { if (worker.current !== w) return; setError("计算线程失败。请缩小范围后重试。"); finish(); };
      timeout.current = setTimeout(() => { if (worker.current !== w) return; sequence.current++; setError("已停止本次耗时计算。请缩小组合范围或减少采样。"); finish(); }, 45000);
      w.postMessage({ ...payload, id });
    } catch (e) { cancel(); setError(errorText(e)); }
  };
  return { busy, error, result, run, cancel, setError };
}
const pct = (n: number) => `${(100 * n).toFixed(2)}%`;
export function RangeGrid() {
  const [selected, setSelected] = useState<string[]>([]); const [baseline, setBaseline] = useState(0); const [compare, setCompare] = useState(false);
  const target = useMemo(() => {
    const classes = new Set<string>(); const ranks = "23456789TJQKA";
    for (const c of parseRange(PREFLOP_BASELINES[baseline].range)) { const [a, b] = c.cards; const r = ranks.indexOf(a[0]) > ranks.indexOf(b[0]) ? a[0] + b[0] : b[0] + a[0]; classes.add(r + (a[0] === b[0] ? "" : a[1] === b[1] ? "s" : "o")); }
    return classes;
  }, [baseline]);
  return <details className="study-panel"><summary>起手牌范围矩阵 · 教学核心范围</summary><p>点选你会纳入的起手牌，再对比练习基准。s 为同花，o 为不同花。</p>
    <label>教学位置<select value={baseline} onChange={e => { setBaseline(Number(e.target.value)); setCompare(false); }}>{PREFLOP_BASELINES.map((b, i) => <option key={b.position} value={i}>{b.position}</option>)}</select></label>
    <p className="study-notice">{PREFLOP_BASELINES[baseline].context}。{PREFLOP_BASELINES[baseline].label}。</p>
    <div className="study-range-wrap"><div className="study-range-grid" role="group" aria-label="起手牌范围矩阵">{rangeMatrix().flat().map(hand => <button key={hand} aria-label={hand} aria-pressed={selected.includes(hand)} className={`${selected.includes(hand) ? "study-range-selected" : ""} ${compare && target.has(hand) ? "study-range-reference" : ""}`} onClick={() => { setSelected(s => s.includes(hand) ? s.filter(x => x !== hand) : [...s, hand]); setCompare(false); }}>{hand}</button>)}</div></div>
    <div className="study-inline"><button onClick={() => setCompare(true)}>对比教学基准</button><button onClick={() => { setSelected([]); setCompare(false); }}>清空选择</button></div>
    {compare && <p role="status">绿色填充是你的选择，金色边框是教学核心范围。基准内未选 {Array.from(target).filter(h => !selected.includes(h)).length} 类；基准外选了 {selected.filter(h => !target.has(h)).length} 类。此差异不等于专业 EV 损失。</p>}
  </details>;
}
export function AnalysisPanel({ state, heroId }: { state: GameState; heroId: string }) {
  const view = projectPlayerView(state, heroId); const hero = view.players.find(p => p.id === heroId)!;
  const opponents = view.players.filter(p => p.id !== heroId && !p.eliminated && !p.folded).length;
  const [tab, setTab] = useState<"equity" | "river" | "icm">("equity"); const [ranges, setRanges] = useState("random");
  const [samples, setSamples] = useState(1000); const [seed, setSeed] = useState(42);
  const [riverBoard, setRiverBoard] = useState("Ac 7d 2c 9s 3h"); const [bettor, setBettor] = useState("AsAd,JsTs"); const [defender, setDefender] = useState("KsKd");
  const [pot, setPot] = useState(100); const [bet, setBet] = useState(50); const [iterations, setIterations] = useState(4000); const [locked, setLocked] = useState("");
  const [stacks, setStacks] = useState("100,100,100"); const [payouts, setPayouts] = useState("50,30,20");
  const [terminal, setTerminal] = useState(false); const [call, setCall] = useState(50); const [eligible, setEligible] = useState(150);
  const job = useAnalysis();
  const publicKey = JSON.stringify([hero.holeCards, view.hand?.board, view.players.map(p => [p.id, p.folded, p.stack]), view.hand?.currentBet]);
  useEffect(() => { job.cancel(); setRanges(Array.from({ length: Math.max(1, opponents) }, () => "random").join("\n")); setTerminal(false); }, [publicKey]);
  useEffect(() => { job.cancel(); }, [tab, ranges, samples, seed, riverBoard, bettor, defender, pot, bet, iterations, locked, stacks, payouts]);
  const execute = () => {
    try {
      if (tab === "equity") {
        if (!hero.holeCards || opponents < 1) throw new Error("至少需要一个未弃牌对手。");
        const list = ranges.split("\n").map(r => r.trim()).filter(Boolean); if (list.length !== opponents) throw new Error(`每个对手一行范围，当前需要 ${opponents} 行。`);
        job.run({ type: "equity", input: { hero: hero.holeCards, board: view.hand?.board ?? [], ranges: list, samples, seed } });
      } else if (tab === "river") job.run({ type: "river", input: { board: parseCards(riverBoard), bettorRange: bettor, defenderRange: defender, pot, bet, iterations, ...(locked.trim() ? { lockedCall: Number(locked) } : {}) } });
      else job.run({ type: "icm", input: { stacks: stacks.split(/[\s,]+/).filter(Boolean).map(Number), payouts: payouts.split(/[\s,]+/).filter(Boolean).map(Number) } });
    } catch (e) { job.setError(errorText(e)); }
  };
  const equity = tab === "equity" ? job.result as EquityResult | null : null;
  const river = tab === "river" ? job.result as RiverResult | null : null;
  let terminalResult = "";
  if (equity && terminal) { try { terminalResult = `终局增量 EV ${terminalCallEV(equity.equity, call, eligible).toFixed(2)} 筹码；所需权益 ${pct(requiredEquity(call, eligible))}。`; } catch (e) { terminalResult = errorText(e); } }
  return <section className="study-panel" aria-label="分析工具"><h2>分析工具</h2><div className="study-inline" role="group" aria-label="分析类型">
    <button aria-pressed={tab === "equity"} onClick={() => setTab("equity")}>范围权益</button><button aria-pressed={tab === "river"} onClick={() => setTab("river")}>河牌求解</button><button aria-pressed={tab === "icm"} onClick={() => setTab("icm")}>ICM</button></div>
    {tab === "equity" ? <><p>只用学习者当前可见牌；每个未弃牌对手一行范围。支持 QQ+、ATs+、AsKh:0.5、random。</p><label>对手范围<textarea aria-label="对手范围" value={ranges} onChange={e => setRanges(e.target.value)} rows={Math.max(2, opponents)} /></label><div className="study-inline"><label>样本数<input type="number" min="50" max="50000" value={samples} onChange={e => setSamples(Number(e.target.value))} /></label><label>分析种子<input type="number" min="0" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label></div></>
      : tab === "river" ? <><p className="study-notice">独立的有限河牌研究模型，不自动代表上方牌桌。过牌直接摊牌，下注后只能弃牌或跟注；无加注、抽水或后续行动。</p><div className="study-form-grid"><label>五张公共牌<input value={riverBoard} onChange={e => setRiverBoard(e.target.value)} /></label><label>先行动者范围<input value={bettor} onChange={e => setBettor(e.target.value)} /></label><label>应对者范围<input value={defender} onChange={e => setDefender(e.target.value)} /></label><label>底池<input type="number" value={pot} onChange={e => setPot(Number(e.target.value))} /></label><label>固定下注额<input type="number" value={bet} onChange={e => setBet(Number(e.target.value))} /></label><label>迭代数<input type="number" min="100" max="10000" value={iterations} onChange={e => setIterations(Number(e.target.value))} /></label><label>锁定对手跟注率（0–1，留空为自由策略）<input value={locked} onChange={e => setLocked(e.target.value)} placeholder="不锁定" /></label></div></>
      : <><p className="study-notice">ICM 只计算奖励权益，不是完整赛事策略求解。先移除已淘汰玩家；不建模技术优势或未来盲注。</p><label>各玩家正筹码量<input value={stacks} onChange={e => setStacks(e.target.value)} /></label><label>名次奖励（递减，可少于人数）<input value={payouts} onChange={e => setPayouts(e.target.value)} /></label></>}
    <div className="study-inline"><button className="study-primary" onClick={execute} disabled={job.busy}>运行计算</button>{job.busy && <button onClick={() => job.cancel()}>取消计算</button>}{job.result !== null && <button onClick={() => downloadJSON("rivercraft-analysis.json", { kind: tab, input: tab === "equity" ? { hero: hero.holeCards, board: view.hand?.board, ranges, samples, seed } : tab === "river" ? { riverBoard, bettor, defender, pot, bet, iterations, locked } : { stacks, payouts }, result: job.result })}>导出分析及假设</button>}</div>
    {job.busy && <p role="status">计算中，可随时取消。改变输入会使旧结果失效。</p>}{job.error && <p className="study-error" role="alert">{job.error}</p>}
    {equity && <div className="study-feedback" role="status"><div className="study-metrics"><div><strong>{pct(equity.equity)}</strong><span>权益／平均底池份额</span></div><div><strong>{pct(equity.win)}</strong><span>独赢</span></div><div><strong>{pct(equity.tie)}</strong><span>平局</span></div></div><p>{equity.exact ? "精确河牌枚举" : `随机采样 ${equity.samples} 次，95% 保守误差 ±${pct(equity.margin95)}`}。</p><p>{equity.assumptions}</p>
      <label className="study-check"><input type="checkbox" checked={terminal} onChange={e => setTerminal(e.target.checked)} />我确认用于下面计算的局面没有后续下注、抽水，并已排除无资格争夺的边池</label>
      {terminal && <><div className="study-inline"><label>实际跟注成本<input type="number" value={call} onChange={e => setCall(Number(e.target.value))} /></label><label>跟注前可争夺底池<input type="number" value={eligible} onChange={e => setEligible(Number(e.target.value))} /></label></div><p>{terminalResult}采样误差同样影响该 EV，不能忽略。</p></>}
    </div>}
    {river && <div className="study-feedback" role="status"><p>{river.assumptions}</p><div className="study-metrics"><div><strong>{river.lower.toFixed(3)} – {river.upper.toFixed(3)}</strong><span>最佳回应界 · 筹码</span></div><div><strong>{river.gap.toFixed(4)}</strong><span>剩余差距</span></div></div><p>平均策略值 {river.value.toFixed(3)} · {river.pairs} 个合法组合对 · {river.iterations} 次迭代</p><div className="study-form-grid"><div><h3>下注频率</h3>{river.bettor.map(r => <p key={r.hand}>{r.hand} · {pct(r.bet)}</p>)}</div><div><h3>跟注频率</h3>{river.defender.map(r => <p key={r.hand}>{r.hand} · {pct(r.call)}</p>)}</div></div></div>}
    {tab === "icm" && Array.isArray(job.result) && <div className="study-feedback" role="status">{(job.result as number[]).map((n, i) => <p key={i}>玩家 {i + 1}：{n.toFixed(4)} 奖励单位</p>)}</div>}
  </section>;
}
