import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:58d0748b814146a6",
      "10:5be3fbd629b54850",
      "100:4381cdfb4e2992f9",
      "1000:ff776a8b6cbb1945",
      "10000:92ec40cd498c6125",
      "50000:3d237792949bdcbb",
      "100000:2d3e68770425c8bb"
    ],
    "final": "8e4bff8894239de8",
    "score": "0-3",
    "events": 6151
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:ddabf1032e8d1286",
      "10:d36527b4f1119c6e",
      "100:77a8ad11eef652b3",
      "1000:7fc8f3e08dc9c0af",
      "10000:bf421f91e6596d39",
      "50000:8258afb09a92058c",
      "100000:a7d2a784a5d8c883"
    ],
    "final": "9bb60476d16b6de6",
    "score": "2-3",
    "events": 6308
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:aeaf66823bb2e8d7",
      "10:360b3350e838e8ed",
      "100:a440f034a48af8e5",
      "1000:323e55be328981b1",
      "10000:0f6a13cad117320f",
      "50000:63b0c874d34e4c44",
      "100000:a3070293a6ff8938"
    ],
    "final": "22613056988f5f91",
    "score": "3-1",
    "events": 5996
  }
};
