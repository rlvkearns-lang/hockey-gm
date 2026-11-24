import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "11df4b80fbc63f1c",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:0ad89558a24ad524",
      "10000:4591d0841f2f4fb0",
      "50000:04206cf6fd7e4f81",
      "100000:67677dd86aea1856"
    ],
    "final": "a12a40f446fa6af2",
    "score": "2-4",
    "events": 5828
  },
  "42": {
    "roster": "596f86b673f2244e",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:ceeebfb6302155bf",
      "10000:0bd0e58c60ec039f",
      "50000:c086f892fc0b40cc",
      "100000:05b8e059e77e893c"
    ],
    "final": "708c022094e2a98e",
    "score": "3-2",
    "events": 6322
  },
  "123456": {
    "roster": "5e3922be70d66a96",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:4a87ea93657d85fd",
      "10000:9014e976f6650ffd",
      "50000:c90297e427e4771f",
      "100000:24c0b7dff29d2389"
    ],
    "final": "1322ca163f06679e",
    "score": "5-4",
    "events": 6026
  }
};
