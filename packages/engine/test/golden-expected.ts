import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "fdd0da2cea1a01f5",
    "ticks": [
      "1:09225207d0b00d1a",
      "10:743ef079b0171f10",
      "100:f6e69f02aee4f08a",
      "1000:0fe4676a45485e2a",
      "10000:0b82317ae2c41685",
      "50000:6451a0002005ab9c",
      "100000:e2b38a97d025a107"
    ],
    "final": "89736bf2cb361c83",
    "score": "1-3",
    "events": 6312
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:44074fdf942f31e4",
      "10:6e76f789c8034c15",
      "100:09e8c06609874026",
      "1000:cae7685f4ca98463",
      "10000:83d920a6b0b710aa",
      "50000:6f8c3f012fc0ea99",
      "100000:6dea4ef748e3c59e"
    ],
    "final": "2b0a141ea2129617",
    "score": "5-2",
    "events": 6516
  },
  "123456": {
    "roster": "3958e1574a710fbc",
    "ticks": [
      "1:db5139ae22d6f337",
      "10:6124f6504c064c4a",
      "100:f9665990c77f9657",
      "1000:393722c8a768add5",
      "10000:eaa46691ce96f632",
      "50000:eb8a254d2b6f1567",
      "100000:80accacbf8f73283"
    ],
    "final": "18b324563f7876f0",
    "score": "0-1",
    "events": 6486
  }
};
