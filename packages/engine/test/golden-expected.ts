import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:d28da9060714fd6a",
      "10000:82cb37818c59f74d",
      "50000:a47c714e415b4b49",
      "100000:e926430f9aed868b"
    ],
    "final": "eb2cc333fd6caed2",
    "score": "2-2",
    "events": 3531
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:156c3c62ac731381",
      "1000:e0b72cce3eb7bd40",
      "10000:9c3d8bad5afd39d8",
      "50000:66ef467ffe2590ba",
      "100000:d914bdfffe42d21d"
    ],
    "final": "22fefa41fec9db2b",
    "score": "2-2",
    "events": 3438
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:e34689305cd825de",
      "10000:43803e62a68e9eb7",
      "50000:e75b707c8591b987",
      "100000:5979dd6f10f4b171"
    ],
    "final": "9d9f4339c9350edb",
    "score": "2-2",
    "events": 3311
  }
};
