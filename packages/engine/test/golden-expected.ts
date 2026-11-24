import type { Golden } from './golden';

/** Written by scripts/golden-update.ts; every runtime must reproduce these exactly. */
export const GOLDEN_EXPECTED: Record<number, Golden> = {
  "7": {
    "roster": "f2afea500810be16",
    "ticks": [
      "1:8b0d120264fb0259",
      "10:4b337b58e3441176",
      "100:9d287aa50604ec60",
      "1000:01d12b22189d93ef",
      "10000:67cf2a03b801aa25",
      "50000:3d9c2e329cd78abf",
      "100000:8aeebfed498b8f5d"
    ],
    "final": "1708d276de8083b7",
    "score": "8-11",
    "events": 5098
  },
  "42": {
    "roster": "1a569608feefa31c",
    "ticks": [
      "1:def2b654909d324c",
      "10:07e4328fcdf38e0b",
      "100:fee0226e35b0c71f",
      "1000:12246a339d9e6260",
      "10000:9bcc202f34ec2ace",
      "50000:e07ac2d671474ada",
      "100000:286b612e2faaa57a"
    ],
    "final": "e1ff369b5412fbf5",
    "score": "12-5",
    "events": 5319
  },
  "123456": {
    "roster": "e2181b46075c2e03",
    "ticks": [
      "1:f4eb765676f1472c",
      "10:0547e7d7db9cbcce",
      "100:aec03f8837fe67e1",
      "1000:a9a204df10ae9c6b",
      "10000:42eed77cfb91cac6",
      "50000:d0fb1c1a47a114e6",
      "100000:44f2aaf5d61cd54b"
    ],
    "final": "6b2365b93c24374c",
    "score": "3-5",
    "events": 5184
  }
};
