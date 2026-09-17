import { createDeck, CryptoRandomSource, shuffleDeck } from "./cards";
import { evaluateHand, selectWinningIndexes } from "./evaluator";
import type {
  ActionResult,
  BlindLevel,
  Card,
  CashGameConfig,
  EngineResult,
  GameEvent,
  HandPhase,
  HandPlayerState,
  HandState,
  LegalActions,
  PlayerAction,
  RandomSource,
  TournamentConfig,
  TournamentSnapshot,
  TournamentState,
  WinnerShare,
} from "./types";

const clone = <T,>(value: T): T => structuredClone(value);

const orderedSeats = (state: TournamentState): number[] =>
  state.players
    .filter((player) => !player.eliminated && (state.config.mode === "tournament" || player.stack > 0))
    .map((player) => player.seat)
    .sort((a, b) => a - b);

export const currentBlindLevel = (state: TournamentState): BlindLevel => state.config.mode === "cash"
  ? { smallBlind: state.config.smallBlind, bigBlind: state.config.bigBlind, hands: Number.MAX_SAFE_INTEGER }
  : state.config.blindLevels[state.blindLevelIndex];

const nextFrom = (seats: readonly number[], from: number): number => {
  const sorted = [...seats].sort((a, b) => a - b);
  return sorted.find((seat) => seat > from) ?? sorted[0];
};

const seatsClockwiseFrom = (seats: readonly number[], from: number): number[] => {
  const sorted = [...seats].sort((a, b) => a - b);
  return [...sorted.filter((seat) => seat > from), ...sorted.filter((seat) => seat <= from)];
};

const makeEvent = (
  state: TournamentState,
  type: GameEvent["type"],
  data: Omit<GameEvent, "id" | "sequence" | "timestamp" | "type">,
  pendingCount = 0,
): GameEvent => ({
  id: `${state.id}:${state.events.length + pendingCount + 1}`,
  sequence: state.events.length + pendingCount + 1,
  timestamp: Date.now(),
  type,
  ...data,
});

const appendEvents = (state: TournamentState, events: GameEvent[]): void => {
  state.events.push(...events);
};

const snapshotOf = (state: TournamentState): TournamentSnapshot => {
  const { events: _events, ...snapshot } = state;
  return clone(snapshot);
};

const addCheckpoint = (state: TournamentState, events: GameEvent[], reason: string): void => {
  events.push(makeEvent(state, "state-checkpoint", {
    public: { reason },
    private: { snapshot: snapshotOf(state) },
  }, events.length));
};

const syncPlayerStack = (state: TournamentState, handPlayer: HandPlayerState): void => {
  const player = state.players.find((candidate) => candidate.id === handPlayer.playerId);
  if (!player) throw new Error(`Missing tournament player ${handPlayer.playerId}.`);
  player.stack = handPlayer.stack;
};

const commitChips = (state: TournamentState, handPlayer: HandPlayerState, amount: number): number => {
  const committed = Math.max(0, Math.min(handPlayer.stack, amount));
  handPlayer.stack -= committed;
  handPlayer.streetContribution += committed;
  handPlayer.totalContribution += committed;
  handPlayer.allIn = handPlayer.stack === 0;
  syncPlayerStack(state, handPlayer);
  return committed;
};

const handPlayerAtSeat = (hand: HandState, seat: number): HandPlayerState => {
  const player = hand.players.find((candidate) => candidate.seat === seat);
  if (!player) throw new Error(`Missing hand player at seat ${seat}.`);
  return player;
};

const draw = (hand: HandState): Card => {
  const card = hand.deck.pop();
  if (!card) throw new Error("The deck is empty.");
  return card;
};

const dealCommunity = (state: TournamentState, count: number, events: GameEvent[]): void => {
  const hand = state.hand!;
  draw(hand); // burn
  const cards = Array.from({ length: count }, () => draw(hand));
  hand.board.push(...cards);
  events.push(makeEvent(state, "community-cards-dealt", {
    handNumber: hand.number,
    public: { phase: hand.phase, cards },
  }, events.length));
};

const publicPotTotal = (hand: HandState): number =>
  hand.players.reduce((total, player) => total + player.totalContribution, 0);

const buildSidePots = (hand: HandState): { pots: HandState["pots"]; refunds: Array<{ playerId: string; amount: number }> } => {
  const levels = [...new Set(hand.players.map((player) => player.totalContribution).filter((amount) => amount > 0))]
    .sort((a, b) => a - b);
  let previous = 0;
  const pots: HandState["pots"] = [];
  const refunds: Array<{ playerId: string; amount: number }> = [];
  for (const level of levels) {
    const contributors = hand.players.filter((player) => player.totalContribution >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    if (amount <= 0) continue;
    if (contributors.length === 1) refunds.push({ playerId: contributors[0].playerId, amount });
    else pots.push({ amount, eligiblePlayerIds: contributors.filter((player) => !player.folded).map((player) => player.playerId) });
  }
  return { pots, refunds };
};

const returnUncalledBet = (state: TournamentState, playerId: string, amount: number, events: GameEvent[]): void => {
  const player = state.hand!.players.find((candidate) => candidate.playerId === playerId)!;
  player.stack += amount;
  player.totalContribution -= amount;
  player.streetContribution = Math.max(0, player.streetContribution - amount);
  player.allIn = player.stack === 0;
  syncPlayerStack(state, player);
  events.push(makeEvent(state, "uncalled-bet-returned", {
    handNumber: state.hand!.number,
    playerId,
    public: { amount },
  }, events.length));
};

const award = (
  state: TournamentState,
  playerId: string,
  amount: number,
  handName: string | undefined,
  bestFive: Card[] | undefined,
  events: GameEvent[],
): void => {
  const handPlayer = state.hand!.players.find((player) => player.playerId === playerId)!;
  handPlayer.stack += amount;
  syncPlayerStack(state, handPlayer);
  const existing = state.hand!.winners.find((winner) => winner.playerId === playerId);
  if (existing) existing.amount += amount;
  else state.hand!.winners.push({ playerId, amount, handName, bestFive });
  events.push(makeEvent(state, "pot-awarded", {
    handNumber: state.hand!.number,
    playerId,
    public: { amount, handName, bestFive },
  }, events.length));
};

const finalizeHand = (state: TournamentState, events: GameEvent[]): void => {
  const hand = state.hand!;
  hand.phase = "complete";
  hand.currentPlayerSeat = null;

  if (state.config.mode === "tournament") {
    const newlyEliminated = state.players
      .filter((player) => !player.eliminated && player.stack === 0)
      .sort((first, second) => {
        const firstStart = hand.players.find((player) => player.playerId === first.id)!.totalContribution;
        const secondStart = hand.players.find((player) => player.playerId === second.id)!.totalContribution;
        return firstStart - secondStart || first.seat - second.seat;
      });
    const activeBefore = state.players.filter((player) => !player.eliminated).length;
    newlyEliminated.forEach((player, index) => {
      player.eliminated = true;
      player.finishPosition = activeBefore - index;
      events.push(makeEvent(state, "player-eliminated", {
        handNumber: hand.number,
        playerId: player.id,
        public: { position: player.finishPosition },
      }, events.length));
    });
  } else if (state.cashSession) {
    new Set(hand.winners.map((winner) => winner.playerId)).forEach((playerId) => {
      const ledger = state.cashSession!.ledgers[playerId];
      if (ledger) ledger.potsWon += 1;
    });
  }

  events.push(makeEvent(state, "hand-completed", {
    handNumber: hand.number,
    public: {
      board: hand.board,
      winners: hand.winners,
      potTotal: hand.winners.reduce((total, winner) => total + winner.amount, 0),
    },
  }, events.length));

  if (state.config.mode === "tournament") {
    const survivors = state.players.filter((player) => !player.eliminated);
    if (survivors.length === 1) {
      survivors[0].finishPosition = 1;
      state.status = "finished";
      state.championId = survivors[0].id;
      events.push(makeEvent(state, "tournament-finished", {
        playerId: survivors[0].id,
        public: { championId: survivors[0].id, handsPlayed: state.handNumber },
      }, events.length));
      return;
    }
    const level = state.config.blindLevels[state.blindLevelIndex];
    if (state.handNumber % level.hands === 0 && state.blindLevelIndex < state.config.blindLevels.length - 1) {
      state.blindLevelIndex += 1;
      const nextLevel = state.config.blindLevels[state.blindLevelIndex];
      events.push(makeEvent(state, "blind-level-advanced", {
        public: { levelIndex: state.blindLevelIndex, ...nextLevel },
      }, events.length));
    }
  }
};

const settleUncontested = (state: TournamentState, winnerId: string, events: GameEvent[]): void => {
  const hand = state.hand!;
  const total = publicPotTotal(hand);
  hand.pots = total > 0 ? [{ amount: total, eligiblePlayerIds: [winnerId] }] : [];
  award(state, winnerId, total, undefined, undefined, events);
  finalizeHand(state, events);
};

const settleShowdown = (state: TournamentState, events: GameEvent[]): void => {
  const hand = state.hand!;
  hand.reachedShowdown = true;
  hand.phase = "showdown";
  hand.currentPlayerSeat = null;
  const { pots, refunds } = buildSidePots(hand);
  hand.pots = pots;
  refunds.forEach((refund) => returnUncalledBet(state, refund.playerId, refund.amount, events));
  const seatOrder = seatsClockwiseFrom(hand.players.map((player) => player.seat), hand.dealerSeat);

  for (const pot of hand.pots) {
    const eligible = pot.eligiblePlayerIds.map((id) => hand.players.find((player) => player.playerId === id)!).filter(Boolean);
    if (eligible.length === 0) continue;
    let winners = eligible;
    if (eligible.length > 1) {
      const winningIndexes = selectWinningIndexes(eligible.map((player) => [...player.holeCards, ...hand.board]));
      winners = winningIndexes.map((index) => eligible[index]);
    }
    const orderedWinners = seatOrder.flatMap((seat) => winners.filter((winner) => winner.seat === seat));
    const baseShare = Math.floor(pot.amount / orderedWinners.length);
    let oddChips = pot.amount % orderedWinners.length;
    for (const winner of orderedWinners) {
      const amount = baseShare + (oddChips > 0 ? 1 : 0);
      oddChips = Math.max(0, oddChips - 1);
      const evaluated = evaluateHand([...winner.holeCards, ...hand.board]);
      award(state, winner.playerId, amount, evaluated.name, evaluated.bestFive, events);
    }
  }
  finalizeHand(state, events);
};

const canAct = (player: HandPlayerState): boolean => !player.folded && !player.allIn;

const actionNeeded = (hand: HandState, player: HandPlayerState): boolean =>
  canAct(player) && (player.streetContribution !== hand.currentBet || hand.lastActedAtBet[player.seat] !== hand.currentBet);

const nextActionSeat = (hand: HandState, from: number): number | null => {
  const candidates = hand.players.filter((player) => actionNeeded(hand, player)).map((player) => player.seat);
  return candidates.length > 0 ? nextFrom(candidates, from) : null;
};

const roundComplete = (hand: HandState): boolean =>
  hand.players.filter(canAct).every((player) =>
    player.streetContribution === hand.currentBet && hand.lastActedAtBet[player.seat] === hand.currentBet);

const firstPostflopSeat = (hand: HandState): number | null => {
  const seats = hand.players.filter(canAct).map((player) => player.seat);
  return seats.length > 0 ? nextFrom(seats, hand.dealerSeat) : null;
};

const advanceStreet = (state: TournamentState, events: GameEvent[]): void => {
  const hand = state.hand!;
  const nextPhase: Partial<Record<HandPhase, HandPhase>> = {
    preflop: "flop",
    flop: "turn",
    turn: "river",
    river: "showdown",
  };
  const target = nextPhase[hand.phase];
  if (!target || target === "showdown") {
    settleShowdown(state, events);
    return;
  }
  hand.phase = target;
  hand.currentBet = 0;
  hand.lastFullRaiseSize = currentBlindLevel(state).bigBlind;
  hand.actedSinceFullRaise = [];
  hand.lastActedAtBet = {};
  hand.players.forEach((player) => { player.streetContribution = 0; });
  dealCommunity(state, target === "flop" ? 3 : 1, events);
  events.push(makeEvent(state, "street-advanced", {
    handNumber: hand.number,
    public: { phase: target },
  }, events.length));

  const actionable = hand.players.filter(canAct);
  if (actionable.length <= 1) {
    runOutBoard(state, events);
    return;
  }
  hand.currentPlayerSeat = firstPostflopSeat(hand);
};

const runOutBoard = (state: TournamentState, events: GameEvent[]): void => {
  const hand = state.hand!;
  while (hand.board.length < 5) {
    if (hand.board.length === 0) {
      hand.phase = "flop";
      dealCommunity(state, 3, events);
    } else if (hand.board.length === 3) {
      hand.phase = "turn";
      dealCommunity(state, 1, events);
    } else {
      hand.phase = "river";
      dealCommunity(state, 1, events);
    }
    events.push(makeEvent(state, "street-advanced", {
      handNumber: hand.number,
      public: { phase: hand.phase, automatic: true },
    }, events.length));
  }
  settleShowdown(state, events);
};

const progressAfterAction = (state: TournamentState, previousSeat: number, events: GameEvent[]): void => {
  const hand = state.hand!;
  const contenders = hand.players.filter((player) => !player.folded);
  if (contenders.length === 1) {
    settleUncontested(state, contenders[0].playerId, events);
    return;
  }
  if (hand.players.filter(canAct).length === 0) {
    runOutBoard(state, events);
    return;
  }
  if (roundComplete(hand)) {
    advanceStreet(state, events);
    return;
  }
  hand.currentPlayerSeat = nextActionSeat(hand, previousSeat);
  if (hand.currentPlayerSeat === null) advanceStreet(state, events);
};

export const getLegalActions = (state: TournamentState): LegalActions | null => {
  if (state.status !== "playing") return null;
  const hand = state.hand;
  if (!hand || hand.phase === "complete" || hand.phase === "showdown" || hand.currentPlayerSeat === null) return null;
  const player = handPlayerAtSeat(hand, hand.currentPlayerSeat);
  const toCall = Math.max(0, hand.currentBet - player.streetContribution);
  const maxRaiseTo = player.streetContribution + player.stack;
  const minRaiseTo = hand.currentBet === 0
    ? currentBlindLevel(state).bigBlind
    : hand.currentBet + hand.lastFullRaiseSize;
  const otherActionable = hand.players.some((candidate) =>
    candidate.playerId !== player.playerId && !candidate.folded && !candidate.allIn);
  const lastActedAt = hand.lastActedAtBet[player.seat];
  const raiseRightsOpen = lastActedAt === undefined || hand.currentBet - lastActedAt >= hand.lastFullRaiseSize;
  const canRaise = otherActionable && raiseRightsOpen && maxRaiseTo > hand.currentBet;
  return {
    playerId: player.playerId,
    seat: player.seat,
    toCall,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0 && player.stack > 0,
    callAmount: Math.min(toCall, player.stack),
    canRaise,
    minRaiseTo: canRaise ? Math.min(minRaiseTo, maxRaiseTo) : null,
    maxRaiseTo,
    // An all-in that exceeds the call is a raise and is illegal when a prior
    // short raise has not reopened this player's raising rights.
    canAllIn: player.stack > 0 && (maxRaiseTo <= hand.currentBet || canRaise),
  };
};

const validateAction = (legal: LegalActions, action: PlayerAction): string | null => {
  if (action.type === "fold" && !legal.canFold) return "当前没有需要跟注的下注。";
  if (action.type === "check" && !legal.canCheck) return "面对下注时不能过牌。";
  if (action.type === "call" && !legal.canCall) return "当前不能跟注。";
  if (action.type === "raise") {
    if (!legal.canRaise || legal.minRaiseTo === null) return "当前没有加注权。";
    if (!Number.isInteger(action.to)) return "加注额必须是整数。";
    if (action.to <= 0 || action.to > legal.maxRaiseTo) return "加注额超出可用筹码。";
    if (action.to < legal.minRaiseTo && action.to !== legal.maxRaiseTo) return `最小加注到 ${legal.minRaiseTo}。`;
  }
  if (action.type === "all-in" && !legal.canAllIn) return "当前不能全下。";
  return null;
};

export const submitAction = (source: TournamentState, playerId: string, action: PlayerAction): ActionResult => {
  const legal = getLegalActions(source);
  if (!legal || legal.playerId !== playerId) {
    return { ok: false, state: source, error: { code: "not-your-turn", message: "当前没有轮到该玩家行动。" } };
  }
  const validationError = validateAction(legal, action);
  if (validationError) {
    return { ok: false, state: source, error: { code: "illegal-action", message: validationError } };
  }

  const state = clone(source);
  const hand = state.hand!;
  const player = handPlayerAtSeat(hand, legal.seat);
  const events: GameEvent[] = [];
  const beforeBet = hand.currentBet;
  let committed = 0;
  let finalAction: PlayerAction["type"] = action.type;

  if (action.type === "fold") {
    player.folded = true;
  } else if (action.type === "check") {
    // no chips
  } else if (action.type === "call") {
    committed = commitChips(state, player, legal.callAmount);
  } else {
    const target = action.type === "all-in" ? legal.maxRaiseTo : action.to;
    committed = commitChips(state, player, target - player.streetContribution);
    if (target <= beforeBet) finalAction = "call";
    else {
      finalAction = target === legal.maxRaiseTo ? "all-in" : "raise";
      hand.currentBet = target;
      const raiseSize = target - beforeBet;
      if (raiseSize >= hand.lastFullRaiseSize || beforeBet === 0) {
        hand.lastFullRaiseSize = Math.max(raiseSize, currentBlindLevel(state).bigBlind);
        hand.actedSinceFullRaise = [player.seat];
      }
    }
  }

  if (!hand.actedSinceFullRaise.includes(player.seat)) hand.actedSinceFullRaise.push(player.seat);
  hand.lastActedAtBet[player.seat] = hand.currentBet;
  events.push(makeEvent(state, "player-acted", {
    handNumber: hand.number,
    playerId,
    public: {
      action: finalAction,
      phase: hand.phase,
      committed,
      to: player.streetContribution,
      stack: player.stack,
    },
  }, events.length));

  progressAfterAction(state, player.seat, events);
  addCheckpoint(state, events, "action-applied");
  appendEvents(state, events);
  return { ok: true, state, events };
};

const applyCashBuyIn = (
  state: TournamentState,
  playerId: string,
  amount: number,
  events: GameEvent[],
  automatic: boolean,
): void => {
  if (state.config.mode !== "cash" || !state.cashSession) throw new Error("This game is not a cash table.");
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown cash player ${playerId}.`);
  player.stack += amount;
  player.eliminated = false;
  delete player.finishPosition;
  const ledger = state.cashSession.ledgers[playerId];
  if (!ledger) throw new Error(`Missing cash ledger for ${playerId}.`);
  ledger.totalBuyIn += amount;
  ledger.rebuyCount += 1;
  events.push(makeEvent(state, "cash-player-rebought", {
    handNumber: state.handNumber,
    playerId,
    public: { amount, stack: player.stack, totalBuyIn: ledger.totalBuyIn, automatic },
  }, events.length));
};

const autoRebuyCashBots = (state: TournamentState, events: GameEvent[]): void => {
  if (state.config.mode !== "cash" || !state.config.botAutoRebuy) return;
  const buyIn = state.config.buyIn;
  state.players
    .filter((player) => player.kind === "bot" && player.stack === 0)
    .forEach((player) => applyCashBuyIn(state, player.id, buyIn, events, true));
};

export const beginNextHand = (
  source: TournamentState,
  random: RandomSource = new CryptoRandomSource(),
  fixedDeck?: Card[],
): EngineResult => {
  const state = clone(source);
  const events: GameEvent[] = [];
  if (state.status !== "playing") throw new Error("Game is not active.");
  if (state.hand && state.hand.phase !== "complete") throw new Error("The current hand is not complete.");
  autoRebuyCashBots(state, events);
  if (state.config.mode === "cash" && state.players.some((player) => player.kind === "human" && player.stack === 0)) {
    throw new Error("请先重新买入或结束现金桌。");
  }
  const seats = orderedSeats(state);
  if (seats.length < 2) throw new Error("At least two players are required to start a hand.");

  const dealerSeat = state.dealerSeat === null ? seats[0] : nextFrom(seats, state.dealerSeat);
  const headsUp = seats.length === 2;
  const smallBlindSeat = headsUp ? dealerSeat : nextFrom(seats, dealerSeat);
  const bigBlindSeat = nextFrom(seats, smallBlindSeat);
  const firstToAct = headsUp ? dealerSeat : nextFrom(seats, bigBlindSeat);
  const deck = fixedDeck ? [...fixedDeck] : shuffleDeck(createDeck(), random);
  if (new Set(deck).size !== 52 || deck.length !== 52) throw new Error("A hand requires a unique 52-card deck.");

  state.handNumber += 1;
  state.dealerSeat = dealerSeat;
  const handPlayers: HandPlayerState[] = state.players.filter((player) => seats.includes(player.seat)).map((player) => ({
    playerId: player.id,
    seat: player.seat,
    stack: player.stack,
    holeCards: [],
    streetContribution: 0,
    totalContribution: 0,
    folded: false,
    allIn: false,
  }));
  const level = currentBlindLevel(state);
  const hand: HandState = {
    id: `${state.id}:hand:${state.handNumber}`,
    number: state.handNumber,
    phase: "preflop",
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    currentPlayerSeat: firstToAct,
    currentBet: level.bigBlind,
    lastFullRaiseSize: level.bigBlind,
    board: [],
    deck,
    players: handPlayers,
    actedSinceFullRaise: [],
    lastActedAtBet: {},
    pots: [],
    winners: [],
    reachedShowdown: false,
  };
  state.hand = hand;

  events.push(makeEvent(state, "hand-started", {
    handNumber: hand.number,
    public: {
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      level: state.blindLevelIndex,
      players: handPlayers.map((player) => ({ playerId: player.playerId, seat: player.seat, stack: player.stack })),
    },
  }, events.length));

  const dealOrder = seatsClockwiseFrom(seats, dealerSeat);
  for (let round = 0; round < 2; round += 1) {
    for (const seat of dealOrder) handPlayerAtSeat(hand, seat).holeCards.push(draw(hand));
  }
  hand.players.forEach((player) => {
    events.push(makeEvent(state, "hole-cards-dealt", {
      handNumber: hand.number,
      playerId: player.playerId,
      public: { seat: player.seat, count: 2 },
      private: { cards: player.holeCards },
    }, events.length));
  });

  const smallBlind = handPlayerAtSeat(hand, smallBlindSeat);
  const smallPosted = commitChips(state, smallBlind, level.smallBlind);
  events.push(makeEvent(state, "blind-posted", {
    handNumber: hand.number,
    playerId: smallBlind.playerId,
    public: { kind: "small", amount: smallPosted, seat: smallBlindSeat },
  }, events.length));
  const bigBlind = handPlayerAtSeat(hand, bigBlindSeat);
  const bigPosted = commitChips(state, bigBlind, level.bigBlind);
  events.push(makeEvent(state, "blind-posted", {
    handNumber: hand.number,
    playerId: bigBlind.playerId,
    public: { kind: "big", amount: bigPosted, seat: bigBlindSeat },
  }, events.length));

  if (!actionNeeded(hand, handPlayerAtSeat(hand, firstToAct))) {
    hand.currentPlayerSeat = nextActionSeat(hand, firstToAct);
  }
  if (hand.players.filter(canAct).length <= 1) runOutBoard(state, events);
  addCheckpoint(state, events, "hand-started");
  appendEvents(state, events);
  return { state, events };
};

export const createTournament = (
  config: TournamentConfig,
  random: RandomSource = new CryptoRandomSource(),
  fixedDeck?: Card[],
): EngineResult => {
  if (config.mode !== "tournament") throw new Error("Tournament configuration must use tournament mode.");
  if (config.players.length < 2 || config.players.length > 9) throw new Error("A tournament requires 2 to 9 players.");
  if (new Set(config.players.map((player) => player.id)).size !== config.players.length) throw new Error("Player ids must be unique.");
  if (new Set(config.players.map((player) => player.seat)).size !== config.players.length) throw new Error("Seats must be unique.");
  if (!Number.isInteger(config.startingStack) || config.startingStack <= 0) throw new Error("Starting stack must be a positive integer.");
  if (config.blindLevels.length === 0) throw new Error("At least one blind level is required.");

  const id = `tournament:${Date.now()}:${Math.floor(random.next() * 1_000_000)}`;
  const state: TournamentState = {
    id,
    status: "playing",
    config: clone(config),
    players: config.players.map((player) => ({ ...player, stack: config.startingStack, eliminated: false })),
    handNumber: 0,
    blindLevelIndex: 0,
    dealerSeat: null,
    hand: null,
    events: [],
  };
  const started = makeEvent(state, "tournament-started", {
    public: { playerCount: config.players.length, startingStack: config.startingStack },
    private: { config },
  });
  state.events.push(started);
  const hand = beginNextHand(state, random, fixedDeck);
  return { state: hand.state, events: [started, ...hand.events] };
};

export const createCashGame = (
  config: CashGameConfig,
  random: RandomSource = new CryptoRandomSource(),
  fixedDeck?: Card[],
): EngineResult => {
  if (config.mode !== "cash") throw new Error("Cash-game configuration must use cash mode.");
  if (config.players.length < 2 || config.players.length > 9) throw new Error("A cash table requires 2 to 9 players.");
  if (new Set(config.players.map((player) => player.id)).size !== config.players.length) throw new Error("Player ids must be unique.");
  if (new Set(config.players.map((player) => player.seat)).size !== config.players.length) throw new Error("Seats must be unique.");
  if (!Number.isInteger(config.smallBlind) || !Number.isInteger(config.bigBlind) || config.smallBlind <= 0 || config.bigBlind <= config.smallBlind) throw new Error("Cash blinds are invalid.");
  if (!Number.isInteger(config.minBuyIn) || !Number.isInteger(config.maxBuyIn) || config.minBuyIn <= 0 || config.maxBuyIn < config.minBuyIn) throw new Error("Cash buy-in limits are invalid.");
  if (!Number.isInteger(config.buyIn) || config.buyIn < config.minBuyIn || config.buyIn > config.maxBuyIn) throw new Error("Cash buy-in is outside the table limits.");
  if (config.startingStack !== config.buyIn) throw new Error("Cash starting stack must equal the selected buy-in.");

  const id = `cash:${Date.now()}:${Math.floor(random.next() * 1_000_000)}`;
  const state: TournamentState = {
    id,
    status: "playing",
    config: clone(config),
    players: config.players.map((player) => ({ ...player, stack: config.buyIn, eliminated: false })),
    handNumber: 0,
    blindLevelIndex: 0,
    dealerSeat: null,
    hand: null,
    events: [],
    cashSession: {
      startedAt: Date.now(),
      ledgers: Object.fromEntries(config.players.map((player) => [player.id, { totalBuyIn: config.buyIn, rebuyCount: 0, potsWon: 0 }])),
    },
  };
  const started = makeEvent(state, "cash-game-started", {
    public: { playerCount: config.players.length, smallBlind: config.smallBlind, bigBlind: config.bigBlind, buyIn: config.buyIn },
    private: { config },
  });
  state.events.push(started);
  const hand = beginNextHand(state, random, fixedDeck);
  return { state: hand.state, events: [started, ...hand.events] };
};

export const rebuyCashPlayer = (source: TournamentState, playerId: string, amount?: number): EngineResult => {
  if (source.config.mode !== "cash" || !source.cashSession) throw new Error("This game is not a cash table.");
  if (source.status !== "playing") throw new Error("The cash table is not active.");
  if (source.hand && source.hand.phase !== "complete") throw new Error("重新买入只能在两手之间进行。");
  const player = source.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("找不到需要重新买入的玩家。");
  if (player.stack !== 0) throw new Error("只有筹码为零时才能重新买入。");
  const buyIn = amount ?? source.config.buyIn;
  if (!Number.isInteger(buyIn) || buyIn < source.config.minBuyIn || buyIn > source.config.maxBuyIn) throw new Error("重新买入金额超出牌桌限制。");
  const state = clone(source);
  const events: GameEvent[] = [];
  applyCashBuyIn(state, playerId, buyIn, events, false);
  addCheckpoint(state, events, "cash-player-rebought");
  appendEvents(state, events);
  return { state, events };
};

export const endCashGame = (source: TournamentState): EngineResult => {
  if (source.config.mode !== "cash" || !source.cashSession) throw new Error("This game is not a cash table.");
  if (source.status === "finished") throw new Error("The cash table has already ended.");
  if (source.hand && source.hand.phase !== "complete") throw new Error("请在本手结束后离桌。");
  const state = clone(source);
  state.status = "finished";
  state.cashSession!.endedAt = Date.now();
  const events: GameEvent[] = [makeEvent(state, "cash-game-ended", {
    public: {
      handsPlayed: state.handNumber,
      results: state.players.map((player) => ({
        playerId: player.id,
        stack: player.stack,
        totalBuyIn: state.cashSession!.ledgers[player.id]?.totalBuyIn ?? 0,
      })),
    },
  })];
  addCheckpoint(state, events, "cash-game-ended");
  appendEvents(state, events);
  return { state, events };
};

export const defaultBlindLevels = (speed: "slow" | "standard" | "fast" = "standard") => {
  const hands = speed === "slow" ? 12 : speed === "fast" ? 5 : 8;
  return [
    [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200],
    [150, 300], [250, 500], [400, 800], [600, 1200], [1000, 2000],
  ].map(([smallBlind, bigBlind]) => ({ smallBlind, bigBlind, hands }));
};

const changeGameStatus = (
  source: TournamentState,
  target: "playing" | "paused",
): EngineResult => {
  const expected = target === "paused" ? "playing" : "paused";
  if (source.status !== expected) throw new Error(target === "paused" ? "Game cannot be paused." : "Game cannot be resumed.");
  const state = clone(source);
  state.status = target;
  const events: GameEvent[] = [makeEvent(state, target === "paused" ? "game-paused" : "game-resumed", {
    public: { handNumber: state.handNumber, phase: state.hand?.phase ?? null },
  })];
  addCheckpoint(state, events, target === "paused" ? "game-paused" : "game-resumed");
  appendEvents(state, events);
  return { state, events };
};

export const pauseGame = (state: TournamentState): EngineResult => changeGameStatus(state, "paused");
export const resumeGame = (state: TournamentState): EngineResult => changeGameStatus(state, "playing");
/** @deprecated Use pauseGame. */
export const pauseTournament = pauseGame;
/** @deprecated Use resumeGame. */
export const resumeTournament = resumeGame;
