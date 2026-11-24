import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:5efc2474c2679cf9",
      "1000:74be4778b4bb508f",
      "10000:47fcb5cf4136b29f",
      "50000:795603bdb352eda6",
      "100000:4a710b24a36d9e5f"
    ],
    "final": "0a50bc5bfb28780d",
    "score": "2-2",
    "events": 5106
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de8a3f9b76e8c0b7",
      "1000:f1998e419c63f269",
      "10000:1ff55ec6793c6113",
      "50000:703a9f44b1369c80",
      "100000:40efc3540e1e7a25"
    ],
    "final": "d1a75298c914b021",
    "score": "2-2",
    "events": 4973
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:064957272934267f",
      "1000:6d97429bec96e25c",
      "10000:513de260661f2da4",
      "50000:5c8075846f35cc53",
      "100000:2aab57c00e4532f6"
    ],
    "final": "dc6cc64f8ff7d378",
    "score": "2-2",
    "events": 5061
  }
};
