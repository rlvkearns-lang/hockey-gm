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
      "10000:a464d4ab51469e89",
      "50000:221fa29cba2eacbd",
      "100000:aeb4dcbc42134e8f"
    ],
    "final": "fa2821de37751404",
    "score": "3-2",
    "events": 4459
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:d522d2c3a90a826d",
      "10000:cb8f2cfa8e826bde",
      "50000:8f945f5998ffa960",
      "100000:2a082e503cadc980"
    ],
    "final": "8f358049e3e0791a",
    "score": "3-1",
    "events": 4583
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:1404af2ea1e9891e",
      "10000:47c655a520540e55",
      "50000:efc750a0b27dd563",
      "100000:961066aad5e04482"
    ],
    "final": "142ec49c71ec82af",
    "score": "3-1",
    "events": 4640
  }
};
