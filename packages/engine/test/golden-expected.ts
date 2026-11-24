import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:f4819d89fb485c0a",
      "10000:0fdc0d358c50baee",
      "50000:240379975d0ca9f7",
      "100000:8611278065cbb9c3"
    ],
    "final": "06ed100d9e8a2711",
    "score": "2-1",
    "events": 4460
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:243babec771a716e",
      "10000:54a93ab5bc4ec67a",
      "50000:2ddbcccdf8acb4d3",
      "100000:8a468c836c0c4fcc"
    ],
    "final": "df0a68571641b5a2",
    "score": "4-9",
    "events": 4610
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:c3105914a59f2554",
      "10000:907b71584cf8a378",
      "50000:9f8d5fb1071f7f98",
      "100000:f3ca46bd5b53122d"
    ],
    "final": "c8374d7e26e66328",
    "score": "2-1",
    "events": 4694
  }
};
