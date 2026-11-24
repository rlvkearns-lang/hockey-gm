import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:c1735fe58c455e76",
      "10000:85ed6e184969cf1f",
      "50000:6a3f15cc89a43b23",
      "100000:ba8f213a3ec0c5c2"
    ],
    "final": "38431ba142996b8d",
    "score": "4-7",
    "events": 4023
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:66becdd6a28d139b",
      "1000:1c4fd45b36d96c36",
      "10000:1b572df949befbfc",
      "50000:c665e40c61abb1c0",
      "100000:1644812ee2ce5456"
    ],
    "final": "d88ab7a53d3a7baf",
    "score": "1-3",
    "events": 4023
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:7f023fc0b52f7c40",
      "10000:3e1281c6c332104c",
      "50000:68be53bbd8d94656",
      "100000:1e0373d07917f328"
    ],
    "final": "4c839de1edf95410",
    "score": "5-3",
    "events": 4164
  }
};
