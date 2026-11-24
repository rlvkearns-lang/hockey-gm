import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:bc86e5c9d34009b9",
      "10000:6bae84b0807ec051",
      "50000:1c48d4de07d2dc45",
      "100000:9cd9f91dad97de38"
    ],
    "final": "4dc24e3fba81f427",
    "score": "3-3",
    "events": 4345
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:959595c2b3f2d63f",
      "10000:2dbb8d951ad7c14f",
      "50000:e1496781b06308b8",
      "100000:541bb46c5729dfd0"
    ],
    "final": "8ebca21fe75c3abf",
    "score": "2-2",
    "events": 4435
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:6c6dd405a1401548",
      "10000:26c08e7f1c121036",
      "50000:44f7983fcfdb93dd",
      "100000:32b67ae7eca73473"
    ],
    "final": "3c9bb8cd49bfb5d5",
    "score": "3-2",
    "events": 4485
  }
};
