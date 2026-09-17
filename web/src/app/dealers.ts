export const DEALERS = [
  { id: "luna", name: "Luna", voiceGender: "female" },
  { id: "kai", name: "Kai", voiceGender: "male" },
  { id: "mira", name: "Mira", voiceGender: "female" },
] as const;

export type DealerId = (typeof DEALERS)[number]["id"];

export const dealerById = (dealerId: DealerId) =>
  DEALERS.find((dealer) => dealer.id === dealerId) ?? DEALERS[0];

export const nextDealerId = (dealerId: DealerId, direction: -1 | 1): DealerId => {
  const index = DEALERS.findIndex((dealer) => dealer.id === dealerId);
  return DEALERS[(index + direction + DEALERS.length) % DEALERS.length].id;
};
