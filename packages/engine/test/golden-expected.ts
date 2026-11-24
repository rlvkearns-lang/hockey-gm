import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:80ea6018bda20b10",
      "10000:00eb1ec8bddf207e",
      "50000:4d7df1b7652c1b2e",
      "100000:d307989467f90b81"
    ],
    "final": "b77c2fa671c36ba1",
    "score": "3-2",
    "events": 5960
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:13bf040e28b49548",
      "10000:bb195ecf00660d14",
      "50000:a757110230607f06",
      "100000:87fec66417f19ef8"
    ],
    "final": "4510e324375aa819",
    "score": "4-4",
    "events": 6004
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:a73eaad1072744bc",
      "10000:b64ff25dc3ce1df6",
      "50000:bd5450cd5940a365",
      "100000:f9227a60f3a73aac"
    ],
    "final": "6830d20bb981470d",
    "score": "3-1",
    "events": 6096
  }
};
