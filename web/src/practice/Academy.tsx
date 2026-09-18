import { lazy, Suspense, useEffect, useState } from "react";
import { Learning } from "../study/Learning";
import { flushStudyNavigation } from "../study/lifecycle";
import { errorText, uid } from "../study/model";
import type { LabLaunch } from "../study/Lab";
import type { PracticeLaunch } from "./model";
import { loadPractice, savePractice } from "./storage";
const Practice = lazy(() => import("./Practice").then(m => ({ default: m.Practice })));
const Workshop = lazy(() => import("./workshops/Workshop").then(m => ({ default: m.Workshop })));
type Track = "foundation" | "practice" | "skills";
export function Academy({ onLab, onLibrary, launch }: { onLab: (l: LabLaunch) => void; onLibrary: () => void; launch?: PracticeLaunch | null }) {
  const [track, setTrack] = useState<Track>(() => {
    if (launch) return "practice";
    if (location.hash.startsWith("#learn/practice/skills")) return "skills";
    if (location.hash.startsWith("#learn/practice")) return "practice";
    try { const value = localStorage.getItem("rivercraft-academy-track"); return value === "practice" || value === "skills" ? value : "foundation"; } catch { return "foundation"; }
  });
  useEffect(() => { try { localStorage.setItem("rivercraft-academy-track", track); } catch { /* optional; actual progress is in IndexedDB */ } }, [track]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const switchTrack = async (next: Track) => {
    if (busy || next === track) return; setBusy(true); setError("");
    try {
      await flushStudyNavigation();
      if (track === "practice") {
        const { session } = await loadPractice();
        if (session && session.status !== "complete") {
          if (session.mode === "assessment") throw new Error("请先完成或结束当前测验，再查看其他课程参考；测验不会在隐藏页面继续。");
          // Opening another course during a guided hand is assistance. Never rewrite a completed result.
          await savePractice({ ...session, assisted: true, updatedAt: Date.now() });
        }
      }
      setTrack(next);
      history.replaceState(null, "", next === "skills" ? "#learn/practice/skills" : next === "practice" ? "#learn/practice" : "#learn");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <>
    <nav className="academy-track" aria-label="学习课程线"><button disabled={busy} aria-current={track === "foundation" ? "page" : undefined} onClick={() => void switchTrack("foundation")}>基础课程</button><button disabled={busy} aria-current={track !== "foundation" ? "page" : undefined} onClick={() => void switchTrack("practice")}>实战训练</button></nav>
    {track !== "foundation" && <nav className="academy-track" aria-label="实战练习类型"><button disabled={busy} aria-current={track === "practice" ? "page" : undefined} onClick={() => void switchTrack("practice")}>牌桌决策</button><button disabled={busy} aria-current={track === "skills" ? "page" : undefined} onClick={() => void switchTrack("skills")}>范围与频率</button></nav>}
    {error && <p className="study-error study-page" role="alert">{error}</p>}
    <Suspense fallback={<p className="study-page" role="status">正在载入课程…</p>}>{track === "foundation" ? <Learning onLab={scenario => onLab({ id: uid("launch"), scenario })} /> : track === "skills" ? <div className="study-page practice-page"><Workshop /></div> : <Practice launch={launch} onLab={onLab} onLibrary={onLibrary} />}</Suspense>
  </>;
}
