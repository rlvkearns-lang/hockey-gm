import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "11df4b80fbc63f1c",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:d2d3a37271796904",
      "10000:bccba8f61c4d6654",
      "50000:8e1c2989dbe3dbe3",
      "100000:691a9946a20c3dc3"
    ],
    "final": "879680eccce30832",
    "score": "2-5",
    "events": 5914
  },
  "42": {
    "roster": "596f86b673f2244e",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:ceeebfb6302155bf",
      "10000:8d6409d7bc6e2d57",
      "50000:9d22a5862d9a6a8a",
      "100000:b1cacc46a82d5638"
    ],
    "final": "6d8402083e590387",
    "score": "4-3",
    "events": 6216
  },
  "123456": {
    "roster": "5e3922be70d66a96",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:8b4a6c77a6824095",
      "10000:0b1370da2a9110f4",
      "50000:b170f53530c7413e",
      "100000:7b3beb46ae207639"
    ],
    "final": "db32e8a41b9686f8",
    "score": "3-2",
    "events": 6443
  }
};
