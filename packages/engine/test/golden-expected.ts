import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6be4258a9ab65a3",
      "1000:fe74be47b47df9e0",
      "10000:ec94563ad22d52e6",
      "50000:57531f6e30091760",
      "100000:49083d2ed17de612"
    ],
    "final": "2684ed43d20ad80e",
    "score": "5-5",
    "events": 6594
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:dda75f82adeb3c0e",
      "1000:eee2c147f0d5536d",
      "10000:3833721591928b27",
      "50000:4b5934108e3ded7b",
      "100000:1310cf6556ad216b"
    ],
    "final": "455724f631bbe136",
    "score": "2-5",
    "events": 6831
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:a739edd7d88e3884",
      "1000:e6167b63a2f4c091",
      "10000:07d2802cb8a210f4",
      "50000:33a75acc4e996bec",
      "100000:f9cac2f8956edc76"
    ],
    "final": "53cb952d6c0997e1",
    "score": "0-2",
    "events": 6288
  }
};
