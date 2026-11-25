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
      "10000:e6ceabe90f595c93",
      "50000:aee732d965354c4f",
      "100000:ec29633b1f1750c1"
    ],
    "final": "cb77ba9d0471b377",
    "score": "2-4",
    "events": 6327
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:bf9b14e347a13c2f",
      "10:16044c89f5d68eb0",
      "100:1d6d99d54779be65",
      "1000:45067ad17a7d3fe2",
      "10000:87841b51e45513e9",
      "50000:077e440dacd4446d",
      "100000:bddf3854530c1101"
    ],
    "final": "530f498b2930ec8a",
    "score": "4-6",
    "events": 6242
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:67116462271f6988",
      "10:b5d6907882c5f47e",
      "100:a5c11e7b3754dbd4",
      "1000:433a249ed2945b28",
      "10000:59c7b65dfd095900",
      "50000:2370341a4107da3e",
      "100000:c4d506620316626d"
    ],
    "final": "9a7654924195018c",
    "score": "2-2",
    "events": 6240
  }
};
