import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6be4258a9ab65a3",
      "1000:ee6148137f2adbc1",
      "10000:266cf488dd625642",
      "50000:69767feec73ba4f1",
      "100000:63841fb10dee44fa"
    ],
    "final": "9545b9756762b65e",
    "score": "3-4",
    "events": 6544
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:dda75f82adeb3c0e",
      "1000:bc70fbf2a560d569",
      "10000:19bb22a139f58ac4",
      "50000:f93babdc4448d83d",
      "100000:b12649af85d5ee48"
    ],
    "final": "7c2f5b6deb762299",
    "score": "6-4",
    "events": 7040
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:a739edd7d88e3884",
      "1000:1e2d676829b78637",
      "10000:ea53a8324060cd74",
      "50000:c08a05d49d315982",
      "100000:bc5581ddd847a283"
    ],
    "final": "83f3c01fc80a1c3e",
    "score": "0-5",
    "events": 6326
  }
};
