import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { flushGameSaves, gameSaveStatus } from "../storage/repository";
import { captureCompleted, flushCapture } from "./storage";
import { flushStudyNavigation } from "./lifecycle";
import { errorText, uid } from "./model";
import type { LabLaunch } from "./Lab";
import "./study.css";
const PokerApp = lazy(() => import("../app/PokerApp"));
const Academy = lazy(() => import("../practice/Academy").then(m => ({ default: m.Academy })));
import type { PracticeLaunch } from "../practice/model";
import "../practice/practice.css";
const Lab = lazy(() => import("./Lab").then(m => ({ default: m.Lab })));
const Library = lazy(() => import("./Library").then(m => ({ default: m.Library })));
type Tab = "play" | "learn" | "lab" | "library";
const tabs: Array<[Tab, string]> = [["play", "自由对局"], ["learn", "学习中心"], ["lab", "局面实验室"], ["library", "个人牌谱库"]];
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) { return { error: errorText(error) }; }
  render() { return this.state.error ? <section className="study-page study-error" role="alert"><h1>页面未能打开</h1><p>{this.state.error}</p><p>本地资料没有被删除。可返回其他入口或重新加载。</p><button onClick={() => window.location.reload()}>重新加载</button></section> : this.props.children; }
}
export default function StudyApp() {
  const [tab, setTab] = useState<Tab>(() => tabs.some(([id]) => `#${id}` === location.hash.split("/")[0]) ? location.hash.slice(1).split("/")[0] as Tab : "play");
  const [practiceLaunch, setPracticeLaunch] = useState<PracticeLaunch | null>(null);
  const [launch, setLaunch] = useState<LabLaunch | null>(null); const [switching, setSwitching] = useState(false); const [notice, setNotice] = useState("");
  const playBaseline = useRef(gameSaveStatus().revision); const transition = useRef(false);
  useEffect(() => { const warning = (event: Event) => setNotice((event as CustomEvent<string>).detail); window.addEventListener("rivercraft-study-warning", warning); return () => window.removeEventListener("rivercraft-study-warning", warning); }, []);
  const navigate = async (next: Tab, nextLaunch?: LabLaunch, nextPractice?: PracticeLaunch) => {
    if (transition.current || (next === tab && !nextLaunch && !nextPractice)) return;
    transition.current = true; setSwitching(true); setNotice("");
    try {
      if (tab === "play") {
        // Original table debounce is 120 ms. Preserve the mounted table until the save completes.
        await new Promise(resolve => window.setTimeout(resolve, 240)); await flushGameSaves();
        const status = gameSaveStatus();
        if (status.revision > playBaseline.current && status.status === "playing") { setNotice("当前牌局仍在进行。请先在牌桌点击「暂停」，再切换到学习或研究；不会让牌桌在隐藏页面中继续运行。"); return; }
        const { indexedDbGameRepository } = await import("../storage/repository");
        const saved = await indexedDbGameRepository.loadCurrent();
        // Auxiliary archive failure must not trap users away from their backup tools.
        try { if (saved) await captureCompleted(saved); await flushCapture(); }
        catch (error) { setNotice(`正常对局已保存，但学习归档失败：${errorText(error)}。可在牌谱库重试整理旧对局。`); }
      }
      await flushStudyNavigation();
      if (next === "play") playBaseline.current = gameSaveStatus().revision;
      if (next === "lab") setLaunch(nextLaunch ?? null);
      if (next === "learn") setPracticeLaunch(nextPractice ?? null);
      setTab(next); history.replaceState(null, "", nextPractice ? "#learn/practice" : `#${next}`); window.scrollTo({ top: 0 });
    } catch (error) { setNotice(`切换未完成：${errorText(error)}。当前页面保持打开。`); }
    finally { transition.current = false; setSwitching(false); }
  };
  return <div className="study-shell"><nav className="study-shell-nav" aria-label="应用导航"><a className="study-brand" href="#play" onClick={e => { e.preventDefault(); void navigate("play"); }}>R<span>IVERCRAFT</span><small>PLAY · LEARN · STUDY</small></a><div>{tabs.map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} disabled={switching} onClick={() => void navigate(id)}>{label}</button>)}</div></nav>
    {notice && <div className="study-shell-notice" role="status">{notice}<button aria-label="关闭消息" onClick={() => setNotice("")}>×</button></div>}{switching && <p className="study-switching" role="status">正在确认存档…</p>}
    <div inert={switching || undefined}><Boundary key={`${tab}:${launch?.id ?? ""}`}><Suspense fallback={<div className="study-page" role="status">正在打开页面…</div>}>
      {tab === "play" ? <PokerApp /> : tab === "learn" ? <Academy launch={practiceLaunch} onLab={l => void navigate("lab", l)} onLibrary={() => void navigate("library")} /> : tab === "lab" ? <Lab key={launch?.id ?? "default"} launch={launch} onLibrary={() => void navigate("library")} /> : <Library onLab={l => void navigate("lab", l)} onPractice={l => void navigate("learn", undefined, l)} />}
    </Suspense></Boundary></div>
  </div>;
}
