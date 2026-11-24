import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:138b5f15170c414a",
      "10000:5d5b3254c0fc3b9b",
      "50000:3b721ccef002163a",
      "100000:a9ba8996a74749b9"
    ],
    "final": "1e903e3852955e04",
    "score": "2-4",
    "events": 4516
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:d522d2c3a90a826d",
      "10000:a5b132e264f71ad4",
      "50000:bab0a7edb71d9586",
      "100000:0d61b0e5b5be5f5d"
    ],
    "final": "12ed78b1e651edd1",
    "score": "4-2",
    "events": 4640
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:1404af2ea1e9891e",
      "10000:181f4ebeda1a5d2f",
      "50000:e843a354ad21561e",
      "100000:3e1520a0f4e2418b"
    ],
    "final": "97f03a8035068498",
    "score": "1-1",
    "events": 4587
  }
};
