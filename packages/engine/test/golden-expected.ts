import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:67c726928a322ea3",
      "10000:8a18f4b670fe8758",
      "50000:57b62b6e4df3db46",
      "100000:0a35a0fed0bece01"
    ],
    "final": "192869334f7b9365",
    "score": "4-2",
    "events": 4739
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:da83d7141a4e27a8",
      "1000:7258d0a62184f0b7",
      "10000:46197a17008f2d62",
      "50000:d568925f2f43213f",
      "100000:b59b9ec10c23d2ee"
    ],
    "final": "e58872c236671054",
    "score": "3-4",
    "events": 4580
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:e92e52e706153cef",
      "10000:1cae33dd5c415420",
      "50000:ea76320377716370",
      "100000:07eec379bd75a737"
    ],
    "final": "95895ad1314976b9",
    "score": "3-2",
    "events": 4724
  }
};
