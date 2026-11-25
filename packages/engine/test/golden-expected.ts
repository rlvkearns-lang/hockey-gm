import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6e69f02aee4f08a",
      "1000:223cfa26a7e34f65",
      "10000:4b90276432429c46",
      "50000:e192d57d20ab6799",
      "100000:dc84d88469559b79"
    ],
    "final": "d59514e2a8a71cf9",
    "score": "2-2",
    "events": 6210
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:09e8c06609874026",
      "1000:5c2d97d6c2a916b8",
      "10000:3df3de2ac036dffa",
      "50000:9f646588e30fcdf3",
      "100000:00cd11fb21e739a5"
    ],
    "final": "ec641d8cd69c2ebe",
    "score": "3-3",
    "events": 6208
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:f9665990c77f9657",
      "1000:a3f20cf93093e2ee",
      "10000:ccb953082b5627cd",
      "50000:1ba4b53c28b4e561",
      "100000:7b5b1f88cf3bca1c"
    ],
    "final": "e13fb5720cf48371",
    "score": "4-1",
    "events": 6004
  }
};
