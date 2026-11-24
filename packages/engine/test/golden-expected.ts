import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:91615099c31440ae",
      "10000:02d687e8fdb398da",
      "50000:5ee9cccc910a75f8",
      "100000:bab238f745e38a22"
    ],
    "final": "712886b182697f71",
    "score": "4-2",
    "events": 4285
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:a72875ae17279ab6",
      "10000:0141b9ef36591eb5",
      "50000:9c1e4a503890bc4f",
      "100000:bbe8367d14737273"
    ],
    "final": "8d90265bfa99beeb",
    "score": "1-1",
    "events": 4175
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:86f83e3ae00f7e84",
      "10000:4b2c93766bbcc5ad",
      "50000:bdefa33dea4875b9",
      "100000:7ec014897aaecb82"
    ],
    "final": "2c6e750e95221ad5",
    "score": "1-2",
    "events": 4511
  }
};
