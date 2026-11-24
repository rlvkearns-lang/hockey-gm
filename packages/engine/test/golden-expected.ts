import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:9d7d48572c94cf02",
      "10000:d98ceda89ae2379d",
      "50000:82004dd8a2223ca2",
      "100000:159954f9d445f9d1"
    ],
    "final": "2d0e6caf956683c7",
    "score": "2-1",
    "events": 5877
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:13bf040e28b49548",
      "10000:b558364cf844a5bd",
      "50000:f474376199236402",
      "100000:d446b707de26399b"
    ],
    "final": "1b83e5a17a0a7f62",
    "score": "3-2",
    "events": 5881
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:a73eaad1072744bc",
      "10000:b64ff25dc3ce1df6",
      "50000:1f9d1e5124d62cff",
      "100000:a6acde4b74d5aa96"
    ],
    "final": "ba76cd483214b405",
    "score": "1-0",
    "events": 5903
  }
};
