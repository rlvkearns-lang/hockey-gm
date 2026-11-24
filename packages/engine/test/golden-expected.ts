import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:8b8982210d5c391a",
      "10000:da63ed996195c964",
      "50000:ad4b2d6dabd18184",
      "100000:23b76561d5515931"
    ],
    "final": "b7a4fe03c791975e",
    "score": "2-0",
    "events": 4488
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:da83d7141a4e27a8",
      "1000:52bb206a583a1ef9",
      "10000:ce922d05ff1119f8",
      "50000:d750d9bf244de6f9",
      "100000:1fd49eb823a125ba"
    ],
    "final": "63e19e38ad8bfa03",
    "score": "4-3",
    "events": 4695
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:cab9596466289e2e",
      "10000:9087fbadba8d3387",
      "50000:42b3f51e04f53b06",
      "100000:10a9ab557bcca8ba"
    ],
    "final": "00e10304a59046d7",
    "score": "2-3",
    "events": 4510
  }
};
