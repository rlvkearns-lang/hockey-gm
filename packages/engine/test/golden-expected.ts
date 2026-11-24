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
      "50000:c3fc58ff33cc989f",
      "100000:c2c66d2fd46f9866"
    ],
    "final": "2e01f36acb7e3eb2",
    "score": "3-2",
    "events": 5832
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:de0b886a6f96742e",
      "1000:247ccec1c283918f",
      "10000:12bdbe21ff4fd71d",
      "50000:b7752eac4c518b96",
      "100000:f8035c94f7697ec9"
    ],
    "final": "a9e94a513a161623",
    "score": "0-0",
    "events": 5785
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:fcc08e02fbe550be",
      "10000:e1c6f35f81ade527",
      "50000:2a1f56adaa5bce17",
      "100000:58998827961a6cc1"
    ],
    "final": "08f6106ac18807b4",
    "score": "3-3",
    "events": 5910
  }
};
