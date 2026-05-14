/**
 * One-shot candle backfill.
 *
 * Fetches `BACKFILL_DAYS` of hourly candles (default 7) for every pair currently
 * present in spread_snapshots_1min (last 7 days). Useful right after deploying
 * the candle collector — gives Grafana dashboards historical volume data
 * without waiting for the collector to organically catch up.
 *
 * Run with: npx tsx src/backfill-candles.ts
 */

import 'dotenv/config';
import { config } from './config/index.js';
import { HyperliquidAPI } from './api/hyperliquid.js';
import { CandleRepository, PairCandle } from './storage/candle-repo.js';
import { getPool, closePool, testConnection } from './storage/database.js';

async function main() {
  const days = parseInt(process.env.BACKFILL_DAYS || '7');
  const perPairDelayMs = parseInt(process.env.BACKFILL_PER_PAIR_DELAY_MS || '120');
  const hip3Dexes = process.env.HIP3_DEXES
    ? process.env.HIP3_DEXES.split(',').map((d) => d.trim()).filter(Boolean)
    : [];

  console.log(`📈 Backfilling ${days}d of 1h candles for all recently tracked pairs`);

  const ok = await testConnection();
  if (!ok) {
    console.error('❌ DB connection failed');
    process.exit(1);
  }

  const pool = getPool();
  const repo = new CandleRepository(pool);
  const api = new HyperliquidAPI(config.hyperliquidApiUrl, hip3Dexes);

  const [pairRows] = await pool.query<any[]>(
    `SELECT DISTINCT pair FROM spread_snapshots_1min
     WHERE timestamp >= (UNIX_TIMESTAMP(NOW()) - 7 * 86400) * 1000
     ORDER BY pair`
  );
  const pairs: string[] = pairRows.map((r) => r.pair);
  console.log(`   ${pairs.length} pairs to backfill`);

  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  let totalSaved = 0;
  let errors = 0;

  for (const pair of pairs) {
    try {
      const candles = await api.getCandleSnapshot(pair, '1h', startTime, endTime);
      const batch: PairCandle[] = [];
      for (const c of candles) {
        const open = parseFloat(c.o);
        const high = parseFloat(c.h);
        const low = parseFloat(c.l);
        const close = parseFloat(c.c);
        const vol = parseFloat(c.v);
        if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(vol)) continue;
        const typical = (high + low + close) / 3;
        batch.push({
          pair,
          timestamp: c.t,
          open,
          high,
          low,
          close,
          volumeBase: vol,
          volumeUsd: vol * (Number.isFinite(typical) ? typical : close),
          tradeCount: c.n,
        });
      }
      if (batch.length > 0) {
        // Chunked upsert to keep statement size bounded.
        const chunkSize = 500;
        for (let i = 0; i < batch.length; i += chunkSize) {
          totalSaved += await repo.saveBatch(batch.slice(i, i + chunkSize));
        }
      }
      console.log(`   ✓ ${pair}: ${batch.length} candles`);
    } catch (err) {
      errors++;
      console.warn(`   ⚠ ${pair}:`, err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, perPairDelayMs));
  }

  console.log(`✅ Done: ${totalSaved} rows upserted across ${pairs.length} pairs (${errors} errors)`);
  await closePool();
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
