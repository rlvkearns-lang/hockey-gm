import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6e69f02aee4f08a",
      "1000:edba51042c322943",
      "10000:d0e98cbd55465f13",
      "50000:4f8fc357af6e52fb",
      "100000:b94c10c172f49a3d"
    ],
    "final": "2dc480060919f75b",
    "score": "0-1",
    "events": 6476
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:09e8c06609874026",
      "1000:d604ca9765034aaa",
      "10000:117f5194b4f9c419",
      "50000:6aa88581eab85b0a",
      "100000:a88f13a0f4d17602"
    ],
    "final": "804b6807e2f2ae21",
    "score": "1-4",
    "events": 6571
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:f9665990c77f9657",
      "1000:a3c062669273cf36",
      "10000:b9289cdbb3bdea3a",
      "50000:f74f7a525fa3ba63",
      "100000:5e8800066b4a074d"
    ],
    "final": "8f1439ba4020558f",
    "score": "1-3",
    "events": 6207
  }
};
