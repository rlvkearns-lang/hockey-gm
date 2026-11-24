import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:313ae17a479a451c",
      "10000:7eaf24834a6dc15e",
      "50000:defbc4ca48bff851",
      "100000:158d33f8fbdc5e94"
    ],
    "final": "7ca4ea59cee3f1cf",
    "score": "10-10",
    "events": 5146
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:29925b3529c18761",
      "10000:13f9ff443068bbc7",
      "50000:287d4b76e0e24a85",
      "100000:709b21abe2c98298"
    ],
    "final": "0f2dcfe1ece48062",
    "score": "6-7",
    "events": 5085
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:a9a204df10ae9c6b",
      "10000:dd2f2c6ab4a81cb2",
      "50000:0e05eb012b9e4043",
      "100000:212732827066379e"
    ],
    "final": "3cf7501a67f3ba35",
    "score": "11-9",
    "events": 5249
  }
};
