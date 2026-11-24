import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:0485121830ba8ac6",
      "10000:53e7c54fce95966b",
      "50000:cbecf3512813a54e",
      "100000:6ce0f0c90847aa6f"
    ],
    "final": "91e12b614ae54823",
    "score": "4-8",
    "events": 5328
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:76e5e5090b790677",
      "10000:6081e4df027e41bf",
      "50000:ac21fea56725e905",
      "100000:d3029b4f1cc81bbb"
    ],
    "final": "b3867dd36e72f7ec",
    "score": "12-14",
    "events": 5542
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:a9a204df10ae9c6b",
      "10000:d6dffdcb0d6ccba7",
      "50000:ef2d1a59d369e980",
      "100000:fad0c74dcb8c6efa"
    ],
    "final": "d687ad1cc5cad602",
    "score": "4-8",
    "events": 5164
  }
};
