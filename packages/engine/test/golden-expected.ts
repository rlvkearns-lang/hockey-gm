import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:cc9bb86001d3dadd",
      "10000:300dddc0f726662a",
      "50000:476db703893b7ee4",
      "100000:92a8a0e42c31f19e"
    ],
    "final": "7f829bd796410955",
    "score": "2-7",
    "events": 4631
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:71c5fa5fee0cb71b",
      "10000:4382b4db6a1299c7",
      "50000:2b827af742b39f17",
      "100000:4a5729b1eae0bae1"
    ],
    "final": "63099e9a47955422",
    "score": "5-3",
    "events": 4569
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:05185eeeb3abeeb5",
      "10000:451d7b3241480910",
      "50000:586de27b116b5e6e",
      "100000:e22354f15b21cc76"
    ],
    "final": "c57e076a7a680e65",
    "score": "4-5",
    "events": 4521
  }
};
