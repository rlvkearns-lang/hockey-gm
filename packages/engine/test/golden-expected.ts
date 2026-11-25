import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f9931efba17d5b78",
      "1000:7394ee0b21350221",
      "10000:5fa45a26e086ca78",
      "50000:27934362b72ee895",
      "100000:20a18d0999fecb07"
    ],
    "final": "ce77e0d14925a4ef",
    "score": "2-2",
    "events": 6299
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:d5f221d1b1b9363c",
      "10000:95a0b5cdf92a90ec",
      "50000:3e60ae57b75587dc",
      "100000:f0f81d29e565340e"
    ],
    "final": "9807203e14bbe15a",
    "score": "1-4",
    "events": 6361
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:f0408332d4e09f1e",
      "10000:c413df1334a730fc",
      "50000:345db19ac4e1a605",
      "100000:923f085cf856c049"
    ],
    "final": "c56d115ff6bce2dc",
    "score": "2-2",
    "events": 6203
  }
};
