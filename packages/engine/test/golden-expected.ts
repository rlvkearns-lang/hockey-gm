import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:5a9a46873879f2ca",
      "10000:e78e1dc9a573f612",
      "50000:2fe20e127cae4acc",
      "100000:02829bf5afcee13a"
    ],
    "final": "01e97c2a71a200db",
    "score": "3-4",
    "events": 4629
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:adde4fce6f018464",
      "10000:ceabd65318037705",
      "50000:94cbc7c83ce4b693",
      "100000:e84749c2fb576d65"
    ],
    "final": "24690a41be0ef8df",
    "score": "1-4",
    "events": 4567
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:77f2b15353bc9d77",
      "10000:27f07a5380ee6ca8",
      "50000:2129a61a8b2c1347",
      "100000:40bd1337d9532199"
    ],
    "final": "b9c539645e770c70",
    "score": "1-4",
    "events": 4490
  }
};
