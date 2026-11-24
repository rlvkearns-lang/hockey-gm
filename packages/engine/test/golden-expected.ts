import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:370237372e06e9b7",
      "10000:fc6a5c92d678bc5d",
      "50000:45ecac9905c82655",
      "100000:c43e90006a45f2e0"
    ],
    "final": "79c01b8b7cf23e11",
    "score": "3-2",
    "events": 5971
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:247ccec1c283918f",
      "10000:59788408baa1f585",
      "50000:d02144bcca13bd00",
      "100000:e15e639633394c42"
    ],
    "final": "df1314210ff68a90",
    "score": "2-3",
    "events": 5820
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:fcc08e02fbe550be",
      "10000:e1c6f35f81ade527",
      "50000:da7870d471b5e241",
      "100000:f5321b03ccdf4aed"
    ],
    "final": "2cca17b99bcbd632",
    "score": "2-1",
    "events": 5769
  }
};
