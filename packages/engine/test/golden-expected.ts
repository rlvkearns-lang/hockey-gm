import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:5c6f7dfcefc6c2e4",
      "10000:3faa54d346064622",
      "50000:e574e7933a0a78de",
      "100000:64b75bf27f29caa6"
    ],
    "final": "627ca4fa0e306ac3",
    "score": "3-3",
    "events": 4403
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:a72875aeedfc5e5b",
      "10000:05058cb6826d8032",
      "50000:1f99fa80ed9c05c7",
      "100000:b5a821ae8e1e5619"
    ],
    "final": "c6414d0ec87a0451",
    "score": "5-4",
    "events": 4531
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:186adaf43f712b47",
      "10000:f261f4f529215df1",
      "50000:d77d9c3054a5cb85",
      "100000:d070b3f93ef19d29"
    ],
    "final": "508b18ae5a0cc44a",
    "score": "2-0",
    "events": 4488
  }
};
