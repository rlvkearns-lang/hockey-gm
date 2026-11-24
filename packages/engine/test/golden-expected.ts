import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:67c726928a322ea3",
      "10000:e08be9719e4cc4f5",
      "50000:1d553f67fba03428",
      "100000:3393eae942a43ff8"
    ],
    "final": "0a51c5ec13b16ca1",
    "score": "0-1",
    "events": 4594
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:da83d7141a4e27a8",
      "1000:7258d0a62184f0b7",
      "10000:2cb8abe9d33d285f",
      "50000:8caa5a3b2bff590a",
      "100000:6f012ff562db33c5"
    ],
    "final": "5dcd72b495e3e03b",
    "score": "4-2",
    "events": 4656
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:e92e52e706153cef",
      "10000:1adf7aa9df00fc4e",
      "50000:364fa32203186692",
      "100000:18c5769161847dd1"
    ],
    "final": "b277375371cc5539",
    "score": "3-4",
    "events": 4556
  }
};
