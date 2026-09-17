export type Suit = "c" | "d" | "h" | "s";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = `${Rank}${Suit}`;

export type HandPhase = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type TournamentStatus = "playing" | "paused" | "finished";
export type PlayerKind = "human" | "bot";
export type BotDifficulty = "easy" | "normal" | "hard";
export type BotStyle = "tight" | "balanced" | "loose" | "aggressive";

export interface PlayerConfig {
  id: string;
  name: string;
  kind: PlayerKind;
  seat: number;
  difficulty?: BotDifficulty;
  style?: BotStyle;
}

export interface PlayerState extends PlayerConfig {
  stack: number;
  eliminated: boolean;
  finishPosition?: number;
}

export interface HandPlayerState {
  playerId: string;
  seat: number;
  stack: number;
  holeCards: Card[];
  streetContribution: number;
  totalContribution: number;
  folded: boolean;
  allIn: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
  hands: number;
}

export interface TournamentConfig {
  players: PlayerConfig[];
  startingStack: number;
  blindLevels: BlindLevel[];
}

export interface HandState {
  id: string;
  number: number;
  phase: HandPhase;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentPlayerSeat: number | null;
  currentBet: number;
  lastFullRaiseSize: number;
  board: Card[];
  deck: Card[];
  players: HandPlayerState[];
  actedSinceFullRaise: number[];
  lastActedAtBet: Record<number, number>;
  pots: Pot[];
  winners: WinnerShare[];
  reachedShowdown: boolean;
}

export interface WinnerShare {
  playerId: string;
  amount: number;
  handName?: string;
  bestFive?: Card[];
}

export interface TournamentState {
  id: string;
  status: TournamentStatus;
  config: TournamentConfig;
  players: PlayerState[];
  handNumber: number;
  blindLevelIndex: number;
  dealerSeat: number | null;
  hand: HandState | null;
  events: GameEvent[];
  championId?: string;
}

export type TournamentSnapshot = Omit<TournamentState, "events">;

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; to: number }
  | { type: "all-in" };

export interface LegalActions {
  playerId: string;
  seat: number;
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number | null;
  maxRaiseTo: number;
  canAllIn: boolean;
}

export interface GameEvent {
  id: string;
  sequence: number;
  timestamp: number;
  type:
    | "tournament-started"
    | "hand-started"
    | "blind-posted"
    | "hole-cards-dealt"
    | "player-acted"
    | "community-cards-dealt"
    | "street-advanced"
    | "pot-awarded"
    | "uncalled-bet-returned"
    | "player-eliminated"
    | "blind-level-advanced"
    | "hand-completed"
    | "tournament-finished"
    | "tournament-paused"
    | "tournament-resumed"
    | "state-checkpoint";
  handNumber?: number;
  playerId?: string;
  public: Record<string, unknown>;
  private?: Record<string, unknown>;
}

export interface PlayerView {
  tournamentId: string;
  status: TournamentStatus;
  handNumber: number;
  blindLevel: BlindLevel;
  heroId: string;
  players: Array<{
    id: string;
    name: string;
    seat: number;
    stack: number;
    eliminated: boolean;
    folded?: boolean;
    allIn?: boolean;
    streetContribution?: number;
    totalContribution?: number;
    holeCards?: Card[];
  }>;
  hand: null | {
    phase: HandPhase;
    dealerSeat: number;
    smallBlindSeat: number;
    bigBlindSeat: number;
    currentPlayerSeat: number | null;
    board: Card[];
    currentBet: number;
    potTotal: number;
    pots: Pot[];
    winners: WinnerShare[];
  };
  legalActions: LegalActions | null;
}

export interface RandomSource {
  next(): number;
}

export interface EngineResult {
  state: TournamentState;
  events: GameEvent[];
}

export interface EngineError {
  code: string;
  message: string;
}

export type ActionResult =
  | { ok: true; state: TournamentState; events: GameEvent[] }
  | { ok: false; state: TournamentState; error: EngineError };
