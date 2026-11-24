import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "11df4b80fbc63f1c",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:817bd092dc16ab87",
      "10000:d4c91d83c5d29d34",
      "50000:c1b1052d2482c410",
      "100000:e58271ff83c54458"
    ],
    "final": "3d6b0bd883eb7ad7",
    "score": "2-0",
    "events": 5792
  },
  "42": {
    "roster": "596f86b673f2244e",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:16b0e5af1b7e1034",
      "10000:423a358825dafd08",
      "50000:b87f755d219fd991",
      "100000:2682818fcdc12892"
    ],
    "final": "d996237f1959eda6",
    "score": "9-8",
    "events": 6325
  },
  "123456": {
    "roster": "5e3922be70d66a96",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:4a87ea93657d85fd",
      "10000:ad95c5f4a9647d1e",
      "50000:51466c022dbac1fe",
      "100000:33c4ae89e0ba8636"
    ],
    "final": "f7a75aa08c59bce0",
    "score": "3-3",
    "events": 5906
  }
};
