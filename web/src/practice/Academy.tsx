import { lazy, Suspense, useEffect, useState } from "react";
import { Learning } from "../study/Learning";
import { flushStudyNavigation } from "../study/lifecycle";
import { errorText, uid } from "../study/model";
import type { LabLaunch } from "../study/Lab";
import type { PracticeLaunch } from "./model";
const Practice = lazy(() => import("./Practice").then(m => ({ default: m.Practice })));
export function Academy({ onLab, onLibrary, launch }: { onLab: (l: LabLaunch) => void; onLibrary: () => void; launch?: PracticeLaunch | null }) {
  const [track, setTrack] = useState<"foundation" | "practice">(() => {
    if (launch || location.hash.startsWith("#learn/practice")) return "practice";
    try { return localStorage.getItem("rivercraft-academy-track") === "practice" ? "practice" : "foundation"; } catch { return "foundation"; }
  });
  useEffect(() => { try { localStorage.setItem("rivercraft-academy-track", track); } catch { /* optional preference */ } }, [track]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const switchTrack = async (next: typeof track) => {
    if (busy || next === track) return; setBusy(true); setError("");
    try { await flushStudyNavigation(); setTrack(next); history.replaceState(null, "", next === "practice" ? "#learn/practice" : "#learn"); try { localStorage.setItem("rivercraft-academy-track", next); } catch { /* preference is optional; IndexedDB holds the actual progress */ } }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <><nav className="academy-track" aria-label="学习课程线"><button disabled={busy} aria-current={track === "foundation" ? "page" : undefined} onClick={() => void switchTrack("foundation")}>基础课程</button><button disabled={busy} aria-current={track === "practice" ? "page" : undefined} onClick={() => void switchTrack("practice")}>实战训练</button></nav>{error && <p className="study-error" role="alert">{error}</p>}<Suspense fallback={<p className="study-page" role="status">正在载入课程…</p>}>{track === "foundation" ? <Learning onLab={scenario => onLab({ id: uid("launch"), scenario })} /> : <Practice launch={launch} onLab={onLab} onLibrary={onLibrary} />}</Suspense></>;
}
