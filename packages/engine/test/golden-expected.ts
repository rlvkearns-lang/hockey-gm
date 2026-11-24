import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "6d38378ef6dd910a",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:d2d3a37271796904",
      "10000:bccba8f61c4d6654",
      "50000:3801fd6b02f30102",
      "100000:5fe177b8890786fa"
    ],
    "final": "f33e3d27e95da931",
    "score": "2-7",
    "events": 5937
  },
  "42": {
    "roster": "e26abbfcee3434c8",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:ceeebfb6302155bf",
      "10000:c39cb33862584574",
      "50000:8c41d22c4f54cfa0",
      "100000:6adda2810988a3a4"
    ],
    "final": "2c0d19868fd22733",
    "score": "2-3",
    "events": 6010
  },
  "123456": {
    "roster": "f99d99e603d1ae95",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:9df4f08669f9b8f4",
      "10000:b545567d599abfdd",
      "50000:9e08f726e025db1a",
      "100000:0bd24d5982b540ff"
    ],
    "final": "91012c5d95b9c8b2",
    "score": "6-1",
    "events": 6018
  }
};
