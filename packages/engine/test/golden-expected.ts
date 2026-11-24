import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:5efc2474c2679cf9",
      "1000:2f1ac385248ca595",
      "10000:f9ac5892df02fe25",
      "50000:45b330c6cacaa90d",
      "100000:aef77725fdc9d63e"
    ],
    "final": "408f0858f60fb18f",
    "score": "0-2",
    "events": 4803
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de8a3f9b76e8c0b7",
      "1000:a7ba43607ff69811",
      "10000:0f401a30c93732f0",
      "50000:833b6e99fc5158ad",
      "100000:fd0e01452e7cb467"
    ],
    "final": "a83b372c47406cf8",
    "score": "5-3",
    "events": 5042
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:064957272934267f",
      "1000:1be91eb05fd20b7b",
      "10000:eecef9ab43f7f982",
      "50000:a2cedfefc000104e",
      "100000:a767eb02872b0749"
    ],
    "final": "859923ee7e863cf1",
    "score": "1-1",
    "events": 4977
  }
};
