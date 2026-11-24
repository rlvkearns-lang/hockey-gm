import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:fb2c2ff278db9732",
      "10000:a9483c70ece8f1ea",
      "50000:9d106a1bc2a91986",
      "100000:b15481be54a38a5f"
    ],
    "final": "96917b9e4593592d",
    "score": "3-5",
    "events": 4429
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:66becdd6a28d139b",
      "1000:c13a1ff351f1c9b1",
      "10000:74266f43802385ff",
      "50000:a8ee006a6f370336",
      "100000:30a47a632d823067"
    ],
    "final": "64cccfba77e73d27",
    "score": "6-4",
    "events": 4385
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:f397e3cbff210d29",
      "10000:35faf774d55739c4",
      "50000:db154bdfa68eea07",
      "100000:39b8377a9770ccad"
    ],
    "final": "2911ac6e832d1f8d",
    "score": "9-8",
    "events": 4429
  }
};
