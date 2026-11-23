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
      "50000:8e127538930c79a5",
      "100000:1d7180e568e383f5"
    ],
    "final": "821a6854cb24a6d0",
    "score": "3-0",
    "events": 2122
  },
  "42": {
    "roster": "d65fc586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:33c3dbd34f37f609",
      "1000:05446499986aae43",
      "10000:024fbd28323b848c",
      "50000:6de05bb99cc2fdc8",
      "100000:1eb8fb7cd3fcbc57"
    ],
    "final": "b7355ffe53d8c49d",
    "score": "2-4",
    "events": 2103
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
    "final": "7eea6a6e1b88ea68",
    "score": "4-1",
    "events": 2009
  }
};
