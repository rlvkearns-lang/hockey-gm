import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:81d0bc78c65bf841",
      "10000:062ecf95da4dbd87",
      "50000:87422d62c1f2e76e",
      "100000:2d0e91e3366d976f"
    ],
    "final": "a9d99bf2bc90eae0",
    "score": "3-0",
    "events": 4480
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:7a3ea6201aa2bf8c",
      "10000:b69229f2f41169a9",
      "50000:f42c27d1c39b7fe2",
      "100000:fb412cf66c875a84"
    ],
    "final": "c34f4dc835a48cd5",
    "score": "3-5",
    "events": 4552
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:a6324c03e6ccd336",
      "10000:e7326a8ed4f92734",
      "50000:fd1007db26c921f1",
      "100000:c0e422d57bcdc0c7"
    ],
    "final": "88df35936349190e",
    "score": "3-4",
    "events": 4642
  }
};
