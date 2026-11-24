import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:87e83d4726f5bc8c",
      "10000:f19a35c11bd1a17e",
      "50000:d793889fe939028a",
      "100000:74d0dcaa56ae1cd6"
    ],
    "final": "059e468d88bfbcd6",
    "score": "1-4",
    "events": 4536
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:da83d7141a4e27a8",
      "1000:bf533b1d1e0026ce",
      "10000:f60aa508793e80ef",
      "50000:52411bed6ba2866d",
      "100000:c335999e195b06c4"
    ],
    "final": "f40b3290a6df956e",
    "score": "3-3",
    "events": 4595
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:cab9596466289e2e",
      "10000:89fa22cec1418c36",
      "50000:1a4d916a8da34140",
      "100000:20b8cf1b324ad98a"
    ],
    "final": "9e7a6df541c67ce3",
    "score": "3-2",
    "events": 4403
  }
};
