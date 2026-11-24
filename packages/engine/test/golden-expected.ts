import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:0e105ebb8606a700",
      "10000:43792a568c5ec51b",
      "50000:8f01f2634e7e40f1",
      "100000:884452234223299a"
    ],
    "final": "7099c1e8f60beeac",
    "score": "2-6",
    "events": 4724
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:6a8508696a6e2fc5",
      "1000:d926a6926b91b7b7",
      "10000:541d84295500dde6",
      "50000:cdfc5895946c3bef",
      "100000:9efbf595942110f3"
    ],
    "final": "b35a58d2cc45e63f",
    "score": "5-7",
    "events": 4875
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:314a9dd47f94a0ee",
      "10000:d21cf30e1e9ae0ab",
      "50000:4bfc26cd060e745d",
      "100000:b87bbfc3eeab431a"
    ],
    "final": "0a2f5d9653fc05f4",
    "score": "2-2",
    "events": 4734
  }
};
