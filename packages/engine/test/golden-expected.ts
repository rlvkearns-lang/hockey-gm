import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:91615099c31440ae",
      "10000:02d687e8fdb398da",
      "50000:87033ba43acfa522",
      "100000:1bfec77cc86f2a28"
    ],
    "final": "016f72db74d505d4",
    "score": "4-3",
    "events": 4348
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:a72875ae17279ab6",
      "10000:07ff98547eb3c44e",
      "50000:ad0b9e8cd275640a",
      "100000:d0a53f44bdd4fdcc"
    ],
    "final": "1451340cc361f456",
    "score": "1-1",
    "events": 4617
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:cc0ac8ab3b02a00e",
      "10000:c9106a10951e2293",
      "50000:12b4e71baa69a31f",
      "100000:348da6ca4bedf12d"
    ],
    "final": "770527ecfa3be674",
    "score": "3-4",
    "events": 4384
  }
};
