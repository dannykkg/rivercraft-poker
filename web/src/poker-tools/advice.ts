import type { LegalActions } from "../domain/types";
import { calculatePotOdds, type EquityResult } from "./equity";

export interface PokerAdvice {
  action: "弃牌" | "过牌" | "跟注" | "加注";
  confidence: "稳健" | "接近" | "积极";
  explanation: string;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const buildPokerAdvice = (
  equity: EquityResult | null,
  legal: LegalActions | null,
  potTotal: number,
): PokerAdvice | null => {
  if (!equity || !legal) return null;
  const effectiveEquity = equity.win + equity.tie * 0.5;
  const potOdds = calculatePotOdds(legal.toCall, potTotal);
  const comparison = `估算有效胜率 ${percent(effectiveEquity)}${legal.toCall > 0 ? `，底池赔率 ${percent(potOdds)}` : ""}`;

  if (legal.canCheck) {
    if (legal.canRaise && effectiveEquity >= 0.66) {
      return { action: "加注", confidence: "积极", explanation: `${comparison}。牌力优势较大，可以主动做大底池；若对手偏紧，也可适当缩小尺度。` };
    }
    return {
      action: "过牌",
      confidence: effectiveEquity >= 0.48 ? "接近" : "稳健",
      explanation: `${comparison}。当前无需投入更多筹码，先过牌保留后续选择更稳妥。`,
    };
  }

  if (legal.canFold && effectiveEquity + 0.03 < potOdds) {
    return { action: "弃牌", confidence: "稳健", explanation: `${comparison}。继续投入所需胜率高于当前估算，长期来看弃牌能减少亏损。` };
  }
  if (legal.canRaise && effectiveEquity >= Math.max(0.66, potOdds + 0.2)) {
    return { action: "加注", confidence: "积极", explanation: `${comparison}。胜率明显覆盖跟注门槛，适合用加注获取价值并向听牌收费。` };
  }
  if (legal.canCall && effectiveEquity >= potOdds) {
    const edge = effectiveEquity - potOdds;
    return { action: "跟注", confidence: edge >= 0.12 ? "稳健" : "接近", explanation: `${comparison}。当前胜率覆盖跟注成本，跟注具有正期望；优势不大时不必扩大底池。` };
  }
  return { action: legal.canFold ? "弃牌" : "跟注", confidence: "接近", explanation: `${comparison}。两者非常接近，建议控制底池，避免在边缘牌力上投入过多。` };
};
