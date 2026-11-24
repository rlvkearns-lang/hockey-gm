import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:5c6f7dfcefc6c2e4",
      "10000:d90d645ec191cd60",
      "50000:771f9dc162251414",
      "100000:3308fefc13702215"
    ],
    "final": "36ae687c232a3596",
    "score": "2-1",
    "events": 4291
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:a72875aeedfc5e5b",
      "10000:55525c4371e7b354",
      "50000:5a75d580791c54c1",
      "100000:1783e6ba62f858d9"
    ],
    "final": "3b9829a1f39fc49c",
    "score": "5-3",
    "events": 4648
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:186adaf43f712b47",
      "10000:40ea6be8a540e820",
      "50000:72ed8d0632ffb5a7",
      "100000:e72806ac27fe99d7"
    ],
    "final": "c09df35935ca6d03",
    "score": "5-2",
    "events": 4501
  }
};
