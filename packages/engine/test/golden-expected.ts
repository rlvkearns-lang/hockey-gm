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
      "10000:82bfd1eefe621e27",
      "50000:85374b01ae844346",
      "100000:9c2c9cb347aea266"
    ],
    "final": "57317c72a3f95577",
    "score": "2-6",
    "events": 6349
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:d5f221d1b1b9363c",
      "10000:95a0b5cdf92a90ec",
      "50000:7f8c178b05a41599",
      "100000:c2fd0a1ce8ae9bac"
    ],
    "final": "256588b8358ec0e8",
    "score": "6-0",
    "events": 6308
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:f0408332d4e09f1e",
      "10000:07c57e3298c1d917",
      "50000:cfe8ebfb4bfd7aff",
      "100000:b2eadbedb71afac6"
    ],
    "final": "f9fb4361dda07619",
    "score": "1-4",
    "events": 5983
  }
};
