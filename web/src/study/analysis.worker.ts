import { rangeEquity, solveRiver, icmEquities, type EquityInput, type RiverInput } from "./math";
import { errorText } from "./model";
export type AnalysisRequest = { id: number } & ({ type: "equity"; input: EquityInput } | { type: "river"; input: RiverInput } | { type: "icm"; input: { stacks: number[]; payouts: number[] } });
self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const q = event.data;
  try { const result = q.type === "equity" ? rangeEquity(q.input) : q.type === "river" ? solveRiver(q.input) : icmEquities(q.input.stacks, q.input.payouts); self.postMessage({ id: q.id, result }); }
  catch (error) { self.postMessage({ id: q.id, error: errorText(error) }); }
};
