export const DEALERS = [
  { id: "luna", name: "Luna", voiceGender: "female", image: "assets/dealers/luna-3d-v2.webp", framing: "full" },
  { id: "kai", name: "Kai", voiceGender: "male", image: "assets/dealers/kai-3d-v2.webp", framing: "full" },
  { id: "mira", name: "Mira", voiceGender: "female", image: "assets/dealers/mira-3d-v2.webp", framing: "full" },
  { id: "mio", name: "Mio", voiceGender: "female", image: "assets/dealers/mio-cat-dealer-v1.webp", framing: "full" },
  { id: "mio-2", name: "Mio 2", voiceGender: "female", image: "assets/dealers/mio-2-tabletop-v1.webp", framing: "tabletop" },
] as const;

export type DealerId = (typeof DEALERS)[number]["id"];

export const dealerById = (dealerId: DealerId) =>
  DEALERS.find((dealer) => dealer.id === dealerId) ?? DEALERS[0];

export const nextDealerId = (dealerId: DealerId, direction: -1 | 1): DealerId => {
  const index = DEALERS.findIndex((dealer) => dealer.id === dealerId);
  return DEALERS[(index + direction + DEALERS.length) % DEALERS.length].id;
};
