import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "d4994bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:f915d644283c5606",
      "1000:ae5f3a674f5b2a7c",
      "10000:aa5ec0bf1f7859d3",
      "50000:47e82b705137befc",
      "100000:932933b032855c22"
    ],
    "final": "35d03f0c2271104a",
    "score": "2-2",
    "events": 2105
  },
  "42": {
    "roster": "d65fc586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:33c3dbd34f37f609",
      "1000:05446499986aae43",
      "10000:024fbd28323b848c",
      "50000:97f16c24fd5f73af",
      "100000:819d389c08653d04"
    ],
    "final": "03419041c1de6ee4",
    "score": "4-1",
    "events": 2143
  },
  "123456": {
    "roster": "a77eaa58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:cbdfe0c2a8190c95",
      "1000:01ba544a83140f1f",
      "10000:572fa204106a65fa",
      "50000:8a8bc7aab0d9f9e0",
      "100000:46b57aa2a52672b5"
    ],
    "final": "2c26b5d4cf6dfdda",
    "score": "4-1",
    "events": 2043
  }
};
