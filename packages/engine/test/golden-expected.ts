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
      "10000:679a806193b631af",
      "50000:1b50531bd3153dd4",
      "100000:f23f3d6c6ccc34b9"
    ],
    "final": "1b92b23d3b0484e4",
    "score": "2-2",
    "events": 6122
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:1684367cfcbc37e9",
      "10000:1ba5d35f818dd492",
      "50000:40e0f3a752549900",
      "100000:b7162387499defb0"
    ],
    "final": "62e4adfe85fbeec2",
    "score": "3-2",
    "events": 6499
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:60c156015ca35897",
      "10000:7e4f1c08551936fd",
      "50000:01128af1e523cf0b",
      "100000:4235699df55b94de"
    ],
    "final": "8500dde869100857",
    "score": "0-1",
    "events": 6025
  }
};
