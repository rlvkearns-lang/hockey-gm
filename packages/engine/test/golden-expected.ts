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
      "10000:300dddc0f726662a",
      "50000:0fd02da870c01ad1",
      "100000:1ba3fe56e9296477"
    ],
    "final": "1b3c256c847b93f8",
    "score": "2-1",
    "events": 4498
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:71c5fa5fee0cb71b",
      "10000:07adce633e4e4660",
      "50000:d80fb00e215c01f4",
      "100000:0a031e7f62c345ff"
    ],
    "final": "db3b45518584983d",
    "score": "3-2",
    "events": 4709
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:05185eeeb3abeeb5",
      "10000:d10fc8ef5ae84b4a",
      "50000:926aa44410f76ce5",
      "100000:1ee2c6b15db16f4a"
    ],
    "final": "4fdb9f5179183e98",
    "score": "2-3",
    "events": 4683
  }
};
