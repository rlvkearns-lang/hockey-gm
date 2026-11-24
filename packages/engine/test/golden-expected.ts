import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:55f9ccf9b5e6ad8b",
      "10000:3f787a385e515a42",
      "50000:ff29d5e0d9e63130",
      "100000:32c774afd86eb2b1"
    ],
    "final": "8d325b4af2b07504",
    "score": "2-5",
    "events": 4564
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:0b2b5a05a42b3896",
      "1000:0261a55e9732db01",
      "10000:ed80792d693d4b9c",
      "50000:bbb66c7f909286e1",
      "100000:e8bf1ae97a0a925a"
    ],
    "final": "f798d623d72176fd",
    "score": "3-3",
    "events": 4628
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:77f37e9621bade13",
      "1000:4cf068ecf0589b35",
      "10000:aa64136dd0aae377",
      "50000:5e99111250d602c7",
      "100000:c1a8b592493d52fc"
    ],
    "final": "1d2393a8d27f8098",
    "score": "1-3",
    "events": 4610
  }
};
