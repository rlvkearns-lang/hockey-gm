import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f9931efba17d5b78",
      "1000:b24e829afbfc3c91",
      "10000:98d0bb9b69d97583",
      "50000:8ad2b671343fa5aa",
      "100000:287022cfbddb7536"
    ],
    "final": "64358ae80aa6b16f",
    "score": "2-4",
    "events": 6350
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:f3d2b8ccaa48112c",
      "10000:81eacc8bc4c1737d",
      "50000:cda5b97b50261f07",
      "100000:e9fb63cc180f794b"
    ],
    "final": "754fe9ff854aba99",
    "score": "5-5",
    "events": 6463
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:fcfd72e7b2b8079a",
      "10000:72d18f4880f1f78c",
      "50000:e9a482373df1a09a",
      "100000:d446203afa425af6"
    ],
    "final": "041096e21c7ef89d",
    "score": "4-6",
    "events": 6124
  }
};
