import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:00eaf8a27eb6aeb6",
      "1000:0e69d6525ef8cf07",
      "10000:cfc8bd6618d1964f",
      "50000:1777464116e0ee05",
      "100000:95276dc770b483c7"
    ],
    "final": "07cf10bb32ec1d23",
    "score": "2-1",
    "events": 6026
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:754655060905cf3a",
      "1000:1eaced3e84596fdd",
      "10000:54c731e23cfcc546",
      "50000:22ad996d0b365201",
      "100000:7931d48a94ab7273"
    ],
    "final": "bea3fb095a1ade76",
    "score": "1-2",
    "events": 6066
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:4c0f573c5f50ce98",
      "1000:df19783c147206bf",
      "10000:3744963223a443ca",
      "50000:e06f917079cfb3dd",
      "100000:669a5221f2606eec"
    ],
    "final": "0179fc8db5b7d7ca",
    "score": "0-7",
    "events": 6082
  }
};
