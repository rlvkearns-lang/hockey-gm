import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "b8824bd2d6630580",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:c1735fe58c455e76",
      "10000:51717040f13f9101",
      "50000:1e839f61faaed8f2",
      "100000:f1fc8d500bd71d31"
    ],
    "final": "2e6e260ea7c0050f",
    "score": "7-4",
    "events": 4149
  },
  "42": {
    "roster": "c6628586042bb3cd",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:66becdd6a28d139b",
      "1000:1c4fd45b36d96c36",
      "10000:c56fad05bf3bc23b",
      "50000:e5b3a466a851e6b9",
      "100000:00cd2d21b295d910"
    ],
    "final": "1eaa21ec33dff3c1",
    "score": "5-4",
    "events": 4134
  },
  "123456": {
    "roster": "f836ea58f42dfa80",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:377743b1929af00b",
      "10000:e5909a0419ad06c0",
      "50000:a4ac5d8bcb60f7cf",
      "100000:cdba82a812741d7a"
    ],
    "final": "f312f27820d55fac",
    "score": "6-5",
    "events": 4561
  }
};
