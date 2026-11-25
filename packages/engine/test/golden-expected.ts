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
      "10000:97d38114283061cc",
      "50000:a23c80bec19cef7a",
      "100000:093a77a027db41ad"
    ],
    "final": "5ce95160533526f8",
    "score": "3-3",
    "events": 6138
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:d5f221d1b1b9363c",
      "10000:95a0b5cdf92a90ec",
      "50000:9d7454e7d5befa2c",
      "100000:f162b6efaee14cfa"
    ],
    "final": "f2eeb8bb7e8ce4d7",
    "score": "6-1",
    "events": 6606
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:f0408332d4e09f1e",
      "10000:6648930d6bf4e2f6",
      "50000:4ce935420321b0f1",
      "100000:69f963a502549cab"
    ],
    "final": "198db099ff0398bd",
    "score": "1-3",
    "events": 5895
  }
};
