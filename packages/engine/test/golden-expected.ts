import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:863687adc18d4ba0",
      "1000:f58512715fcbda6d",
      "10000:acdac489dcc58798",
      "50000:a64b41a7e6d58331",
      "100000:14c197a7fde88997"
    ],
    "final": "f77191384dc16930",
    "score": "1-1",
    "events": 5018
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:33c3dbd34f37f609",
      "1000:90151a158be91816",
      "10000:90eb12de2119a3b1",
      "50000:fa6a2659296de893",
      "100000:7361cbc4c2104203"
    ],
    "final": "e1e8b6b88033bff9",
    "score": "2-3",
    "events": 5066
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:70a939cd4b7cc88c",
      "1000:bfbf519fc907132b",
      "10000:7fd3cc71f4ecd847",
      "50000:a1d09195ae3b63b1",
      "100000:f905b935d348d727"
    ],
    "final": "43a00be9c947bc9d",
    "score": "1-0",
    "events": 5215
  }
};
