import { useEffect, useRef, useState } from "react";
import type { GameState } from "../domain/types";
import { actionKey, errorText } from "./model";
import { candidateActions, type RolloutInput, type RolloutResult } from "./rollout";
import { decisionPoints, recordHand } from "./scenario";
import { downloadJSON } from "./storage";
const label = (key: string) => ({ fold: "弃牌", check: "过牌", call: "跟注", "all-in": "全下" })[key] ?? key.replace("raise:", "加注到 ");

export function CounterfactualPanel({ state, heroId }: { state: GameState; heroId: string }) {
  const [trials, setTrials] = useState(100); const [seed, setSeed] = useState(42); const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0); const [result, setResult] = useState<RolloutResult | null>(null); const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null); const id = useRef(0); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { id.current++; worker.current?.terminate(); worker.current = null; clearTimeout(timer.current); setBusy(false); setResult(null); };
  useEffect(() => { cancel(); }, [state, trials, seed]);
  useEffect(() => () => { id.current++; worker.current?.terminate(); clearTimeout(timer.current); }, []);
  const candidates = candidateActions(state, heroId);
  const run = () => {
    cancel(); setError(""); setCompleted(0);
    try {
      const record = recordHand(state, heroId, "lab"); const point = decisionPoints(record.events, heroId).at(-1);
      if (!point || !candidates.length) throw new Error("请先停在学习者的合法决策点。");
      const input: RolloutInput = { record, sequence: point.sequence, actions: candidates, trials, seed };
      const w = new Worker(new URL("./rollout.worker.ts", import.meta.url), { type: "module" }); worker.current = w; const requestId = ++id.current; setBusy(true);
      const finish = () => { clearTimeout(timer.current); w.terminate(); worker.current = null; setBusy(false); };
      w.onmessage = (event: MessageEvent<{ id: number; completed?: number; result?: RolloutResult; error?: string }>) => {
        if (worker.current !== w || event.data.id !== id.current) return;
        if (event.data.completed !== undefined) setCompleted(event.data.completed);
        if (event.data.error) { setError(event.data.error); finish(); }
        else if (event.data.result) { setResult(event.data.result); finish(); }
      };
      w.onerror = () => { if (worker.current === w) { setError("模拟线程失败，请减少样本后重试。"); finish(); } };
      timer.current = setTimeout(() => { if (worker.current === w) { setError("已停止耗时模拟，没有返回不完整结果。请减少候选局面的复杂度或样本数。"); finish(); } }, 45000);
      w.postMessage({ id: requestId, input });
    } catch (e) { cancel(); setError(errorText(e)); }
  };
  return <details className="study-panel" aria-label="行动模拟对比"><summary>同一决策点 · 多次模拟对比</summary><p>不是将某条原牌序多播放几次。每次都重新抽取未知牌，并让所有候选动作使用同一份未知牌样本。</p><p className="study-warning">这里评估固定的普通／均衡算法后续策略，包含学习者自己的后续动作；不代表最优策略，也不代表真实对手。区间可能很宽，不能据此强行判分。</p>
    <p>候选动作：{candidates.length ? candidates.map(a => label(actionKey(a))).join("、") : "当前不是学习者行动，请先推进或撤回到学习者决策点。"}</p>
    <div className="study-inline"><label>模拟样本数<input aria-label="模拟样本数" type="number" min="10" max="1000" value={trials} onChange={e => setTrials(Number(e.target.value))} /></label><label>模拟种子<input aria-label="模拟种子" type="number" min="0" max="4294967295" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label></div>
    <div className="study-inline"><button className="study-primary" onClick={run} disabled={busy || !candidates.length}>比较合法候选动作</button>{busy && <button onClick={cancel}>取消模拟</button>}{result && <button onClick={() => downloadJSON("rivercraft-action-comparison.json", result)}>导出模拟结果</button>}</div>
    {busy && <p role="status">已完成 {completed}/{trials} 份共同样本。</p>}{error && <p role="alert" className="study-error">{error}</p>}
    {result && <div role="status"><p>{result.assumptions}</p><div className="study-scroll"><table style={{ width: "100%", fontSize: 12, borderSpacing: 8, borderCollapse: "separate" }}><thead><tr><th>动作</th><th>平均增量</th><th>95% 保守区间</th><th>标准误</th></tr></thead><tbody>{result.actions.map(row => <tr key={actionKey(row.action)}><td>{label(actionKey(row.action))}</td><td>{row.mean.toFixed(2)}</td><td>{row.lower95.toFixed(1)} 至 {row.upper95.toFixed(1)}</td><td>{row.standardError.toFixed(2)}</td></tr>)}</tbody></table></div><p className="study-muted">单位：筹码。按候选动作列出，不以一次结果排序为“最优”。样本数 {result.trials}，种子 {result.seed}。</p></div>}
  </details>;
}
