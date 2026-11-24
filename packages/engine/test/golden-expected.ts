import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:c707a818de78dd7a",
      "1000:98b975d684665eb1",
      "10000:36734ff4b06b5cd0",
      "50000:ddccdb79d49079a1",
      "100000:467313d58fa8cca2"
    ],
    "final": "83cf28a41b65300f",
    "score": "3-2",
    "events": 4976
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:a5ad2c2de673f9bb",
      "1000:0cf1702433f88f8f",
      "10000:ca8d4802aa560221",
      "50000:d720d67563d73f7d",
      "100000:625947e604968f60"
    ],
    "final": "60da2eeb258c54c5",
    "score": "0-3",
    "events": 5025
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:0294a427044a7103",
      "1000:276b3dbf6e2b5399",
      "10000:6a35e97c475e2f7d",
      "50000:0040500d25965ec7",
      "100000:365b00ea1b2fa4bb"
    ],
    "final": "806e4da0ee47856c",
    "score": "4-3",
    "events": 5101
  }
};
