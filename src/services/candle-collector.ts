/**
 * Candle Collector Service
 *
 * Periodically fetches hourly OHLCV candles for every tracked pair (including
 * HIP-3 prefixed pairs like vntl:OPENAI, xyz:DKNG) from Hyperliquid's
 * candleSnapshot endpoint and stores them in pair_candles_1h.
 *
 * Why polling instead of trade-by-trade WS:
 *   - candleSnapshot returns aggregated volume cheaply for ~30 pairs in seconds.
 *   - WebSocket trade subscriptions don't scale to every tracked pair without
 *     burning a subscription slot per pair (TradeSizeCollector deliberately
 *     caps at 6 pairs for this reason).
 *
 * Each tick re-fetches the last `lookbackHours` so the current (open) candle
 * keeps refreshing as new trades land — the unique key on (pair, timestamp)
 * lets us upsert idempotently.
 */

import { Pool } from 'mysql2/promise';
import { HyperliquidAPI } from '../api/hyperliquid.js';
import { CandleRepository, PairCandle } from '../storage/candle-repo.js';
import { HyperliquidCandle } from '../types/index.js';

export interface CandleCollectorConfig {
  intervalMs: number;        // How often to re-poll (default 5 min)
  lookbackHours: number;     // Hours of history to refresh each tick (default 6)
  interval: string;          // Hyperliquid candle interval (default "1h")
  perPairDelayMs: number;    // Spacing between per-pair API calls (default 100)
}

export class CandleCollector {
  private api: HyperliquidAPI;
  private repo: CandleRepository;
  private config: CandleCollectorConfig;
  private getPairsCallback: (() => string[]) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inflight = false;

  // Stats
  private lastRunAt = 0;
  private lastSavedCount = 0;
  private lastErrors = 0;

  constructor(
    pool: Pool,
    apiUrl: string,
    hip3Dexes: string[] = [],
    config: Partial<CandleCollectorConfig> = {}
  ) {
    this.api = new HyperliquidAPI(apiUrl, hip3Dexes);
    this.repo = new CandleRepository(pool);
    this.config = {
      intervalMs: config.intervalMs ?? 5 * 60 * 1000,
      lookbackHours: config.lookbackHours ?? 6,
      interval: config.interval ?? '1h',
      perPairDelayMs: config.perPairDelayMs ?? 100,
    };
  }

  async start(getPairs: () => string[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.getPairsCallback = getPairs;

    console.log(
      `📈 Candle collector starting (interval=${this.config.interval}, ` +
        `poll=${this.config.intervalMs / 1000}s, ` +
        `lookback=${this.config.lookbackHours}h)`
    );

    // Kick off first run immediately, then on a timer.
    this.tick().catch((err) =>
      console.error('Candle collector initial tick failed:', err)
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        console.error('Candle collector tick failed:', err)
      );
    }, this.config.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.inflight) {
      // Skip if previous tick still running (large pair count + slow API).
      return;
    }
    this.inflight = true;
    const startedAt = Date.now();

    try {
      const pairs = this.getPairsCallback?.() ?? [];
      if (pairs.length === 0) {
        return;
      }

      const endTime = Date.now();
      const startTime = endTime - this.config.lookbackHours * 60 * 60 * 1000;

      const candleBatch: PairCandle[] = [];
      let errorCount = 0;

      for (const pair of pairs) {
        try {
          const raw = await this.api.getCandleSnapshot(
            pair,
            this.config.interval,
            startTime,
            endTime
          );
          for (const c of raw) {
            const candle = toPairCandle(pair, c);
            if (candle) candleBatch.push(candle);
          }
        } catch (err) {
          errorCount++;
          // Don't spam logs for every pair on intermittent failures.
          if (errorCount <= 3) {
            console.warn(
              `   ⚠ candle fetch failed for ${pair}:`,
              err instanceof Error ? err.message : err
            );
          }
        }

        if (this.config.perPairDelayMs > 0) {
          await sleep(this.config.perPairDelayMs);
        }
      }

      let saved = 0;
      if (candleBatch.length > 0) {
        // Upsert in chunks to keep statement size bounded.
        const chunkSize = 500;
        for (let i = 0; i < candleBatch.length; i += chunkSize) {
          saved += await this.repo.saveBatch(
            candleBatch.slice(i, i + chunkSize)
          );
        }
      }

      this.lastRunAt = startedAt;
      this.lastSavedCount = saved;
      this.lastErrors = errorCount;

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `📈 Candle tick: ${pairs.length} pairs, ${candleBatch.length} candles, ` +
          `${saved} rows upserted, ${errorCount} errors, ${elapsed}s`
      );
    } finally {
      this.inflight = false;
    }
  }

  getStats() {
    return {
      lastRunAt: this.lastRunAt,
      lastSavedCount: this.lastSavedCount,
      lastErrors: this.lastErrors,
    };
  }
}

function toPairCandle(pair: string, c: HyperliquidCandle): PairCandle | null {
  const open = parseFloat(c.o);
  const high = parseFloat(c.h);
  const low = parseFloat(c.l);
  const close = parseFloat(c.c);
  const volumeBase = parseFloat(c.v);
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volumeBase)
  ) {
    return null;
  }
  // Approximate USD volume using the candle's typical price.
  // (Hyperliquid doesn't return a notional value in candleSnapshot.)
  const typical = (high + low + close) / 3;
  const volumeUsd = volumeBase * (Number.isFinite(typical) ? typical : close);
  return {
    pair,
    timestamp: c.t,
    open,
    high,
    low,
    close,
    volumeBase,
    volumeUsd,
    tradeCount: c.n,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
