import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:cc9bb86001d3dadd",
      "10000:9a7634294d3b1023",
      "50000:d9e62fd32471f331",
      "100000:f36133bfaeaf8f36"
    ],
    "final": "3f0a68cb992f0a0b",
    "score": "1-4",
    "events": 4572
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:71c5fa5fee0cb71b",
      "10000:b4b50c408da0cb48",
      "50000:e66951a696191b58",
      "100000:8a868aad0723ea20"
    ],
    "final": "b21d10b9bf7b0b6e",
    "score": "1-3",
    "events": 4801
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:83b145daa8499c73",
      "10000:9e5c9b9d42337862",
      "50000:55cd7ba3cf802101",
      "100000:e7352a0c40c2ddad"
    ],
    "final": "143c35753357d33b",
    "score": "3-3",
    "events": 4620
  }
};
