import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:640aeb777b9432c6",
      "10000:be478294579fdc1f",
      "50000:0afd18ac2568dc49",
      "100000:e2cdd692e128d656"
    ],
    "final": "2c25a0047b00c387",
    "score": "2-3",
    "events": 3540
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:fcb53f3093495251",
      "10000:747cb239d63c3471",
      "50000:4d6930ccbcc6b636",
      "100000:3722cafe19f501cf"
    ],
    "final": "963ac6612077f7fb",
    "score": "4-4",
    "events": 3741
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:2ef157439032622d",
      "10000:327f5abae0d9738a",
      "50000:922f8f6524396075",
      "100000:bda57ebd524b4654"
    ],
    "final": "f624fd3053e6c82d",
    "score": "2-5",
    "events": 3649
  }
};
