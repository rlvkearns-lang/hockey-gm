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
      "10000:99a517340b6759ab",
      "50000:d000fa0a5b7f5e64",
      "100000:1af5affcd96eaa70"
    ],
    "final": "7c617e79dc87d1f2",
    "score": "3-2",
    "events": 6651
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
    "final": "4a4e1757fce85135",
    "score": "4-4",
    "events": 6900
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:f9665990c77f9657",
      "1000:c40b07d0e50e045e",
      "10000:a9e0264c041333da",
      "50000:dfda3843b380d7f4",
      "100000:09ce7565b76c65ec"
    ],
    "final": "32ee3ce7db560a6c",
    "score": "0-1",
    "events": 6147
  }
};
