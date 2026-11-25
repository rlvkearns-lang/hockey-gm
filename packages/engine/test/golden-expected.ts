import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f9931efba17d5b78",
      "1000:df1270a9d27453ea",
      "10000:52e34c56dc5c6393",
      "50000:553b6792a9a48751",
      "100000:1a0d0b88b0a7552e"
    ],
    "final": "cd1b435613df3cd5",
    "score": "1-6",
    "events": 6335
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:1684367cfcbc37e9",
      "10000:5766a78f46c046ec",
      "50000:5bed6b54c787f1f7",
      "100000:f39963ef4c71cd39"
    ],
    "final": "d0f6c557e0e9cf1b",
    "score": "7-3",
    "events": 6480
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:60c156015ca35897",
      "10000:7e4f1c08551936fd",
      "50000:cc8be77387577284",
      "100000:76e22ba6e654e1a4"
    ],
    "final": "705dee532f39edc8",
    "score": "1-8",
    "events": 5964
  }
};
