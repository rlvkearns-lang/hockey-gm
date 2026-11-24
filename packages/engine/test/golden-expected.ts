import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:d59b01b45b5688b0",
      "10000:59a20ee07db29f37",
      "50000:194e7baa9c65857c",
      "100000:2a736b11d0405fcb"
    ],
    "final": "b698cff677f52878",
    "score": "7-11",
    "events": 5050
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:cf17883d80848895",
      "10000:c7892efd9151f8f9",
      "50000:d9e065b542661317",
      "100000:a81832fa0dfd0dca"
    ],
    "final": "08a99ccd65e3fcef",
    "score": "11-11",
    "events": 5100
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:d35d7d730d458686",
      "10000:72d361ff032a0357",
      "50000:ddb40fc0f9fbf72f",
      "100000:2c225c0773129b73"
    ],
    "final": "3a95b7e9db5cc026",
    "score": "5-4",
    "events": 4987
  }
};
