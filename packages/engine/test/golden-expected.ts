import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:552f82abbb63903d",
      "10:76f6e3b9036af162",
      "100:2c6ae8e00cfc7578",
      "1000:2fe12075e022aaf9",
      "10000:14f715cf99db9d22",
      "50000:50283278a1bb1de0",
      "100000:60361c31ffb30de8"
    ],
    "final": "aa1ffa45c664e4ee",
    "score": "1-0",
    "events": 6044
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:bf9b14e347a13c2f",
      "10:16044c89f5d68eb0",
      "100:1d6d99d54779be65",
      "1000:c8585a05e931c98c",
      "10000:fc0ab7f9dfdd68f3",
      "50000:cd60f2cd9ffc13d6",
      "100000:39e0dc5cfa88de17"
    ],
    "final": "358eb26588c41f17",
    "score": "2-3",
    "events": 6343
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:67116462271f6988",
      "10:b5d6907882c5f47e",
      "100:a5c11e7b3754dbd4",
      "1000:74bd68fad085524d",
      "10000:749352e5faf6aa71",
      "50000:334f6ad08e9f1c14",
      "100000:4341910bb68d2e5b"
    ],
    "final": "29ff445b2f3e595c",
    "score": "0-1",
    "events": 5971
  }
};
