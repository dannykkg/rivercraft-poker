import { useEffect, useState } from "react";
import { getLegalActions } from "../domain/engine";
import { projectPlayerView } from "../domain/view";
import type { Card, GameState, LegalActions, PlayerAction } from "../domain/types";

const suits: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const CardTile = ({ card, selected = false, onClick }: { card?: Card; selected?: boolean; onClick?: () => void }) => {
  const label = card ? `${card[0] === "T" ? "10" : card[0]}${suits[card[1]]}` : "隐藏牌";
  const cls = `study-card ${!card ? "study-card-back" : ""} ${card && "hd".includes(card[1]) ? "study-card-red" : ""} ${selected ? "study-card-selected" : ""}`;
  const content = card ? <><strong>{card[0] === "T" ? "10" : card[0]}</strong><span>{suits[card[1]]}</span></> : <span>◆</span>;
  return onClick ? <button type="button" className={cls} aria-label={card} aria-pressed={selected} onClick={onClick}>{content}</button> : <span className={cls} aria-label={label}>{content}</span>;
};
export function ActionControls({ legal, onAction, disabled = false }: { legal: LegalActions | null; onAction: (action: PlayerAction) => void; disabled?: boolean }) {
  const [raise, setRaise] = useState(legal?.minRaiseTo ?? 0);
  useEffect(() => { setRaise(legal?.minRaiseTo ?? 0); }, [legal?.playerId, legal?.minRaiseTo, legal?.maxRaiseTo, legal?.toCall]);
  if (!legal) return <p className="study-muted">此处没有可执行动作。</p>;
  return <fieldset className="study-actions" disabled={disabled} aria-label="牌桌行动">
    <legend>合法动作 · 需跟注 {legal.callAmount}</legend>
    {legal.canFold && <button onClick={() => onAction({ type: "fold" })}>弃牌</button>}
    {legal.canCheck && <button onClick={() => onAction({ type: "check" })}>过牌</button>}
    {legal.canCall && <button onClick={() => onAction({ type: "call" })}>跟注 {legal.callAmount}</button>}
    {legal.canRaise && legal.minRaiseTo !== null && <label className="study-raise">加注到<input aria-label="实验加注到" type="number" min={legal.minRaiseTo} max={legal.maxRaiseTo} step="1" value={raise} onChange={e => setRaise(Number(e.target.value))} /><button onClick={() => onAction({ type: "raise", to: raise })}>执行加注</button><small>{legal.minRaiseTo}–{legal.maxRaiseTo}</small></label>}
    {legal.canAllIn && <button onClick={() => onAction({ type: "all-in" })}>全下</button>}
  </fieldset>;
}
export function StudyTable({ state, heroId, onAction, research = false, manualOpponents = false, disabled = false }: {
  state: GameState; heroId: string; onAction?: (playerId: string, action: PlayerAction) => void;
  research?: boolean; manualOpponents?: boolean; disabled?: boolean;
}) {
  const view = projectPlayerView(state, heroId); const legal = getLegalActions(state);
  return <section className="study-table" aria-label="学习牌桌">
    <div className="study-table-meta"><span>{view.mode === "cash" ? "现金桌规则" : "锦标赛规则"} · {view.blindLevel.smallBlind}/{view.blindLevel.bigBlind}</span><span>{view.hand?.phase} · 第 {view.handNumber} 手</span></div>
    {research && <p className="study-warning">研究视角：显示底牌，不用于当时决策的严格评分。</p>}
    <div className="study-seats">{view.players.map(p => {
      const privateCards = research ? state.hand?.players.find(h => h.playerId === p.id)?.holeCards : p.holeCards;
      return <article key={p.id} className={`study-seat ${legal?.playerId === p.id ? "study-seat-active" : ""}`}>
        <div className="study-row"><strong>{p.name}{p.id === heroId ? " · 学习者" : ""}</strong><span>{p.seat === view.hand?.dealerSeat ? "D " : ""}{p.seat === view.hand?.smallBlindSeat ? "SB " : ""}{p.seat === view.hand?.bigBlindSeat ? "BB" : ""}</span></div>
        <div className="study-cards"><CardTile card={privateCards?.[0]} /><CardTile card={privateCards?.[1]} /></div>
        <small>筹码 {p.stack} · 本轮 {p.streetContribution ?? 0}{p.folded ? " · 已弃牌" : p.allIn ? " · 全下" : ""}</small>
      </article>;
    })}</div>
    <div className="study-board"><div className="study-cards">{Array.from({ length: 5 }, (_, i) => <CardTile key={i} card={view.hand?.board[i]} />)}</div><strong>底池 {view.hand?.potTotal ?? 0}</strong></div>
    {state.hand?.phase === "complete" && <p className="study-notice">本手已结算。{state.hand.winners.map(w => `${state.players.find(p => p.id === w.playerId)?.name} 获得 ${w.amount}`).join("；")}</p>}
    {onAction && legal && (manualOpponents || legal.playerId === heroId) && <><p className="study-muted">当前行动者：{view.players.find(p => p.id === legal.playerId)?.name}{manualOpponents && legal.playerId !== heroId ? "（手动研究对手回应）" : ""}</p><ActionControls legal={legal} onAction={a => onAction(legal.playerId, a)} disabled={disabled} /></>}
  </section>;
}
