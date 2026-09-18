import type { Card } from "../domain/types";
import type { Scenario } from "../study/model";
import type { CaseDefinition, Course, Drill, Source } from "./model";

export const CONTENT_VERSION = "practice-2026.09.18-v1";
export const SOURCES: Source[] = [
  { id: "author", title: "Rivercraft 实战教学策略 v1", role: "authored", note: "本项目编排的简化教学策略；未由职业教练独立审校，不是求解器策略包。只评价本课计划的执行，不宣称唯一最优。" },
  { id: "cbet", title: "PokerStars Learn · Continuation Betting", url: "https://www.pokerstars.com/poker/learn/lesson/c-betting/", role: "concept", note: "用于查证持续下注的目的、牌面与尺度原则；没有导入其课程或将文章当作逐手精确答案。" },
  { id: "trainer", title: "GTO Wizard · How to use the Trainer", url: "https://help.gtowizard.com/how-to-use-the-trainer/", role: "method", note: "参考单点、单街、整手的训练组织。未使用其付费策略数据或题库。" },
  { id: "terminal", title: "终局跟注公式及逐组合枚举", role: "method", note: "只有两人河牌、跟注后立即摊牌时：EV(call)=equity×(当前底池+跟注成本)−跟注成本，EV(fold)=0。只比较跟注和弃牌，不给未计算的加注评分。" },
];
export const COURSES: Course[] = [
  { id: "A1", title: "翻牌前选择与范围", objective: "根据位置和前序行动，实际执行开池、防守与再加注。", foundations: ["opening", "position-range", "three-bet", "stack-depth"] },
  { id: "A2", title: "翻牌后的主动进攻", objective: "练习下注或过牌，比较不同牌面与尺度，而不是见到持续下注章节就每手下注。", foundations: ["value", "continuation", "sizing"] },
  { id: "A3", title: "面对下注的防守", objective: "在弃牌、跟注和加注之间决策，并在对手再次行动后更新计划。", foundations: ["pot-odds", "outs", "semi-bluff"] },
  { id: "A4", title: "转牌调整与多街计划", objective: "从翻牌或转牌出发，处理真实后续行动，完成一条连续路线。", foundations: ["multi-street", "equity", "sizing"] },
  { id: "A5", title: "河牌价值与抓诈", objective: "在明示范围下计算跟注和弃牌的收益；其他路线给教学反馈，不伪造 EV。", foundations: ["terminal-ev", "bluff", "mixed-strategy"] },
  { id: "A6", title: "对手适应与综合应用", objective: "在固定且公开的陪练模型下调整，并用无即时反馈的混合局面自测。", foundations: ["exploitation", "information", "outcome"] },
];
export const OPPONENTS = {
  balanced: { label: "均衡陪练", detail: "使用自己的可见牌力与底池成本选择动作；包含少量随机诈唬。是教学模型，不是均衡求解结果。" },
  caller: { label: "偏爱跟注", detail: "继续范围较宽、主动加注较少；仍可能弃牌。不要将这一倾向当成每手必跟。" },
  tight: { label: "偏紧陪练", detail: "对没有成手与听牌的高成本跟注更谨慎；不是无条件弃牌。" },
  pressure: { label: "主动施压", detail: "更多主动下注及半诈唬；面对反击仍按自己视角判断。" },
} as const;

// Seat order is UTG/HJ/CO/BTN/SB/BB. Prefixes, including folded seats, go through the production engine.
function sixMax(heroSeat: number, cards: [Card, Card], board: Card[], prefix: Scenario["prefix"], id: string): Scenario {
  const labels = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  return { version: 1, id, title: "六人桌 · 100BB · 无前注／无抽水", mode: "cash", seed: 42,
    smallBlind: 10, bigBlind: 20, dealerSeat: 3, heroId: "hero",
    players: labels.map((name, seat) => ({ id: seat === heroSeat ? "hero" : `v${seat}`, name: seat === heroSeat ? `你 · ${name}` : name, stack: 2000, ...(seat === heroSeat ? { cards } : {}) })),
    board, prefix, assumptions: "六人桌100BB，无前注、无抽水。对手在起点从展示的练习范围抽取，之后按固定教学策略行动；范围不是现实对手画像。" };
}
const act = (playerId: string, action: Scenario["prefix"][number]["action"]) => ({ playerId, action });
const fold = (playerId: string) => act(playerId, { type: "fold" });
const baseIP = () => [fold("v0"), fold("v1"), fold("v2"), act("hero", { type: "raise", to: 60 }), fold("v4"), act("v5", { type: "call" })];
const baseBB = () => [fold("v0"), fold("v1"), fold("v2"), act("v3", { type: "raise", to: 60 }), fold("v4"), act("hero", { type: "call" })];
export const DEFAULT_RANGE = "22+,A2s+,K9s+,Q9s+,J9s+,T9s,98s,87s,76s,ATo+,KJo+,QJo";
const STRONG_RANGE = "QQ+,AKs,AKo";
const ip = (cards: [Card, Card], board: Card[], street: "flop" | "turn" | "river", facing = false): Scenario => {
  const p = baseIP();
  if (street !== "flop") p.push(act("v5", { type: "check" }), act("hero", { type: "raise", to: 80 }), act("v5", { type: "call" }));
  if (street === "river") p.push(act("v5", { type: "check" }), act("hero", { type: "check" }));
  p.push(act("v5", facing ? { type: "raise", to: 140 } : { type: "check" }));
  return sixMax(3, cards, board, p, `${street}-${facing}`);
};
const bb = (cards: [Card, Card], board: Card[]): Scenario => sixMax(5, cards, board, [...baseBB(), act("hero", { type: "check" }), act("v3", { type: "raise", to: 80 })], "bb-facing-cbet");
const makeCase = (family: string, index: number, scenario: Scenario, goal: CaseDefinition["goal"], preferred: CaseDefinition["preferred"], explanation: string, range = DEFAULT_RANGE): CaseDefinition => ({ id: `${family}-${index}`, family: JSON.stringify({ cards: scenario.players.find(p => p.id === scenario.heroId)?.cards, board: scenario.board, prefix: scenario.prefix, heroSeat: scenario.players.findIndex(p => p.id === scenario.heroId), range }), scenario: { ...scenario, id: `${family}-${index}` }, goal, preferred, explanation, range });
const hands = (items: string[]): [Card, Card][] => items.map(s => s.split(" ") as [Card, Card]);
const openCases = (id: string, seat: number) => hands(["As Kh", "Qs Qd", "8s 7s", "7d 2c"]).map((h, i) => makeCase(id, i, sixMax(seat, h, [], Array.from({ length: seat }, (_, s) => fold(`v${s}`)), id), "open", i < 2 || (seat === 3 && i === 2) ? ["small"] : ["fold"], "本课采用明确的简化开池计划：前位保守，按钮位增加同花连接牌；尺度2.5–3BB。并非完整开池范围表。"));
const facingCases = (id: string, reraise: boolean) => hands(["As Ah", "Ks Qs", "8h 7h", "7c 2d"]).map((h, i) => {
  const prefix = reraise ? [...baseIP().slice(0, 5), act("v5", { type: "raise", to: 200 })] : [...baseBB().slice(0, 5)];
  return makeCase(id, i, sixMax(reraise ? 3 : 5, h, [], prefix, id), reraise ? "reraise" : "defend", i === 0 ? ["large"] : i === 3 || (reraise && i === 2) ? ["fold"] : ["call"], "按给定前序行动练习保留强牌、合理跟注和放弃边缘牌；这是一份教学计划，不是求解器完整防守范围。", reraise ? STRONG_RANGE : DEFAULT_RANGE);
});
const flopSets: Array<[[Card, Card], Card[], CaseDefinition["preferred"], string]> = [
  [["As", "Qd"], ["Ah", "7c", "2d"], ["small", "check"], "干燥牌面顶对可以小尺度取值；过牌也保留后续路线。不要只根据牌强就无限加大尺度。"],
  [["9s", "9h"], ["9d", "8c", "6c"], ["large"], "暗三条且存在连接／同花听牌，本课练习较大尺度价值下注，仍需应对后续危险牌。"],
  [["Ks", "Qd"], ["8h", "7h", "6c"], ["check"], "双高张在低连接牌面缺少直接权益，本课优先过牌；不是所有牌面都持续下注。"],
  [["As", "5s"], ["Kh", "9s", "2s"], ["small", "check"], "同花听牌可练习半诈唬或保留过牌范围；弃牌权益与成牌权益不能直接相加。"],
];
const flopCases = (id: string, offset = 0) => flopSets.map((_, i) => { const [h, b, p, text] = flopSets[(i + offset) % flopSets.length]; return makeCase(id, i, ip(h, b, "flop"), p.includes("large") ? "value" : p[0] === "check" ? "check" : "draw", p, text); });
const defenseCases = (id: string) => flopSets.map(([h, b], i) => makeCase(id, i, bb(h, b), "defend", i === 1 ? ["large", "call"] : i === 2 ? ["fold"] : ["call"], "面对明确的约六成底池下注，在强成手、边缘牌和听牌之间区分。此处跟注并不因摊牌权益够高就自动等于正EV。"));
const turnCases = (id: string) => [
  { h: "As Qd", b: "Ah 7c 2d 3s", p: ["small", "large"] as CaseDefinition["preferred"], why: "安全转牌保留价值目标，练习同时规划对手跟注后的河牌。" },
  { h: "Ks Qd", b: "Qh 9h 6c Ah", p: ["check"] as CaseDefinition["preferred"], why: "高张及第三张同花改变范围互动，不照搬翻牌计划。" },
  { h: "As 5s", b: "Kh 9s 2s 4d", p: ["small", "check"] as CaseDefinition["preferred"], why: "听牌未成但仍有改善路径，结合对手倾向练习继续半诈唬或过牌。" },
  { h: "9s 9h", b: "9d 8c 6c 8h", p: ["large"] as CaseDefinition["preferred"], why: "转牌组成葫芦，练习向较差继续牌取值；不是为了控制风险一律过牌。" },
].map((x, i) => makeCase(id, i, ip(x.h.split(" ") as [Card, Card], x.b.split(" ") as Card[], "turn"), "barrel", x.p, x.why));
const riverCases = (id: string, shove: boolean) => Array.from({ length: 4 }, (_, i) => {
  const s = ip(["Qs", "Qd"], ["Ah", "9c", "4d", "2s", "7h"], "river", !shove);
  if (shove) s.prefix[s.prefix.length - 1] = act("v5", { type: "all-in" });
  const bluff = [0.15, 0.75, 0.35, 0.6][i];
  const c = makeCase(id, i, s, "river-call", [], "本题范围就是当前河牌下注范围，逐组合计算权益。评分仅比较跟注和弃牌，不声称已评价所有加注。", `AsKd:${1 - bluff},JsTs:${bluff}`);
  c.terminal = true; return c;
});
const riverValueCases = (id: string) => [
  { h: "As Qd", b: "Ah 7c 2d 3s 8h", p: ["small", "check"] as CaseDefinition["preferred"] },
  { h: "9s 9h", b: "9d 8c 6c 8h 2s", p: ["large"] as CaseDefinition["preferred"] },
  { h: "Ks Qd", b: "8h 7h 6c Ah 2d", p: ["check"] as CaseDefinition["preferred"] },
  { h: "As 5s", b: "Kh 9s 2s 4d 7c", p: ["check", "small"] as CaseDefinition["preferred"] },
].map((x, i) => makeCase(id, i, ip(x.h.split(" ") as [Card, Card], x.b.split(" ") as Card[], "river"), "value", x.p, "在河牌区分取值、摊牌和诈唬；这里是教学计划，精确收益需要对手继续策略。"));

export const DRILLS: Drill[] = [];
function add(courseId: Course["id"], slug: string, title: string, cases: CaseDefinition[], scope: Drill["defaultScope"] = "spot", opponent: Drill["opponent"] = "balanced") {
  const course = COURSES.find(c => c.id === courseId)!;
  DRILLS.push({ id: slug, courseId, title, objective: course.objective, foundations: course.foundations, cases, defaultScope: scope, opponent, sourceIds: ["author", "trainer", ...(courseId === "A5" ? ["terminal"] : courseId === "A1" ? [] : ["cbet"])], });
}
add("A1", "ep-open", "前位开池选择", openCases("ep-open", 0));
add("A1", "btn-open", "按钮位开池与边缘牌", openCases("btn-open", 3));
add("A1", "bb-defense", "大盲面对按钮位开池", facingCases("bb-defense", false), "street");
add("A1", "face-3bet", "开池后面对再加注", facingCases("face-3bet", true), "street");
add("A2", "cbet-boards", "不同翻牌：下注还是过牌", flopCases("cbet-boards"));
add("A2", "value-sizing", "价值下注与尺度选择", flopCases("value-sizing", 1), "street");
add("A2", "check-back", "保留过牌路线", flopCases("check-back", 2), "street");
add("A2", "draw-pressure", "听牌与半诈唬路线", flopCases("draw-pressure", 3), "street");
add("A3", "face-cbet", "面对持续下注", defenseCases("face-cbet"));
add("A3", "defense-street", "防守后应对再次行动", defenseCases("defense-street"), "street");
add("A3", "raise-or-call", "强牌：跟注或反击", defenseCases("raise-or-call"), "street", "pressure");
add("A3", "defense-hand", "从防守打到河牌", defenseCases("defense-hand"), "hand");
add("A4", "turn-change", "转牌改变：重新选择", turnCases("turn-change"));
add("A4", "turn-plan", "转牌到河牌的计划", turnCases("turn-plan"), "hand");
add("A4", "flop-to-river", "从翻牌完成整条路线", flopCases("flop-to-river"), "hand");
add("A4", "pressure-response", "对手施压后的调整", turnCases("pressure-response"), "hand", "pressure");
add("A5", "river-price", "河牌抓诈：跟注成本", riverCases("river-price", false));
add("A5", "river-shove", "面对河牌全下", riverCases("river-shove", true));
add("A5", "river-value", "河牌取值与摊牌", riverValueCases("river-value"), "street", "caller");
add("A5", "river-tight", "面对偏紧对手的河牌", riverValueCases("river-tight"), "hand", "tight");
add("A6", "adapt-caller", "对跟注偏多的对手", flopCases("adapt-caller"), "hand", "caller");
add("A6", "adapt-tight", "对偏紧对手的路线", flopCases("adapt-tight", 2), "hand", "tight");
add("A6", "adapt-pressure", "对主动施压的对手", defenseCases("adapt-pressure"), "hand", "pressure");
add("A6", "mixed-hands", "无主题综合牌局", [...flopCases("mixed-hands"), ...turnCases("mixed-turn")], "hand");
export const findDrill = (id: string) => DRILLS.find(d => d.id === id);
export const findCase = (id: string) => DRILLS.flatMap(d => d.cases).find(c => c.id === id);
