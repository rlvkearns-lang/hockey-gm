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
      "100000:eb55927a1ed24ac5"
    ],
    "final": "72a455fecc2fd396",
    "score": "3-3",
    "events": 4382
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:a72875ae17279ab6",
      "10000:0141b9ef36591eb5",
      "50000:f5f968f472d160cd",
      "100000:aff6f0a60fbe0c77"
    ],
    "final": "586a20ad80d2beb9",
    "score": "1-2",
    "events": 4276
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:cc0ac8ab3b02a00e",
      "10000:98b44d82ef5c60c0",
      "50000:11147ea33c843fd0",
      "100000:b6148c9b069e8970"
    ],
    "final": "71947fca694a4bf2",
    "score": "6-2",
    "events": 4481
  }
};
