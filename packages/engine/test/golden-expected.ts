import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6e69f02aee4f08a",
      "1000:c36ec6808fcde888",
      "10000:ed50d812e4cc4852",
      "50000:858d9f8192b87a65",
      "100000:235b53e2628e6a28"
    ],
    "final": "1ed95270bda00a3e",
    "score": "0-4",
    "events": 6508
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:09e8c06609874026",
      "1000:1735d3299e6f1256",
      "10000:bb81665b80496afd",
      "50000:1442475d85da7603",
      "100000:1374cd7fbfbfe213"
    ],
    "final": "7e29573f92b3406f",
    "score": "3-4",
    "events": 6800
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:f9665990c77f9657",
      "1000:8f0dcd3f1e040910",
      "10000:80c764f2e530d695",
      "50000:149b5768d811172f",
      "100000:e3eb965a623884b3"
    ],
    "final": "0e1d71cdbd0c4e6b",
    "score": "1-4",
    "events": 6436
  }
};
