import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f9931efba17d5b78",
      "1000:7394ee0b21350221",
      "10000:5fa45a26e086ca78",
      "50000:f5008c9237415147",
      "100000:a7f79817ca21b34a"
    ],
    "final": "fb26286125b00a63",
    "score": "2-3",
    "events": 6295
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:54e163994632da86",
      "1000:a7a37671c940e909",
      "10000:c9bb6223f054e3ef",
      "50000:c9eceed0eb2a2a34",
      "100000:70e6ce55ee649426"
    ],
    "final": "72bd32261d952a48",
    "score": "3-4",
    "events": 6394
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:1228de6ed94ca85e",
      "1000:c0642efd55bd9104",
      "10000:0237517a1109569a",
      "50000:1b5aadd12f118e19",
      "100000:ed3453e2dc6c20c2"
    ],
    "final": "4cce10cb2ea10497",
    "score": "2-6",
    "events": 5792
  }
};
