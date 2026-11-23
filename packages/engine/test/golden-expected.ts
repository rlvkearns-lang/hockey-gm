import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "d4994bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:cf8dc3c5480d4fdc",
      "1000:138b549de26b88ac",
      "10000:87d4d009d295a32d",
      "50000:f86e6814eb6063a5",
      "100000:1515d76f6504ca79"
    ],
    "final": "903d9598dafa01f6",
    "score": "2-2",
    "events": 2088
  },
  "42": {
    "roster": "d65fc586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:7d1987700bacc898",
      "1000:a86e1890932b9486",
      "10000:6b8e7c5353ce7b83",
      "50000:4b8d015e761e4426",
      "100000:35d571c82fac26a0"
    ],
    "final": "0bd8851233669a4c",
    "score": "1-4",
    "events": 2083
  },
  "123456": {
    "roster": "a77eaa58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:d1a4fe15aea13fd2",
      "1000:ac9abe7ca6d64bef",
      "10000:4a41ee4fe116eb2c",
      "50000:fa346a1297feef5b",
      "100000:5dfcd34939fe5787"
    ],
    "final": "e09be20b99223a5e",
    "score": "3-0",
    "events": 2094
  }
};
