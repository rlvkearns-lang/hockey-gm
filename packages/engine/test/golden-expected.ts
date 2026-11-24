import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:d130b718f0188fb5",
      "1000:595d324f6d0a5db3",
      "10000:b71a81407244d1be",
      "50000:3e025620fd0f2008",
      "100000:64313bbafdb328df"
    ],
    "final": "fd95ea3a15dbbe7d",
    "score": "3-5",
    "events": 4984
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:937845d8299723a4",
      "1000:da21a7dc1d33a880",
      "10000:d9b0efc5b0365795",
      "50000:3bb4859516662848",
      "100000:d22f423419c64404"
    ],
    "final": "c77d8f0bfb4b9699",
    "score": "5-5",
    "events": 4881
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:2bbcb48780cf523c",
      "1000:a8a2320cef6efa7e",
      "10000:cd6eb02cf1408369",
      "50000:aaea010a307c2e6d",
      "100000:8951836e39ff6a55"
    ],
    "final": "4347845d5e7b7bad",
    "score": "4-0",
    "events": 4702
  }
};
