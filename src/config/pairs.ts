import { PairConfig } from '../types/index.js';

export const PAIRS: PairConfig[] = [
  {
    symbol: 'REZ',
    minSpread: 0.08,
    targetVolume: 1000000,
    enabled: true
  },
  {
    symbol: 'SOL',
    minSpread: 0.05,
    targetVolume: 50000000,
    enabled: true
  },
  {
    symbol: 'BTC',
    minSpread: 0.02,
    targetVolume: 100000000,
    enabled: true
  },
  {
    symbol: 'ETH',
    minSpread: 0.03,
    targetVolume: 80000000,
    enabled: true
  },
  {
    symbol: 'ATOM',
    minSpread: 0.06,
    targetVolume: 5000000,
    enabled: true
  },
];

export function getPairConfig(symbol: string): PairConfig | undefined {
  return PAIRS.find(p => p.symbol === symbol && p.enabled);
}

export function getEnabledPairs(): string[] {
  return PAIRS.filter(p => p.enabled).map(p => p.symbol);
}
