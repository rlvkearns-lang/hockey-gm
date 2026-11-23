import { generateTeam, type GameSetup } from '@hockey/engine';

/** The seed of the game the scene and playback tests share (recorded once per run by global-setup.ts). */
export const SHARED_SEED = 5;

export const testSetup = (seed: number): GameSetup => {
  const home = generateTeam(seed * 2 + 1, 'Harbour City', 'HBR');
  const away = generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK');
  return { home, away, seed, chemistry: [] };
};
