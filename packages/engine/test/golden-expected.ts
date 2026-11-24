import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:0e105ebb8606a700",
      "10000:4b2a07863f2e228d",
      "50000:a238d90a7f523db6",
      "100000:cab76d8d12b1460c"
    ],
    "final": "da17b8b4ccf1d655",
    "score": "1-2",
    "events": 4988
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:6a8508696a6e2fc5",
      "1000:b7efa9287138d6b2",
      "10000:0e191e9e311ebb62",
      "50000:5ef27d1fd58aa70b",
      "100000:0f15c241a6975d7b"
    ],
    "final": "11b7a3bee072ad4d",
    "score": "1-5",
    "events": 4707
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:35451c61becdbf63",
      "10000:7c8242c80467b3be",
      "50000:ad6eddabae7ca475",
      "100000:72263ddda8e272fe"
    ],
    "final": "e0ddb0d9cd32ed53",
    "score": "8-4",
    "events": 4925
  }
};
