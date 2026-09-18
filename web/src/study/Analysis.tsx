import type { GameState } from "../domain/types";
import { AnalysisPanel as BasicAnalysis } from "./BasicAnalysis";
import { CounterfactualPanel } from "./Counterfactual";
export { RangeGrid } from "./BasicAnalysis";

export function AnalysisPanel({ state, heroId }: { state: GameState; heroId: string }) {
  return <div className="study-stack"><BasicAnalysis state={state} heroId={heroId} /><CounterfactualPanel state={state} heroId={heroId} /></div>;
}
