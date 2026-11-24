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
      "10000:b6edc8e933c684fe",
      "50000:e48fc2ed1b96c136",
      "100000:3ed8a10da1fa513d"
    ],
    "final": "9a7259dc53266160",
    "score": "4-8",
    "events": 5195
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:41afedcb9edc385f",
      "10000:e22f161a20578457",
      "50000:9abdbeb6a1debbf6",
      "100000:27f0bf916f3f0924"
    ],
    "final": "9f86c29222877559",
    "score": "8-4",
    "events": 5368
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:3b11295b862e417c",
      "10000:f24b11c0544146de",
      "50000:c58442decb37806f",
      "100000:1941639158a3fc11"
    ],
    "final": "d505973eed2300d9",
    "score": "7-8",
    "events": 5255
  }
};
