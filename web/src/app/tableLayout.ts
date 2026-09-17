const VISUAL_SEATS_BY_PLAYER_COUNT: Record<number, number[]> = {
  2: [0, 5],
  3: [0, 3, 6],
  4: [0, 2, 5, 7],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
  7: [0, 1, 3, 4, 5, 7, 8],
  8: [0, 1, 2, 3, 5, 6, 7, 8],
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

export const visualPlayersBySeat = <T extends { id: string; seat: number }>(
  players: T[],
  anchorPlayerId: string,
): Array<T | null> => {
  const sortedPlayers = [...players].sort((first, second) => first.seat - second.seat);
  const anchorIndex = sortedPlayers.findIndex((player) => player.id === anchorPlayerId);
  const anchoredPlayers = anchorIndex < 0
    ? sortedPlayers
    : [...sortedPlayers.slice(anchorIndex), ...sortedPlayers.slice(0, anchorIndex)];
  const visualSeats = VISUAL_SEATS_BY_PLAYER_COUNT[anchoredPlayers.length] ?? VISUAL_SEATS_BY_PLAYER_COUNT[9];
  const result: Array<T | null> = Array.from({ length: 9 }, () => null);
  anchoredPlayers.forEach((player, index) => { result[visualSeats[index]] = player; });
  return result;
};
