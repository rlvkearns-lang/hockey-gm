import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:f0a97cd13ae9587a",
      "10000:45c47c33f19263e7",
      "50000:cae4d658ee10b8bc",
      "100000:87caad980e81f37a"
    ],
    "final": "9cf777c98c373ffe",
    "score": "4-2",
    "events": 4619
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:243babec771a716e",
      "10000:4778ce2b054dc465",
      "50000:e46442cf8767d3d7",
      "100000:781f7c970a5ce10b"
    ],
    "final": "32203f233ec40ff9",
    "score": "1-3",
    "events": 4620
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:e28307b1e98552e9",
      "10000:b9fb0a4f02311e9e",
      "50000:149260befa35e4b5",
      "100000:3466a1c3ccb5e36e"
    ],
    "final": "df83d6d6d84c3f2a",
    "score": "4-5",
    "events": 4666
  }
};
