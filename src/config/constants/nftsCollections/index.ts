import { Collections, CollectionKey } from './types'

const collections: Collections = {
  [CollectionKey.PANCAKE]: {
    name: 'Pancake Bunnies',
    slug: 'pancake-bunnies',
    address: {
      137: '0x55E6DDbA23300306d1a804d27E3d22b14c2E0BDc',
      97: '0x60935F36e4631F73f0f407e68642144e07aC7f5E',
    },
  },
  [CollectionKey.SQUAD]: {
    name: 'Pancake Squad',
    description: "PancakeSwap's first official generative NFT collection.. Join the squad.",
    slug: 'pancake-squad',
    address: {
      137: '0x55E6DDbA23300306d1a804d27E3d22b14c2E0BDc',
      97: '0xEf12ef570300bFA65c4F022deAaA3dfF4f5d5c91',
    },
  },
}

export default collections
