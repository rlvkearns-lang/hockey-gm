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
      "10000:432aa523f37fd2ce",
      "50000:a0b96423c19de785",
      "100000:2935ecd4946e1c2c"
    ],
    "final": "4916b0ede745b67e",
    "score": "1-2",
    "events": 5995
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:d5f221d1b1b9363c",
      "10000:f55c724ba3b3d9ee",
      "50000:74187a6ea8849607",
      "100000:26f333986f6195d9"
    ],
    "final": "40347e7935c528e6",
    "score": "7-5",
    "events": 6475
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:f0408332d4e09f1e",
      "10000:221c0dd0bf2f9155",
      "50000:59a0e262bc6ad820",
      "100000:3c19a5d58473eda7"
    ],
    "final": "65d5a03f817e9160",
    "score": "1-5",
    "events": 6289
  }
};
