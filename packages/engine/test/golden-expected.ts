import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:1ef625c86c73f4fb",
      "10000:733daa3b04d3bddb",
      "50000:01d856334c0a5c9d",
      "100000:a69065f76d284252"
    ],
    "final": "2e9b17157215efc0",
    "score": "4-2",
    "events": 4561
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:a72875ae17279ab6",
      "10000:939b8cb506b22245",
      "50000:7e9aa339e570aee5",
      "100000:8752989b65e25d7b"
    ],
    "final": "30ffa4ae406c3e40",
    "score": "2-4",
    "events": 4313
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:7fd243f6eebc3db6",
      "10000:e54e2786541900e7",
      "50000:e25d7021532c06f1",
      "100000:650858c0c5ba615d"
    ],
    "final": "46ced0b4b0931001",
    "score": "0-2",
    "events": 4397
  }
};
