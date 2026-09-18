import { compareActions, type RolloutInput } from "./rollout";
import { errorText } from "./model";
self.onmessage = (event: MessageEvent<{ id: number; input: RolloutInput }>) => {
  const { id, input } = event.data;
  try { const result = compareActions(input, completed => self.postMessage({ id, completed })); self.postMessage({ id, result }); }
  catch (error) { self.postMessage({ id, error: errorText(error) }); }
};
