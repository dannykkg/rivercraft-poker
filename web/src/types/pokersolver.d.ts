declare module "pokersolver" {
  export class Hand {
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    rank: number;
    cards: Array<{ value: string; suit: string }>;
  }
}
