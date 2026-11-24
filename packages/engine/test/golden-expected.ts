import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:6123343c26bb8fb5",
      "10000:7244ab47b6e9d810",
      "50000:f0341a5fe662c651",
      "100000:b30bad16233b09a4"
    ],
    "final": "07f49b490bdd3747",
    "score": "1-6",
    "events": 4531
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:6cca9f12122c249b",
      "10000:d09c2a8437a7ac23",
      "50000:ab83c4aac1060a7b",
      "100000:71b8a8830658be8a"
    ],
    "final": "e66affe3c68101e8",
    "score": "3-2",
    "events": 3885
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:ca1d8adc2b446c37",
      "10000:ff7ee5ae53ef3cfa",
      "50000:5dfdbffa96ee1bb1",
      "100000:c3d60e85bd421761"
    ],
    "final": "69421946dc18d08b",
    "score": "3-5",
    "events": 4553
  }
};
