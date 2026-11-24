import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:08eac4d5d2d7dbec",
      "10000:51a1f99f0fbacb8d",
      "50000:ce08f18c215ba102",
      "100000:358f3e4c8f5d3637"
    ],
    "final": "3142093219dcf6d5",
    "score": "5-4",
    "events": 4781
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:6a8508696a6e2fc5",
      "1000:6e3bf540c546deb0",
      "10000:cf3216ff1f32da00",
      "50000:e8652038fb9cea54",
      "100000:fa6f2f02566c0ec9"
    ],
    "final": "0a6cae92f1a62cec",
    "score": "4-5",
    "events": 4739
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:c29978bca1bcdab3",
      "10000:ca69b3571a625007",
      "50000:f54c6f0be1578ed6",
      "100000:6faea20d5c50decf"
    ],
    "final": "e0f6ad7f0a0938fa",
    "score": "3-1",
    "events": 4521
  }
};
