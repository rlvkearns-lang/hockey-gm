import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "e3a38d7e0f4fc99b",
    "ticks": [
      "1:58d0748b814146a6",
      "10:5be3fbd629b54850",
      "100:4381cdfb4e2992f9",
      "1000:ff776a8b6cbb1945",
      "10000:cb73899803af110c",
      "50000:bb69dcfaf4528cbc",
      "100000:bed42da733db059d"
    ],
    "final": "0a6aba6dcffa93a7",
    "score": "5-1",
    "events": 6039
  },
  "42": {
    "roster": "acdb74d6c714fb4a",
    "ticks": [
      "1:ddabf1032e8d1286",
      "10:d36527b4f1119c6e",
      "100:77a8ad11eef652b3",
      "1000:f3540a27875991b2",
      "10000:c39bca6ded0d8c01",
      "50000:f9be718105ee9abc",
      "100000:161093e721b50451"
    ],
    "final": "99139fa2f21fd374",
    "score": "3-8",
    "events": 5989
  },
  "123456": {
    "roster": "1e537c17feeab673",
    "ticks": [
      "1:aeaf66823bb2e8d7",
      "10:360b3350e838e8ed",
      "100:a440f034a48af8e5",
      "1000:323e55be328981b1",
      "10000:f1e75027ae29e363",
      "50000:fb49c206b742bd31",
      "100000:71e88ed2562259af"
    ],
    "final": "2bb48512885f4e40",
    "score": "1-3",
    "events": 6053
  }
};
