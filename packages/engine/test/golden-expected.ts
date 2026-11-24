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
      "10000:a23d53112c207ccd",
      "50000:31c39213edb32ae1",
      "100000:775ef0cfdcc309dd"
    ],
    "final": "7c51ed20f0dc87c2",
    "score": "4-5",
    "events": 5159
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:41afedcb9edc385f",
      "10000:e30932b7536f0237",
      "50000:95e984332f46d14d",
      "100000:2e465b2637d726fb"
    ],
    "final": "1a4714ed76b46ecb",
    "score": "5-10",
    "events": 5266
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:3b11295b862e417c",
      "10000:a3edd451d7b37ef9",
      "50000:91b050f6594dfdf1",
      "100000:02ab3cc996559413"
    ],
    "final": "c9746f8511ac9722",
    "score": "8-3",
    "events": 5058
  }
};
