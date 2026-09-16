import { estimateEquity } from "../poker-tools/equity";
import type { Card } from "../domain/types";

interface EquityRequest {
  holeCards: Card[];
  board: Card[];
  opponentCount: number;
  samples: number;
}

self.onmessage = (event: MessageEvent<EquityRequest>) => {
  const { holeCards, board, opponentCount, samples } = event.data;
  try {
    self.postMessage({ ok: true, result: estimateEquity(holeCards, board, opponentCount, samples) });
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : "胜率估算失败。" });
  }
};
