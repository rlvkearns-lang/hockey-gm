import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6be4258a9ab65a3",
      "1000:ee6148137f2adbc1",
      "10000:4727c6313cee14b3",
      "50000:9b0d028a02bcb1ef",
      "100000:b8195c65019ad03a"
    ],
    "final": "4d643bbc35d7eb1a",
    "score": "2-3",
    "events": 6724
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:dda75f82adeb3c0e",
      "1000:bc70fbf2a560d569",
      "10000:19bb22a139f58ac4",
      "50000:66fdbaa0b7ec4c15",
      "100000:8e95899d1870b40e"
    ],
    "final": "9838ddc28538429b",
    "score": "4-4",
    "events": 6924
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:a739edd7d88e3884",
      "1000:1e2d676829b78637",
      "10000:ea53a8324060cd74",
      "50000:24ae8e909005bd0a",
      "100000:cc5ffa9e2434a627"
    ],
    "final": "d16aad7af0be9338",
    "score": "0-3",
    "events": 6331
  }
};
