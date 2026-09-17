import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3, Bot, ChevronLeft, ChevronRight, CircleDot, Coins, Crown, Gauge, History,
  Eye, LoaderCircle, Pause, Play, RotateCcw, Settings2, ShieldCheck, Sparkles, Trophy, Volume2, VolumeX, X,
} from "lucide-react";
import { activateGameAudio, playGameSound } from "../audio/sounds";
import { calculateBotThinkDelay, decideBotAction } from "../bots/bot";
import { cardRankLabel, cardSuitSymbol, CryptoRandomSource, isRedCard } from "../domain/cards";
import { beginNextHand, createTournament, defaultBlindLevels, pauseTournament, resumeTournament, submitAction } from "../domain/engine";
import type { BotDifficulty, BotStyle, Card, PlayerAction, PlayerConfig, TournamentState } from "../domain/types";
import { projectPlayerView } from "../domain/view";
import { calculatePotOdds, type EquityResult } from "../poker-tools/equity";
import { clearTournament, loadTournament, loadTournamentHistory, saveTournament } from "../storage/repository";
import { availableHands, buildReplayFrames } from "../history/replay";
import { calculatePlayerStats } from "../history/stats";
import { visualPlayersBySeat } from "./tableLayout";

const HERO_ID = "hero";
const BOT_NAMES = ["Nova", "River", "Blaze", "Stone", "Moss", "Echo", "Orbit", "Flint"];
const EVENT_LABELS: Record<string, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注", "all-in": "全下" };
const BET_SIZE_PRESETS = [["1/2池", 0.5], ["2/3池", 0.67], ["满池", 1]] as const;
const HAND_RESULT_DURATION_MS = 8200;
const playerAccent = ["#6ee7b7", "#7dd3fc", "#c4b5fd", "#fda4af", "#fde68a", "#bef264", "#f0abfc", "#93c5fd", "#fdba74"];
const TABLE_SEAT_POSITIONS = [
  { left: 50, top: 103 }, { left: 20, top: 91 }, { left: 3, top: 67 },
  { left: 5, top: 25 }, { left: 29, top: -1 }, { left: 71, top: -1 },
  { left: 95, top: 25 }, { left: 97, top: 67 }, { left: 80, top: 91 },
] as const;
const RESULT_BADGE_POSITIONS = [
  "bottom-full left-1/2 mb-5 -translate-x-1/2",
  "bottom-[88%] left-[86%]",
  "bottom-[62%] left-full ml-3",
  "left-full top-[58%] ml-3",
  "left-[72%] top-full mt-4 -translate-x-1/2",
  "right-[72%] top-full mt-4 translate-x-1/2",
  "right-full top-[58%] mr-3",
  "bottom-[62%] right-full mr-3",
  "bottom-[88%] right-[86%]",
] as const;
const POSITION_LABELS: Record<number, string[]> = {
  4: ["UTG"],
  5: ["UTG", "CO"],
  6: ["UTG", "HJ", "CO"],
  7: ["UTG", "UTG+1", "HJ", "CO"],
  8: ["UTG", "UTG+1", "LJ", "HJ", "CO"],
  9: ["UTG", "UTG+1", "MP", "LJ", "HJ", "CO"],
};

const buildPositionLabels = (state: TournamentState): Map<number, string> => {
  const labels = new Map<number, string>();
  const hand = state.hand;
  if (!hand) return labels;
  const activeSeats = state.players.filter((player) => !player.eliminated).map((player) => player.seat);
  if (activeSeats.length === 2) {
    labels.set(hand.dealerSeat, "BTN · SB");
    labels.set(hand.bigBlindSeat, "BB");
    return labels;
  }
  labels.set(hand.dealerSeat, "BTN");
  labels.set(hand.smallBlindSeat, "SB");
  labels.set(hand.bigBlindSeat, "BB");
  const postBlindSeats = activeSeats
    .filter((seat) => ![hand.dealerSeat, hand.smallBlindSeat, hand.bigBlindSeat].includes(seat))
    .sort((first, second) => ((first - hand.bigBlindSeat + 9) % 9) - ((second - hand.bigBlindSeat + 9) % 9));
  const names = POSITION_LABELS[activeSeats.length] ?? [];
  postBlindSeats.forEach((seat, index) => labels.set(seat, names[index] ?? `EP${index + 1}`));
  return labels;
};

const actionBadgeStyle = (action: string): string => ({
  fold: "border-zinc-400/25 bg-zinc-500/15 text-zinc-300",
  check: "border-sky-300/30 bg-sky-300/15 text-sky-100",
  call: "border-cyan-300/30 bg-cyan-300/15 text-cyan-100",
  raise: "border-amber-300/35 bg-amber-300/15 text-amber-100",
  "all-in": "border-rose-300/40 bg-rose-300/20 text-rose-100",
}[action] ?? "border-white/15 bg-white/10 text-zinc-200");

const actionBadgeLabel = (event: TournamentState["events"][number]): string => {
  const action = String(event.public.action);
  const amount = action === "raise" || action === "all-in" ? Number(event.public.to) : Number(event.public.committed);
  return `${EVENT_LABELS[action] ?? action}${amount > 0 ? ` ${formatChips(amount)}` : ""}`;
};

interface BotProfile { difficulty: BotDifficulty; style: BotStyle }
const defaultProfiles: BotProfile[] = BOT_NAMES.map((_, index) => ({
  difficulty: index % 4 === 0 ? "hard" : index % 3 === 0 ? "easy" : "normal",
  style: (["balanced", "tight", "aggressive", "loose"] as BotStyle[])[index % 4],
}));

interface SetupSettings {
  playerCount: number;
  startingStack: number;
  speed: "slow" | "standard" | "fast";
  heroSeat: number | "random";
  profiles: BotProfile[];
}

const readSetupSettings = (): SetupSettings => {
  const fallback: SetupSettings = { playerCount: 6, startingStack: 1500, speed: "standard", heroSeat: "random", profiles: defaultProfiles };
  try {
    const parsed = JSON.parse(localStorage.getItem("rivercraft-setup") ?? "null") as Partial<SetupSettings> | null;
    if (!parsed) return fallback;
    return {
      playerCount: Number.isInteger(parsed.playerCount) && parsed.playerCount! >= 2 && parsed.playerCount! <= 9 ? parsed.playerCount! : fallback.playerCount,
      startingStack: [1000, 1500, 3000].includes(parsed.startingStack ?? 0) ? parsed.startingStack! : fallback.startingStack,
      speed: ["slow", "standard", "fast"].includes(parsed.speed ?? "") ? parsed.speed! : fallback.speed,
      heroSeat: parsed.heroSeat === "random" || (Number.isInteger(parsed.heroSeat) && Number(parsed.heroSeat) >= 0) ? parsed.heroSeat! : fallback.heroSeat,
      profiles: Array.isArray(parsed.profiles) && parsed.profiles.length >= 8 ? parsed.profiles : fallback.profiles,
    };
  } catch {
    return fallback;
  }
};

const readAutoNextHand = (): boolean => localStorage.getItem("rivercraft-auto-next") !== "false";
const readSoundEnabled = (): boolean => localStorage.getItem("rivercraft-sound-enabled") !== "false";

const formatChips = (value: number): string => new Intl.NumberFormat("zh-CN").format(value);
const avatarAtlasUrl = `${import.meta.env.BASE_URL}assets/player-avatars-v1.jpg`;
const avatarIndexForPlayer = (playerId: string): number => {
  if (playerId === HERO_ID) return 0;
  const parsed = Number(playerId.replace("bot-", ""));
  return Number.isInteger(parsed) ? Math.max(1, Math.min(8, parsed)) : 0;
};
const handNameLabel = (name?: string): string => ({
  "High Card": "高牌",
  Pair: "一对",
  "Two Pair": "两对",
  "Three of a Kind": "三条",
  Straight: "顺子",
  Flush: "同花",
  "Full House": "葫芦",
  "Four of a Kind": "四条",
  "Straight Flush": "同花顺",
  "Royal Flush": "皇家同花顺",
}[name ?? ""] ?? name ?? "无需摊牌");
const buildPlayers = (count: number, profiles: BotProfile[], heroSeat = 0): PlayerConfig[] => {
  let botIndex = 0;
  return Array.from({ length: count }, (_, seat) => {
    if (seat === heroSeat) return { id: HERO_ID, name: "你", kind: "human", seat };
    const index = botIndex++;
    return { id: `bot-${index + 1}`, name: BOT_NAMES[index], kind: "bot", seat, ...profiles[index] };
  });
};

const secureRandomSeat = (count: number): number => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % count;
};

const CardFace = ({ card, hidden = false, small = false, highlighted = false, dimmed = false }: { card?: Card; hidden?: boolean; small?: boolean; highlighted?: boolean; dimmed?: boolean }) => {
  if (hidden || !card) return (
    <span className={`${small ? "h-12 w-9 rounded-md sm:h-[4.25rem] sm:w-12 sm:rounded-lg" : "h-[4.9rem] w-14 rounded-lg sm:h-[6.4rem] sm:w-[4.5rem] sm:rounded-xl"} inline-grid shrink-0 place-items-center border border-emerald-200/20 bg-[repeating-linear-gradient(45deg,#123f32,#123f32_4px,#0b2f26_4px,#0b2f26_8px)] shadow-lg`}>
      <span className="size-2 rounded-full border border-emerald-100/30" />
    </span>
  );
  return (
    <span className={`${small ? "h-12 w-9 rounded-md text-base sm:h-[4.25rem] sm:w-12 sm:rounded-lg sm:text-lg" : "h-[4.9rem] w-14 rounded-lg text-2xl sm:h-[6.4rem] sm:w-[4.5rem] sm:rounded-xl sm:text-3xl"} inline-flex shrink-0 flex-col items-center justify-center border bg-zinc-50 font-bold leading-none transition-all duration-300 ${highlighted ? "best-hand-card border-amber-300 ring-2 ring-amber-200/80 shadow-[0_0_24px_rgba(253,230,138,.58)]" : "border-black/10 shadow-[0_8px_20px_rgba(0,0,0,.28)]"} ${dimmed ? "scale-95 opacity-30 saturate-50" : "opacity-100"} ${isRedCard(card) ? "text-rose-600" : "text-zinc-900"}`}>
      <span>{cardRankLabel(card)}</span><span className={small ? "text-base sm:text-lg" : "mt-1 text-3xl sm:text-4xl"}>{cardSuitSymbol(card)}</span>
    </span>
  );
};

const PlayerAvatar = ({ playerId, name, seat, className = "" }: { playerId: string; name: string; seat: number; className?: string }) => {
  const index = avatarIndexForPlayer(playerId);
  const column = index % 3;
  const row = Math.floor(index / 3);
  return <span
    role="img"
    aria-label={`${name}的头像`}
    style={{
      backgroundColor: playerAccent[seat],
      backgroundImage: `url(${avatarAtlasUrl})`,
      backgroundPosition: `${column * 50}% ${row * 50}%`,
      backgroundSize: "300% 300%",
    }}
    className={`inline-block shrink-0 rounded-full border border-white/20 bg-cover shadow-[0_4px_14px_rgba(0,0,0,.4)] ${className}`}
  />;
};

const Header = ({ onHistory, onSetup, gameActive }: { onHistory: () => void; onSetup: () => void; gameActive: boolean }) => (
  <header className="flex h-16 items-center justify-between border-b border-white/8 px-4 sm:px-6 lg:px-8">
    <button className="flex items-center gap-3 text-left" onClick={onSetup}>
      <span className="grid size-9 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><Crown className="size-4" /></span>
      <span><span className="block text-sm font-semibold tracking-[0.18em] text-white">RIVERCRAFT</span><span className="block text-xs text-zinc-500">单桌锦标赛</span></span>
    </button>
    <nav className="flex items-center gap-1" aria-label="主导航">
      <button aria-label="牌局记录" onClick={onHistory} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><History className="size-4" /><span className="hidden sm:inline">牌局记录</span></button>
      {gameActive && <button onClick={onSetup} className="inline-grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="比赛设置"><Settings2 className="size-4" /></button>}
    </nav>
  </header>
);

const PreviewTable = ({ players, startingStack }: { players: PlayerConfig[]; startingStack: number }) => {
  const tableSeats = visualPlayersBySeat(players, HERO_ID);
  return <section className="relative min-h-[680px] overflow-hidden rounded-[28px] border border-white/8 bg-[#0c1513] p-4 shadow-2xl shadow-black/30 sm:p-8 lg:min-h-[calc(100vh-112px)]">
    <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_50%_42%,rgba(50,130,95,.28),transparent_46%),linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:auto,32px_32px,32px_32px]" />
    <div className="relative flex items-center justify-between"><div className="flex items-center gap-2 text-sm text-zinc-400"><span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.7)]" />比赛准备就绪</div><div className="rounded-full border border-white/8 bg-black/20 px-3 py-1.5 text-xs text-zinc-400">盲注 10 / 20 · 第 1 级</div></div>
    <div className="relative mx-auto mt-24 aspect-[1.72/1] w-[82%] max-w-5xl rounded-[46%] border-[10px] border-[#271e19] bg-[#123f32] shadow-[inset_0_0_0_2px_rgba(255,255,255,.08),inset_0_0_70px_rgba(0,0,0,.48),0_34px_70px_rgba(0,0,0,.42)] sm:mt-28 sm:w-[88%]">
      <div className="absolute inset-[5%] rounded-[46%] border border-emerald-200/10" />
      <div className="absolute inset-0 grid place-items-center text-center"><div><Trophy className="mx-auto mb-3 size-7 text-amber-200/80" /><p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100/55">Starting chips</p><p className="mt-1 text-2xl font-semibold text-white">{formatChips(startingStack * players.length)}</p></div></div>
      {tableSeats.map((player, visualSeat) => {
        const position = TABLE_SEAT_POSITIONS[visualSeat];
        return player ? <div key={player.id} data-table-seat={visualSeat + 1} style={{ left: `${position.left}%`, top: `${position.top}%` }} className={`absolute flex min-w-[118px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-2xl border px-2.5 py-2 shadow-xl ring-1 ring-inset ring-black/15 backdrop-blur sm:min-w-[136px] sm:px-3 sm:py-2.5 ${player.kind === "human" ? "border-amber-100 bg-[#f2dfb7]" : "border-white bg-[#e9e1d4]"}`}>
          <PlayerAvatar playerId={player.id} name={player.name} seat={player.seat} className="size-10 sm:size-11" />
          <span><span className="block max-w-16 truncate text-xs font-bold text-zinc-950">{player.name}</span><span className="block text-[11px] font-medium tabular-nums text-zinc-700">{formatChips(startingStack)}</span></span>
        </div> : <div key={`empty-${visualSeat}`} data-table-seat={visualSeat + 1} style={{ left: `${position.left}%`, top: `${position.top}%` }} className="absolute min-w-[88px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-dashed border-white/10 bg-black/15 px-3 py-2 text-center text-[11px] text-zinc-600 backdrop-blur-sm">空座</div>;
      })}
    </div>
    <div className="relative mx-auto mt-28 grid max-w-2xl grid-cols-3 gap-3 text-center text-xs text-zinc-500"><div><ShieldCheck className="mx-auto mb-1.5 size-4 text-emerald-300" />规则引擎校验</div><div><Gauge className="mx-auto mb-1.5 size-4 text-sky-300" />三档机器人</div><div><History className="mx-auto mb-1.5 size-4 text-violet-300" />本地自动存档</div></div>
  </section>;
};

const SetupScreen = ({ playerCount, setPlayerCount, startingStack, setStartingStack, speed, setSpeed, heroSeat, setHeroSeat, profiles, setProfiles, onStart, resumable, onResume }: {
  playerCount: number; setPlayerCount: (value: number) => void; startingStack: number; setStartingStack: (value: number) => void;
  speed: "slow" | "standard" | "fast"; setSpeed: (value: "slow" | "standard" | "fast") => void;
  heroSeat: number | "random"; setHeroSeat: (value: number | "random") => void;
  profiles: BotProfile[]; setProfiles: (value: BotProfile[]) => void; onStart: () => void; resumable: TournamentState | null; onResume: () => void;
}) => (
  <div className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6">
    <PreviewTable players={buildPlayers(playerCount, profiles, heroSeat === "random" ? 0 : Math.min(heroSeat, playerCount - 1))} startingStack={startingStack} />
    <aside className="max-h-[calc(100vh-112px)] overflow-y-auto rounded-[28px] border border-white/8 bg-[#111313] p-5 lg:p-6">
      <div className="mb-6"><div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><CircleDot className="size-5" /></div><h1 className="text-2xl font-semibold tracking-tight text-white">新建锦标赛</h1><p className="mt-2 text-sm leading-6 text-zinc-500">传统无限注德州扑克，从开局一直打到决出冠军。</p></div>
      {resumable && resumable.status !== "finished" && <button onClick={onResume} className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[.07] p-4 text-left hover:border-amber-300/35"><span className="grid size-9 place-items-center rounded-xl bg-amber-300/10 text-amber-200"><ChevronRight className="size-4" /></span><span className="flex-1"><span className="block text-sm font-medium text-zinc-100">继续上次比赛</span><span className="block text-xs text-zinc-500">第 {resumable.handNumber} 手牌 · {resumable.players.filter((player) => !player.eliminated).length} 人在赛</span></span></button>}
      <div className="space-y-5">
        <label className="block"><span className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-zinc-200">玩家人数</span><span className="text-emerald-300">{playerCount} 人</span></span><input aria-label="玩家人数" type="range" min="2" max="9" step="1" value={playerCount} onChange={(event) => setPlayerCount(Number(event.target.value))} className="w-full accent-emerald-300" /><span className="mt-1 flex justify-between text-xs text-zinc-600"><span>2</span><span>9</span></span></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="rounded-2xl border border-white/8 bg-white/[.025] p-3.5"><span className="block text-xs text-zinc-500">初始筹码</span><select value={startingStack} onChange={(event) => setStartingStack(Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none"><option className="bg-zinc-900" value="1000">1,000</option><option className="bg-zinc-900" value="1500">1,500</option><option className="bg-zinc-900" value="3000">3,000</option></select></label>
          <label className="rounded-2xl border border-white/8 bg-white/[.025] p-3.5"><span className="block text-xs text-zinc-500">盲注速度</span><select value={speed} onChange={(event) => setSpeed(event.target.value as typeof speed)} className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none"><option className="bg-zinc-900" value="slow">慢速</option><option className="bg-zinc-900" value="standard">标准</option><option className="bg-zinc-900" value="fast">快速</option></select></label>
        </div>
        <label className="block rounded-2xl border border-white/8 bg-white/[.025] p-3.5"><span className="block text-xs text-zinc-500">真人座位</span><select value={heroSeat} onChange={(event) => setHeroSeat(event.target.value === "random" ? "random" : Number(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none"><option className="bg-zinc-900" value="random">随机分配</option>{Array.from({ length: playerCount }, (_, seat) => <option className="bg-zinc-900" key={seat} value={seat}>座位 {seat + 1}</option>)}</select></label>
        <div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-zinc-200">机器人座位</p><p className="text-xs text-zinc-600">逐个配置</p></div><div className="space-y-2">
          {Array.from({ length: playerCount - 1 }, (_, index) => <div key={BOT_NAMES[index]} className="grid grid-cols-[1fr_78px_78px] items-center gap-2 rounded-xl border border-white/8 bg-white/[.02] p-2.5">
            <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-300"><Bot className="size-3.5 shrink-0 text-violet-300" /><span className="truncate">{BOT_NAMES[index]}</span></span>
            <select aria-label={`${BOT_NAMES[index]}难度`} value={profiles[index].difficulty} onChange={(event) => { const next = [...profiles]; next[index] = { ...next[index], difficulty: event.target.value as BotDifficulty }; setProfiles(next); }} className="rounded-lg border border-white/8 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300"><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option></select>
            <select aria-label={`${BOT_NAMES[index]}风格`} value={profiles[index].style} onChange={(event) => { const next = [...profiles]; next[index] = { ...next[index], style: event.target.value as BotStyle }; setProfiles(next); }} className="rounded-lg border border-white/8 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300"><option value="tight">保守</option><option value="balanced">均衡</option><option value="loose">松散</option><option value="aggressive">激进</option></select>
          </div>)}
        </div></div>
      </div>
      <button onClick={onStart} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 font-semibold text-emerald-950 hover:bg-emerald-200">开始锦标赛 <ChevronRight className="size-4" /></button>
      <p className="mt-4 text-center text-xs leading-5 text-zinc-600">无需账号 · 本地存档 · 支持离线游玩</p>
    </aside>
  </div>
);

const GameTable = ({ state, onAction, onNextHand, onEquity, onTogglePause, onRestart, onSpectate, autoNextHand, onAutoNextHandChange, soundEnabled, onSoundEnabledChange, spectating, equity, equityLoading, error }: {
  state: TournamentState; onAction: (action: PlayerAction) => void; onNextHand: () => void; onEquity: () => void; onTogglePause: () => void;
  onRestart: () => void; onSpectate: () => void; autoNextHand: boolean; onAutoNextHandChange: (value: boolean) => void; spectating: boolean;
  soundEnabled: boolean; onSoundEnabledChange: (value: boolean) => void;
  equity: EquityResult | null; equityLoading: boolean; error: string | null;
}) => {
  const [revealMuckedCards, setRevealMuckedCards] = useState(false);
  const view = projectPlayerView(state, HERO_ID, { revealMuckedCards });
  const hand = view.hand!;
  const hero = view.players.find((player) => player.id === HERO_ID)!;
  const legal = state.status === "playing" ? view.legalActions : null;
  const [raiseTo, setRaiseTo] = useState(0);
  const [settlementPhase, setSettlementPhase] = useState<"runout" | "payout">("runout");
  const [visibleBoardCount, setVisibleBoardCount] = useState(hand.board.length);
  const [showPostHandDialog, setShowPostHandDialog] = useState(false);
  const previousBoardCount = useRef(hand.board.length);
  const soundedSettlementHand = useRef<number | null>(null);
  const runoutPending = hand.phase === "complete" && state.hand?.reachedShowdown === true && settlementPhase === "runout";
  const handPlayerById = new Map(state.hand?.players.map((player) => [player.playerId, player]));
  const isVisuallyEliminated = (playerId: string, eliminated: boolean): boolean =>
    eliminated && !(runoutPending && handPlayerById.has(playerId) && !handPlayerById.get(playerId)?.folded);
  const visibleStack = (playerId: string, stack: number): number =>
    runoutPending ? stack - (hand.winners.find((winner) => winner.playerId === playerId)?.amount ?? 0) : stack;
  const activePlayers = view.players.filter((player) => !isVisuallyEliminated(player.id, player.eliminated));
  const currentActor = activePlayers.find((player) => player.seat === hand.currentPlayerSeat);
  const tableSeats = visualPlayersBySeat(view.players, HERO_ID);
  const positionLabels = buildPositionLabels(state);
  useEffect(() => { if (legal?.minRaiseTo) setRaiseTo(legal.minRaiseTo); }, [legal?.minRaiseTo, state.events.length]);
  const handActionEvents = state.events.filter((event) => event.type === "player-acted" && event.handNumber === state.handNumber);
  const actionEvents = handActionEvents.slice(-7).reverse();
  const relevantSeatActions = hand.phase === "complete"
    ? handActionEvents
    : handActionEvents.filter((event) => event.public.phase === hand.phase);
  const latestActionByPlayer = new Map(relevantSeatActions.map((event) => [event.playerId, event]));
  const isComplete = state.hand?.phase === "complete";
  const isFinished = state.status === "finished";
  const heroEliminated = hero.eliminated;
  const heroWon = hand.winners.some((winner) => winner.playerId === HERO_ID);
  const hasMuckedOpponent = state.hand?.players.some((player) => player.playerId !== HERO_ID && player.folded) === true;
  useEffect(() => { setRevealMuckedCards(false); }, [state.handNumber]);
  useEffect(() => {
    if (!isComplete) {
      setVisibleBoardCount(hand.board.length);
      setSettlementPhase("runout");
      setShowPostHandDialog(false);
      return;
    }
    setSettlementPhase("runout");
    setShowPostHandDialog(false);
    const startingBoardCount = state.hand?.reachedShowdown ? Math.min(visibleBoardCount, hand.board.length) : hand.board.length;
    setVisibleBoardCount(startingBoardCount);
    const timers: number[] = [];
    for (let index = startingBoardCount; index < hand.board.length; index += 1) {
      timers.push(window.setTimeout(() => setVisibleBoardCount(index + 1), (index - startingBoardCount + 1) * 360));
    }
    const payoutDelay = Math.max(650, (hand.board.length - startingBoardCount) * 360 + 500);
    timers.push(window.setTimeout(() => setSettlementPhase("payout"), payoutDelay));
    if (isFinished || (heroEliminated && !spectating)) timers.push(window.setTimeout(() => setShowPostHandDialog(true), payoutDelay + 5300));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  // The previous visible-board count is intentionally captured when a hand completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.board.length, isComplete, isFinished, state.handNumber]);
  useEffect(() => {
    if (visibleBoardCount > previousBoardCount.current) playGameSound("deal", soundEnabled);
    previousBoardCount.current = visibleBoardCount;
  }, [soundEnabled, visibleBoardCount]);
  useEffect(() => {
    if (!isComplete || settlementPhase !== "payout" || soundedSettlementHand.current === state.handNumber) return;
    soundedSettlementHand.current = state.handNumber;
    playGameSound(heroWon ? "win" : "lose", soundEnabled);
  }, [heroWon, isComplete, settlementPhase, soundEnabled, state.handNumber]);
  const rankedPlayers = [...state.players].sort((first, second) => {
    if (isFinished && !runoutPending) return (first.finishPosition ?? 99) - (second.finishPosition ?? 99);
    const firstEliminated = isVisuallyEliminated(first.id, first.eliminated);
    const secondEliminated = isVisuallyEliminated(second.id, second.eliminated);
    if (firstEliminated !== secondEliminated) return firstEliminated ? 1 : -1;
    return visibleStack(second.id, second.stack) - visibleStack(first.id, first.stack);
  });
  const durationMs = Math.max(0, (state.events.at(-1)?.timestamp ?? 0) - (state.events[0]?.timestamp ?? 0));
  const handsUntilLevelUp = view.blindLevel.hands - (state.handNumber % view.blindLevel.hands);
  const potOdds = legal ? calculatePotOdds(legal.toCall, hand.potTotal) : 0;
  const boardRunning = isComplete && state.hand?.reachedShowdown === true && visibleBoardCount < hand.board.length;
  const showBestFive = isComplete && settlementPhase === "payout" && state.hand?.reachedShowdown === true;
  const winningCards = new Set(hand.winners.flatMap((winner) => winner.bestFive ?? []));
  const isSplitPot = hand.pots.length === 1 && hand.winners.length > 1;
  return <div className="grid min-h-[calc(100vh-64px)] gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-5">
    <section className="relative flex min-h-[720px] flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[#0b1311] p-4 lg:min-h-[calc(100vh-104px)] lg:p-6">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_50%_45%,rgba(45,145,105,.3),transparent_44%),linear-gradient(rgba(255,255,255,.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] [background-size:auto,32px_32px,32px_32px]" />
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-3"><span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-zinc-400">第 {state.handNumber} 手牌</span><span className="text-xs text-zinc-500">剩余 {activePlayers.length} / {state.players.length}</span></div><div className="flex flex-wrap items-center justify-end gap-2"><button role="switch" aria-checked={soundEnabled} aria-label="牌桌音效" onClick={() => { const next = !soundEnabled; onSoundEnabledChange(next); if (next) activateGameAudio("check", true); }} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition ${soundEnabled ? "border-sky-300/25 bg-sky-300/10 text-sky-100" : "border-white/10 bg-black/20 text-zinc-500"}`}>{soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}音效</button><button role="switch" aria-checked={autoNextHand} aria-label="自动下一手" onClick={() => onAutoNextHandChange(!autoNextHand)} className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs transition ${autoNextHand ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-white/10 bg-black/20 text-zinc-500"}`}><span className={`size-1.5 rounded-full ${autoNextHand ? "bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.8)]" : "bg-zinc-600"}`} />自动下一手</button><button onClick={onTogglePause} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 text-xs text-zinc-400 hover:text-white">{state.status === "paused" ? <Play className="size-3" /> : <Pause className="size-3" />}{state.status === "paused" ? "继续" : "暂停"}</button><div className="rounded-full border border-amber-200/15 bg-amber-200/[.06] px-3 py-1.5 text-xs font-medium text-amber-100/80">盲注 {view.blindLevel.smallBlind} / {view.blindLevel.bigBlind} · 第 {state.blindLevelIndex + 1} 级 · {handsUntilLevelUp} 手后升级</div></div></div>
      <div className="relative z-10 mx-auto mt-16 aspect-[1.72/1] w-[82%] max-w-[1120px] rounded-[46%] border-[10px] border-[#281e18] bg-[#124334] shadow-[inset_0_0_0_2px_rgba(255,255,255,.08),inset_0_0_90px_rgba(0,0,0,.5),0_36px_70px_rgba(0,0,0,.46)] sm:mt-20 sm:w-[90%]">
        <div className="absolute inset-[5%] rounded-[46%] border border-emerald-100/10" />
        <div className="absolute inset-0 flex flex-col items-center justify-center"><div className="mb-3 flex gap-1.5 sm:gap-2">{Array.from({ length: 5 }, (_, index) => { const card = hand.board[index]; return <span key={index} className={isComplete && index < visibleBoardCount ? "board-card-deal" : ""}><CardFace card={card} hidden={!card || index >= visibleBoardCount} highlighted={Boolean(card && showBestFive && winningCards.has(card))} dimmed={Boolean(card && showBestFive && !winningCards.has(card))} /></span>; })}</div><div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-emerald-50/80"><Coins className="size-3.5 text-amber-200" />底池 <strong className="text-white">{formatChips(hand.potTotal)}</strong></div>{hand.pots.length > 1 && <p className="mt-2 text-[10px] text-emerald-100/50">{hand.pots.map((pot, index) => `${index === 0 ? "主池" : `边池 ${index}`} ${formatChips(pot.amount)}`).join(" · ")}</p>}{isComplete && <div data-hand-result className="mt-3 flex max-w-[80%] flex-wrap items-center justify-center gap-1.5 text-center">{settlementPhase === "runout" ? <span className="rounded-full border border-amber-200/20 bg-black/40 px-3 py-1 text-xs font-semibold text-amber-100">{boardRunning ? `跑马中 · ${visibleBoardCount} / ${hand.board.length}` : state.hand?.reachedShowdown ? "正在核对牌型…" : "其他玩家均已弃牌"}</span> : hand.winners.map((winner) => <span key={winner.playerId} data-winner-hand={winner.playerId} className="rounded-full border border-amber-200/35 bg-[#241e11]/90 px-3 py-1 text-xs font-bold text-amber-100 shadow-[0_0_16px_rgba(253,230,138,.12)]">{view.players.find((player) => player.id === winner.playerId)?.name} · {winner.handName ? handNameLabel(winner.handName) : "赢得底池"}{isSplitPot ? " · 平分" : ""}</span>)}</div>}</div>
        {tableSeats.map((player, visualSeat) => {
          const position = TABLE_SEAT_POSITIONS[visualSeat];
          if (!player) return <div key={`empty-${visualSeat}`} data-table-seat={visualSeat + 1} style={{ left: `${position.left}%`, top: `${position.top}%` }} className="absolute min-w-[92px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-dashed border-white/10 bg-black/15 px-3 py-2 text-center backdrop-blur-sm"><span className="block text-[10px] uppercase tracking-[0.14em] text-zinc-700">Seat {visualSeat + 1}</span><span className="mt-0.5 block text-xs text-zinc-600">空座</span></div>;
          const isCurrent = player.seat === hand.currentPlayerSeat;
          const isHero = player.id === HERO_ID;
          const latestAction = latestActionByPlayer.get(player.id);
          const action = latestAction ? String(latestAction.public.action) : null;
          const positionLabel = positionLabels.get(player.seat);
          const winner = isComplete && settlementPhase === "payout" ? hand.winners.find((candidate) => candidate.playerId === player.id) : undefined;
          const playerBestCards = new Set(winner?.bestFive ?? []);
          const netResult = (winner?.amount ?? 0) - (player.totalContribution ?? 0);
          const participated = player.totalContribution !== undefined;
          const displayEliminated = isVisuallyEliminated(player.id, player.eliminated);
          const usesDarkInactiveCard = displayEliminated || player.folded === true;
          const muckedCardsRevealed = revealMuckedCards && player.folded && Boolean(player.holeCards);
          const seatState = winner ? "winner" : displayEliminated ? "eliminated" : player.folded ? "folded" : player.allIn ? "all-in" : isCurrent ? "current" : "active";
          const seatStatus = winner ? winner.handName ? handNameLabel(winner.handName) : "赢得底池" : displayEliminated ? "已淘汰" : muckedCardsRevealed ? "已弃牌 · 已公开" : player.folded ? "已弃牌" : player.allIn ? runoutPending ? "全下 · 跑马中" : "全下" : isCurrent ? "正在行动" : runoutPending ? "摊牌中" : "在局";
          const seatStatusStyle = winner
            ? "border-amber-200/60 bg-amber-200 text-amber-950 shadow-[0_0_20px_rgba(253,230,138,.45)]"
            : displayEliminated
            ? "border-zinc-700 bg-zinc-900 text-zinc-500"
            : player.folded
              ? "border-zinc-500/35 bg-[#171918] text-zinc-300"
              : player.allIn
                ? "border-rose-300/40 bg-rose-950 text-rose-100"
                : isCurrent
                  ? "border-amber-200/50 bg-amber-200 text-amber-950 shadow-[0_0_16px_rgba(253,230,138,.35)]"
                  : "border-emerald-300/35 bg-emerald-950 text-emerald-200";
          return <div key={player.id} data-table-seat={visualSeat + 1} data-player-id={player.id} data-seat-state={seatState} style={{ left: `${position.left}%`, top: `${position.top}%` }} className={`absolute min-w-[132px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-2.5 shadow-xl ring-1 ring-inset ring-black/15 backdrop-blur transition sm:min-w-[156px] sm:p-3 ${winner ? "winner-seat border-amber-100 bg-[#f1d58c] shadow-[0_0_36px_rgba(253,230,138,.52)] ring-2 ring-amber-100/70" : displayEliminated ? "border-dashed border-zinc-700 bg-[#171b1e] grayscale shadow-none" : player.folded ? "border-dashed border-zinc-400/50 bg-[#24282c] grayscale shadow-none" : isCurrent ? "border-amber-50 bg-[#f6cf72] shadow-[0_0_38px_rgba(253,230,138,.55)] ring-2 ring-amber-100/80" : isHero ? "border-amber-100 bg-[#f2dfb7] shadow-[0_14px_32px_rgba(0,0,0,.48),0_0_22px_rgba(251,191,36,.28)]" : "border-white bg-[#e9e1d4] shadow-[0_14px_32px_rgba(0,0,0,.48),0_0_16px_rgba(255,255,255,.18)]"}`}>
            {positionLabel && <span className="absolute -top-3 left-2 rounded-full border border-amber-200/25 bg-[#211d14] px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-100">{positionLabel}</span>}
            {latestAction && action && !(isComplete && settlementPhase === "payout") && <span key={latestAction.id} data-player-action={player.id} className={`player-action-badge pointer-events-none absolute left-1/2 top-full z-30 mt-7 min-w-max rounded-full border px-4 py-1.5 text-sm font-black tracking-wide sm:mt-8 sm:px-5 sm:py-2 sm:text-base ${actionBadgeStyle(action)}`}>{actionBadgeLabel(latestAction)}</span>}
            {isComplete && settlementPhase === "payout" && participated && <span data-player-result={player.id} className={`pointer-events-none absolute z-20 whitespace-nowrap text-base font-black sm:text-xl ${RESULT_BADGE_POSITIONS[visualSeat]} ${netResult > 0 ? "chip-result-win" : netResult < 0 ? "chip-result-loss" : "chip-result-even"}`}>{netResult > 0 ? `净赢 +${formatChips(netResult)}` : netResult < 0 ? `净输 −${formatChips(Math.abs(netResult))}` : "持平 0"}</span>}
            <span className={`absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide sm:text-[11px] ${seatStatusStyle}`}>{seatStatus}</span>
            <div className={winner ? "opacity-100" : muckedCardsRevealed ? "opacity-80" : displayEliminated ? "opacity-20" : player.folded ? "opacity-25" : "opacity-100"}>
              <div className="flex items-center gap-2"><PlayerAvatar playerId={player.id} name={player.name} seat={player.seat} className="size-11 ring-1 ring-black/35 sm:size-12" /><span className="min-w-0 flex-1"><span className={`block truncate text-xs font-bold sm:text-sm ${usesDarkInactiveCard ? "text-white" : "text-zinc-950"}`}>{player.name}</span><span className={`block text-[11px] font-medium tabular-nums sm:text-xs ${usesDarkInactiveCard ? "text-zinc-300" : "text-zinc-700"}`}>{displayEliminated ? "已淘汰" : formatChips(visibleStack(player.id, player.stack))}</span></span>{isCurrent && <span className="size-2 animate-pulse rounded-full bg-zinc-900 shadow-[0_0_10px_rgba(24,24,27,.65)]" />}</div>
              <div className="mt-2 flex items-end justify-between gap-2"><div className="flex -space-x-1">{player.holeCards ? player.holeCards.map((card) => <CardFace key={card} card={card} small highlighted={showBestFive && Boolean(winner?.bestFive) && playerBestCards.has(card)} dimmed={showBestFive && (!winner || !playerBestCards.has(card))} />) : [0, 1].map((card) => <CardFace key={card} hidden small />)}</div><div className={`text-right text-[11px] font-semibold ${usesDarkInactiveCard ? "text-zinc-300" : "text-zinc-700"}`}>{displayEliminated ? "离桌" : player.folded ? "已弃牌" : player.allIn ? runoutPending ? "跑马中" : "全下" : player.streetContribution ? `本轮 ${formatChips(player.streetContribution)}` : isCurrent ? "行动中" : runoutPending ? "摊牌中" : ""}</div></div>
            </div>
          </div>;
        })}
      </div>
      <div className="relative z-10 mt-auto pt-20">
        {error && <p role="alert" className="mb-3 text-center text-sm text-rose-300">{error}</p>}
        {state.status === "paused" && <div className="mx-auto mb-3 max-w-md rounded-2xl border border-amber-200/20 bg-black/40 p-4 text-center"><Pause className="mx-auto size-5 text-amber-200" /><p className="mt-2 text-sm font-medium text-white">比赛已暂停并自动保存</p><button onClick={onTogglePause} className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-300 px-4 text-xs font-semibold text-emerald-950"><Play className="size-3.5" />继续比赛</button></div>}
        {state.status === "paused" ? null : isComplete ? <div role="status" aria-label="本手结算" className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/15 bg-black/35 p-3 backdrop-blur">
          <p className="text-xs text-zinc-400">{settlementPhase === "runout" ? "正在完成本手结算…" : revealMuckedCards ? "已公开本手弃牌玩家的底牌" : isFinished ? "即将显示锦标赛最终排名" : heroEliminated && !spectating ? "即将显示淘汰后的可选操作" : autoNextHand ? "结果展示后将自动开始下一手" : "自动下一手已关闭"}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {settlementPhase === "payout" && heroWon && hasMuckedOpponent && !revealMuckedCards && <button onClick={() => setRevealMuckedCards(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-amber-200/25 bg-amber-200/[.08] px-3 text-xs font-semibold text-amber-100 hover:bg-amber-200/[.14]"><Eye className="size-3.5" />查看对手底牌</button>}
            {!isFinished && !(heroEliminated && !spectating) && <>{autoNextHand && <button onClick={() => onAutoNextHandChange(false)} className="h-9 rounded-xl border border-white/10 px-3 text-xs text-zinc-400 hover:text-white">暂停自动</button>}<button onClick={onNextHand} className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-300 px-4 text-xs font-semibold text-emerald-950 hover:bg-emerald-200">立即下一手 <ChevronRight className="size-3.5" /></button></>}
          </div>
        </div> : legal ? <div className="mx-auto max-w-3xl rounded-2xl border border-emerald-300/15 bg-black/30 p-3 backdrop-blur sm:p-4"><div className="mb-3 flex items-center justify-between gap-3 text-xs"><span className="text-zinc-500">轮到你行动</span><span className="text-zinc-400">需跟注 <strong className="text-white">{formatChips(legal.toCall)}</strong></span></div><div className="flex flex-wrap items-center justify-center gap-2">
            {legal.canFold && <button onClick={() => onAction({ type: "fold" })} className="h-10 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm text-zinc-300 hover:bg-white/[.07]">弃牌</button>}{legal.canCheck && <button onClick={() => onAction({ type: "check" })} className="h-10 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm text-zinc-200 hover:bg-white/[.07]">过牌</button>}{legal.canCall && <button onClick={() => onAction({ type: "call" })} className="h-10 rounded-xl border border-sky-300/20 bg-sky-300/10 px-4 text-sm font-medium text-sky-100 hover:bg-sky-300/15">跟注 {formatChips(legal.callAmount)}</button>}
            {legal.canRaise && legal.minRaiseTo !== null && <div className="rounded-xl border border-white/10 bg-white/[.03] p-1"><div className="flex items-center gap-2"><input aria-label="加注到" type="range" min={legal.minRaiseTo} max={legal.maxRaiseTo} value={raiseTo} onChange={(event) => setRaiseTo(Number(event.target.value))} className="w-24 accent-emerald-300 sm:w-32" /><button onClick={() => onAction({ type: "raise", to: raiseTo })} className="h-8 rounded-lg bg-emerald-300 px-3 text-xs font-semibold text-emerald-950">加注到 {formatChips(raiseTo)}</button></div><div className="mt-1 flex justify-center gap-1">{BET_SIZE_PRESETS.map(([label, ratio]) => <button key={label} onClick={() => setRaiseTo(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo!, hand.currentBet + Math.round((hand.potTotal + legal.toCall) * ratio))))} className="rounded px-1.5 py-0.5 text-[9px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300">{label}</button>)}</div></div>}{legal.canAllIn && <button onClick={() => onAction({ type: "all-in" })} className="h-10 rounded-xl border border-rose-300/20 bg-rose-300/10 px-4 text-sm font-medium text-rose-100 hover:bg-rose-300/15">全下</button>}
          </div></div> : <div className="flex items-center justify-center gap-2 text-sm text-zinc-500"><LoaderCircle className="size-4 animate-spin" />{currentActor ? `${currentActor.name} 正在思考` : "正在推进牌局"}</div>}
      </div>
    </section>
    <aside className="space-y-4 lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto">
      <div className="rounded-2xl border border-white/8 bg-[#111313] p-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Sparkles className="size-4 text-violet-300" />基础概率</h2><span className="text-[11px] text-zinc-600">Monte Carlo</span></div>{equity ? <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-emerald-300/[.07] p-2"><p className="text-lg font-semibold text-emerald-300">{Math.round(equity.win * 100)}%</p><p className="text-[11px] text-zinc-500">获胜</p></div><div className="rounded-xl bg-sky-300/[.07] p-2"><p className="text-lg font-semibold text-sky-300">{Math.round(equity.tie * 100)}%</p><p className="text-[11px] text-zinc-500">平局</p></div><div className="rounded-xl bg-rose-300/[.07] p-2"><p className="text-lg font-semibold text-rose-300">{Math.round(equity.loss * 100)}%</p><p className="text-[11px] text-zinc-500">落后</p></div></div> : <p className="text-xs leading-5 text-zinc-500">基于可见牌和随机对手范围估算，不读取机器人底牌。</p>}<div className="mt-3 flex items-center justify-between rounded-xl bg-white/[.025] px-3 py-2 text-xs"><span className="text-zinc-500">当前底池赔率</span><span className="font-medium text-sky-200">{legal?.toCall ? `${Math.round(potOdds * 100)}%` : "无需跟注"}</span></div><button onClick={onEquity} disabled={equityLoading || !hero.holeCards || isComplete} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-xs text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40">{equityLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <BarChart3 className="size-3.5" />}估算当前胜率</button></div>
      <div className="rounded-2xl border border-white/8 bg-[#111313] p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-200">最近行动</h2><div className="space-y-2">{actionEvents.length === 0 && <p className="text-xs text-zinc-600">本手尚无玩家行动。</p>}{actionEvents.map((event) => { const player = view.players.find((candidate) => candidate.id === event.playerId); return <div key={event.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-zinc-400">{player?.name}</span><span className="text-zinc-200">{EVENT_LABELS[String(event.public.action)] ?? String(event.public.action)}{Number(event.public.committed) > 0 ? ` ${event.public.committed}` : ""}</span></div>; })}</div></div>
      <div className="rounded-2xl border border-white/8 bg-[#111313] p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-200">排名与筹码</h2><div className="space-y-2">{rankedPlayers.map((player, index) => { const displayEliminated = isVisuallyEliminated(player.id, player.eliminated); return <div key={player.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${player.id === HERO_ID ? "bg-emerald-300/[.06]" : ""}`}><span className="w-5 text-xs text-zinc-600">{displayEliminated ? player.finishPosition ?? index + 1 : index + 1}</span><span className="flex-1 truncate text-xs text-zinc-300">{player.name}</span><span className="text-xs tabular-nums text-zinc-400">{displayEliminated ? "淘汰" : formatChips(visibleStack(player.id, player.stack))}</span></div>; })}</div></div>
    </aside>
    {showPostHandDialog && isFinished && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="锦标赛结算"><div className="settlement-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-amber-200/25 bg-[#111411] p-5 text-center shadow-[0_32px_100px_rgba(0,0,0,.72)] sm:p-7"><Trophy className="mx-auto size-9 text-amber-200" /><p className="mt-3 text-xs font-semibold tracking-[0.18em] text-amber-200/70">锦标赛结束</p><h2 className="mt-1 text-2xl font-semibold text-white">{state.championId === HERO_ID ? "你赢得了锦标赛" : `${state.players.find((player) => player.id === state.championId)?.name} 获得冠军`}</h2><p className="mt-2 text-sm text-zinc-500">共完成 {state.handNumber} 手牌 · 用时 {Math.max(1, Math.round(durationMs / 60000))} 分钟</p><div className="mx-auto mt-5 grid max-w-sm gap-2 text-left">{rankedPlayers.map((player) => <div key={player.id} className={`flex items-center rounded-xl border px-3 py-2 text-sm ${player.finishPosition === 1 ? "border-amber-200/25 bg-amber-200/[.07]" : "border-white/6 bg-black/20"}`}><span className="w-8 font-semibold text-amber-200">#{player.finishPosition}</span><span className="flex-1 text-zinc-200">{player.name}</span><span className="tabular-nums text-zinc-500">{formatChips(player.stack)}</span></div>)}</div><button onClick={onRestart} className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-300 px-6 text-sm font-semibold text-emerald-950 hover:bg-emerald-200"><RotateCcw className="size-4" />重新开局</button></div></div>}
    {showPostHandDialog && !isFinished && heroEliminated && !spectating && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="你已被淘汰"><div className="settlement-enter w-full max-w-md rounded-[28px] border border-rose-200/20 bg-[#1a1112] p-6 text-center shadow-[0_32px_100px_rgba(0,0,0,.72)]"><h2 className="text-xl font-semibold text-white">你的筹码已经输光</h2><p className="mt-2 text-sm leading-6 text-zinc-400">本手结果已结算。可以结束本局重新配置，也可以继续旁观；旁观时牌局会自动进行。</p><div className="mt-5 flex flex-wrap justify-center gap-2"><button onClick={onRestart} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-300 px-4 text-sm font-semibold text-emerald-950"><RotateCcw className="size-4" />结束并重新开局</button><button onClick={onSpectate} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 bg-white/[.05] px-4 text-sm text-zinc-200"><Play className="size-4" />继续旁观（自动进行）</button></div></div></div>}
  </div>;
};

const HistoryPanel = ({ tournaments, onClose }: { tournaments: TournamentState[]; onClose: () => void }) => {
  const [tournamentId, setTournamentId] = useState(tournaments[0]?.id ?? "");
  const state = tournaments.find((tournament) => tournament.id === tournamentId) ?? tournaments[0] ?? null;
  const hands = state ? availableHands(state) : [];
  const [selectedHand, setSelectedHand] = useState(hands[0] ?? 1);
  const frames = state ? buildReplayFrames(state, selectedHand, HERO_ID) : [];
  const [frameIndex, setFrameIndex] = useState(Math.max(0, frames.length - 1));
  const frame = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))];
  const stats = state ? calculatePlayerStats(state, HERO_ID) : null;
  useEffect(() => { if (!tournaments.some((tournament) => tournament.id === tournamentId)) setTournamentId(tournaments[0]?.id ?? ""); }, [tournamentId, tournaments]);
  useEffect(() => { setSelectedHand(hands[0] ?? 1); }, [state?.id]);
  useEffect(() => { setFrameIndex(Math.max(0, frames.length - 1)); }, [selectedHand, frames.length]);
  return <div className="fixed inset-0 z-50 bg-black/70 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="牌局记录">
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#111313] shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/8 p-4 sm:p-5"><div><h2 className="font-semibold text-white">牌局记录与回放</h2><p className="mt-1 text-xs text-zinc-500">所有记录仅保存在当前设备</p></div><button aria-label="关闭记录" onClick={onClose} className="grid size-9 place-items-center rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white"><X className="size-4" /></button></div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">{!state || !stats ? <div className="grid h-full place-items-center text-sm text-zinc-600">尚未开始比赛。</div> : <div className="space-y-5">
        {tournaments.length > 1 && <label className="block"><span className="mb-1.5 block text-xs text-zinc-500">比赛</span><select value={state.id} onChange={(event) => setTournamentId(event.target.value)} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.status === "finished" ? "已完成" : "进行中"} · {tournament.players.length} 人 · {tournament.handNumber} 手牌</option>)}</select></label>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ label: "手牌数", value: stats.hands }, { label: "VPIP", value: `${Math.round(stats.vpip * 100)}%` }, { label: "PFR", value: `${Math.round(stats.pfr * 100)}%` }, { label: "赢得底池", value: stats.potsWon }].map((item) => <div key={item.label} className="rounded-xl border border-white/8 p-3"><p className="text-xs text-zinc-600">{item.label}</p><p className="mt-1 text-lg font-semibold text-white">{item.value}</p></div>)}
        </div>
        <div className="rounded-2xl border border-white/8 bg-[#0c1110] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-zinc-200">基础回放</p><p className="text-xs text-zinc-600">按公开信息逐步重放</p></div><select value={selectedHand} onChange={(event) => setSelectedHand(Number(event.target.value))} className="rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">{hands.map((hand) => <option key={hand} value={hand}>第 {hand} 手牌</option>)}</select></div>
          {frame ? <>
            <div className="grid min-h-48 place-items-center rounded-xl border border-emerald-200/10 bg-[#123b2f] p-4 shadow-inner"><div className="text-center"><div className="mb-4 flex justify-center gap-2">{frame.board.length > 0 ? frame.board.map((card) => <CardFace key={card} card={card} small />) : <span className="text-xs text-emerald-100/40">公共牌尚未发出</span>}</div><p className="text-sm font-medium text-white">{frame.label}</p><p className="mt-1 text-xs text-emerald-100/50">{frame.phase} · 底池 {formatChips(frame.pot)}</p>{frame.heroCards.length > 0 && <div className="mt-4 flex justify-center gap-1">{frame.heroCards.map((card) => <CardFace key={card} card={card} small />)}</div>}</div></div>
            <div className="mt-4 flex items-center justify-between gap-3"><button disabled={frameIndex === 0} onClick={() => setFrameIndex((value) => Math.max(0, value - 1))} className="grid size-9 place-items-center rounded-xl border border-white/10 text-zinc-400 disabled:opacity-30"><ChevronLeft className="size-4" /></button><div className="flex-1"><input aria-label="回放进度" type="range" min="0" max={Math.max(0, frames.length - 1)} value={Math.min(frameIndex, Math.max(0, frames.length - 1))} onChange={(event) => setFrameIndex(Number(event.target.value))} className="w-full accent-emerald-300" /><p className="text-center text-[11px] text-zinc-600">{Math.min(frameIndex + 1, frames.length)} / {frames.length}</p></div><button disabled={frameIndex >= frames.length - 1} onClick={() => setFrameIndex((value) => Math.min(frames.length - 1, value + 1))} className="grid size-9 place-items-center rounded-xl border border-white/10 text-zinc-400 disabled:opacity-30"><ChevronRight className="size-4" /></button></div>
            <div className="mt-3 max-h-32 space-y-1 overflow-y-auto">{frame.actions.slice(-6).map((action, index) => <div key={`${action.playerId}-${index}`} className="flex justify-between text-xs"><span className="text-zinc-500">{state.players.find((player) => player.id === action.playerId)?.name}</span><span className="text-zinc-300">{action.label}</span></div>)}</div>
          </> : <p className="py-12 text-center text-sm text-zinc-600">该手牌暂无可回放事件。</p>}
        </div>
      </div>}</div>
    </div>
  </div>;
};

declare global { interface Document { modelContext?: { registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): void | Promise<void> } } }

export default function PokerApp() {
  const initialSetup = useMemo(readSetupSettings, []);
  const [screen, setScreen] = useState<"setup" | "game">("setup");
  const [playerCount, setPlayerCount] = useState(initialSetup.playerCount);
  const [startingStack, setStartingStack] = useState(initialSetup.startingStack);
  const [speed, setSpeed] = useState<"slow" | "standard" | "fast">(initialSetup.speed);
  const [heroSeat, setHeroSeat] = useState<number | "random">(initialSetup.heroSeat);
  const [profiles, setProfiles] = useState<BotProfile[]>(initialSetup.profiles);
  const [state, setState] = useState<TournamentState | null>(null);
  const [resumable, setResumable] = useState<TournamentState | null>(null);
  const [tournamentHistory, setTournamentHistory] = useState<TournamentState[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [autoNextHand, setAutoNextHand] = useState(readAutoNextHand);
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);
  const [spectating, setSpectating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [equity, setEquity] = useState<EquityResult | null>(null);
  const [equityLoading, setEquityLoading] = useState(false);
  const equityWorker = useRef<Worker | null>(null);

  useEffect(() => () => equityWorker.current?.terminate(), []);

  useEffect(() => {
    void Promise.all([loadTournament(), loadTournamentHistory()])
      .then(([saved, history]) => { setResumable(saved); setTournamentHistory(history); if (saved?.status === "finished") setState(saved); })
      .catch(() => setError("无法读取本地存档。"));
  }, []);
  useEffect(() => { localStorage.setItem("rivercraft-setup", JSON.stringify({ playerCount, startingStack, speed, heroSeat, profiles } satisfies SetupSettings)); }, [heroSeat, playerCount, profiles, speed, startingStack]);
  useEffect(() => { localStorage.setItem("rivercraft-auto-next", String(autoNextHand)); }, [autoNextHand]);
  useEffect(() => { localStorage.setItem("rivercraft-sound-enabled", String(soundEnabled)); }, [soundEnabled]);
  useEffect(() => { if (!state) return; const timer = window.setTimeout(() => { void saveTournament(state).then(() => { setResumable(state); if (state.status === "finished") setTournamentHistory((history) => [state, ...history.filter((item) => item.id !== state.id)]); }).catch(() => setError("自动保存失败，本局仍可继续。")); }, 120); return () => window.clearTimeout(timer); }, [state]);

  const startTournament = useCallback(() => {
    try {
      const assignedSeat = heroSeat === "random" ? secureRandomSeat(playerCount) : Math.min(heroSeat, playerCount - 1);
      const created = createTournament({ players: buildPlayers(playerCount, profiles, assignedSeat), startingStack, blindLevels: defaultBlindLevels(speed) });
      activateGameAudio("deal", soundEnabled);
      setState(created.state); setSpectating(false); setEquity(null); setError(null); setScreen("game");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法创建锦标赛。"); }
  }, [heroSeat, playerCount, profiles, soundEnabled, speed, startingStack]);

  useEffect(() => {
    if (!state || screen !== "game" || state.status !== "playing" || state.hand?.phase === "complete") return;
    const seat = state.hand?.currentPlayerSeat;
    if (seat === null || seat === undefined) return;
    const actor = state.players.find((player) => player.seat === seat);
    if (!actor || actor.kind !== "bot") return;
    const botView = projectPlayerView(state, actor.id);
    const thinkDelay = calculateBotThinkDelay(botView, new CryptoRandomSource());
    const timer = window.setTimeout(() => {
      try {
        const action = decideBotAction(botView, actor.difficulty, actor.style, new CryptoRandomSource());
        const result = submitAction(state, actor.id, action);
        if (result.ok) { playGameSound(action.type, soundEnabled); setState(result.state); setEquity(null); } else setError(result.error.message);
      } catch (caught) {
        const view = projectPlayerView(state, actor.id);
        const fallbackAction: PlayerAction = view.legalActions?.canCheck ? { type: "check" } : { type: "fold" };
        const fallback = submitAction(state, actor.id, fallbackAction);
        if (fallback.ok) { playGameSound(fallbackAction.type, soundEnabled); setState(fallback.state); } else setError(caught instanceof Error ? caught.message : "机器人行动失败。");
      }
    }, thinkDelay);
    return () => window.clearTimeout(timer);
  }, [screen, soundEnabled, state]);

  const act = (action: PlayerAction) => { if (!state) return; const result = submitAction(state, HERO_ID, action); if (result.ok) { activateGameAudio(action.type, soundEnabled); setState(result.state); setEquity(null); setError(null); } else setError(result.error.message); };
  const nextHand = useCallback(() => {
    try {
      setState((current) => current ? beginNextHand(current).state : current);
      playGameSound("deal", soundEnabled);
      setEquity(null);
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法开始下一手。"); }
  }, [soundEnabled]);
  useEffect(() => {
    if (!state || screen !== "game" || state.status !== "playing" || state.hand?.phase !== "complete" || !autoNextHand) return;
    const heroIsEliminated = state.players.find((player) => player.id === HERO_ID)?.eliminated === true;
    if (heroIsEliminated && !spectating) return;
    const timer = window.setTimeout(nextHand, HAND_RESULT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [autoNextHand, nextHand, screen, spectating, state]);
  const calculateEquity = () => {
    if (!state) return;
    const view = projectPlayerView(state, HERO_ID); const hero = view.players.find((player) => player.id === HERO_ID);
    if (!hero?.holeCards || !view.hand) return;
    setEquityLoading(true);
    equityWorker.current?.terminate();
    const worker = new Worker(new URL("../workers/equity.worker.ts", import.meta.url), { type: "module" });
    equityWorker.current = worker;
    const opponents = Math.max(1, view.players.filter((player) => !player.eliminated && !player.folded && player.id !== HERO_ID).length);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: EquityResult; message?: string }>) => {
      if (event.data.ok && event.data.result) { setEquity(event.data.result); setError(null); }
      else setError(event.data.message ?? "胜率估算失败。");
      setEquityLoading(false); worker.terminate(); if (equityWorker.current === worker) equityWorker.current = null;
    };
    worker.onerror = () => { setError("胜率估算线程失败。"); setEquityLoading(false); worker.terminate(); if (equityWorker.current === worker) equityWorker.current = null; };
    worker.postMessage({ holeCards: hero.holeCards, board: view.hand.board, opponentCount: opponents, samples: 600 });
  };
  const resume = () => { if (resumable) { activateGameAudio(null, soundEnabled); setState(resumable); setSpectating(false); setScreen("game"); } };
  const togglePause = () => { if (!state || state.status === "finished") return; try { activateGameAudio(null, soundEnabled); setState(state.status === "paused" ? resumeTournament(state).state : pauseTournament(state).state); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "无法切换暂停状态。"); } };
  const resetSavedGame = () => { void clearTournament(); setState(null); setResumable(null); setSpectating(false); setEquity(null); setScreen("setup"); };
  const continueAsSpectator = () => { setSpectating(true); setAutoNextHand(true); nextHand(); };

  useEffect(() => {
    const context = document.modelContext; if (!context?.registerTool) return; const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({ name: "start_poker_tournament", title: "开始德州扑克锦标赛", description: "使用当前界面配置开始一场新锦标赛。", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: () => { startTournament(); return { status: "started", playerCount, startingStack, speed }; } }, { signal: lifecycle.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({ name: "read_poker_tournament", title: "读取锦标赛状态", description: "读取当前锦标赛的手牌编号、剩余人数、盲注和公开状态。", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => state ? { status: state.status, handNumber: state.handNumber, remainingPlayers: state.players.filter((player) => !player.eliminated).length, blindLevel: state.config.blindLevels[state.blindLevelIndex], phase: state.hand?.phase ?? null } : { status: "not-started" } }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [playerCount, speed, startTournament, startingStack, state]);

  const page = useMemo(() => screen === "game" && state?.hand
    ? <GameTable state={state} onAction={act} onNextHand={nextHand} onEquity={calculateEquity} onTogglePause={togglePause} onRestart={resetSavedGame} onSpectate={continueAsSpectator} autoNextHand={autoNextHand} onAutoNextHandChange={setAutoNextHand} soundEnabled={soundEnabled} onSoundEnabledChange={setSoundEnabled} spectating={spectating} equity={equity} equityLoading={equityLoading} error={error} />
    : <SetupScreen playerCount={playerCount} setPlayerCount={setPlayerCount} startingStack={startingStack} setStartingStack={setStartingStack} speed={speed} setSpeed={setSpeed} heroSeat={heroSeat} setHeroSeat={setHeroSeat} profiles={profiles} setProfiles={setProfiles} onStart={startTournament} resumable={resumable} onResume={resume} />,
    [screen, state, equity, equityLoading, error, autoNextHand, soundEnabled, spectating, nextHand, playerCount, startingStack, speed, heroSeat, profiles, startTournament, resumable]);

  const historyOptions = [...new Map([state ?? resumable, ...tournamentHistory].filter((item): item is TournamentState => Boolean(item)).map((item) => [item.id, item])).values()];
  return <main className="min-h-screen bg-background text-foreground"><Header onHistory={() => setShowHistory(true)} onSetup={() => setScreen("setup")} gameActive={Boolean(state)} />{page}{showHistory && <HistoryPanel tournaments={historyOptions} onClose={() => setShowHistory(false)} />}{screen === "setup" && state && <button onClick={resetSavedGame} className="fixed bottom-4 left-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-500 backdrop-blur hover:text-rose-300"><RotateCcw className="size-3.5" />清除当前存档</button>}</main>;
}
