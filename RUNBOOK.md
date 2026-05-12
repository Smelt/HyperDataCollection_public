# Runbook — Local Verification & EC2 Deployment

How to verify each data-collection service runs locally, then deploy it to EC2.
Last verified: 2026-05-06 (against `cryptodb.cdhnmlg3soug.us-east-1.rds.amazonaws.com`).

## Prerequisites

- Node 18+ (verified with v23.11.0), npm 10+
- `mysql` client (macOS: `/opt/homebrew/opt/mysql-client/bin/mysql`)
- `.env` populated (see `.env.example`)
- For deploys: SSH key (`*.pem`) + EC2 public IP

```bash
# One-time
npm install
npm run build              # tsc — should be silent on success
```

## Services overview

| Service | Local cmd | EC2 process |
|---|---|---|
| Main collector | `npm run dev` | PM2: `hyperliquid-bot` |
| Spread REST API | `npm run api` (port 3001) | PM2: `spread-api` |
| Rate-limit monitor | `npm run monitor:rate-limit` | PM2: `rate-limit-monitor` |
| `aggregate-1min.sh` | `./scripts/aggregate-1min.sh` | crontab: every minute |
| `cleanup.sh` | (skip on prod — destructive) | crontab: Sun 02:00 |
| `fetch-trades.sh` | `./scripts/fetch-trades.sh` | crontab: every 5 min |
| `fetch-user-trades.sh` | `./scripts/fetch-user-trades.sh` | crontab: every minute |

---

## Local verification

Each service shares the prod RDS — running locally writes to the same DB the EC2 collector uses.

### 1. Main collector (`src/index.ts`)

```bash
rm -f /tmp/hyper-main.log
npm run dev > /tmp/hyper-main.log 2>&1 &
MAIN_PID=$!
sleep 30
head -60 /tmp/hyper-main.log
kill $MAIN_PID
```

**Pass criteria** (in order, in the log):

- `🎯 Smart filtering enabled` and a discovery scan that returns 20 pairs
- `Database connection pool created` → `✓ Database connection test successful`
- `📊 Trade WebSocket connected` and `Subscribed to trades:`
- `WebSocket connected` (orderbook stream)
- Dashboard renders with `Data points collected: NN` and live spreads

### 2. Spread REST API (`src/api/spread-api.ts`)

```bash
rm -f /tmp/hyper-api.log
npm run api > /tmp/hyper-api.log 2>&1 &
API_PID=$!
until grep -q "listening on port" /tmp/hyper-api.log 2>/dev/null; do sleep 0.5; done

curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/api/pairs/active
curl -s http://localhost:3001/api/market/snapshot | head -c 400
curl -s http://localhost:3001/api/btc-iv/should-trade
# Use a pair you know is being tracked (see /api/pairs/active):
curl -s http://localhost:3001/api/spread/PURR/current

kill $API_PID
```

**Pass criteria**: `/api/health` → `{"status":"ok"}`; `/api/btc-iv/should-trade` returns
`{"should_trade":..., "iv_data":{...}}` (Deribit live data); pair-specific endpoints return
spread data for currently tracked pairs.

> **Gotcha**: BTC may not appear in `/api/pairs/active` when the smart filter is selecting
> high-spread HIP-3 pairs. Use a pair from `/api/pairs/active`, not BTC.

### 3. Rate limit monitor (`src/monitors/rate-limit-monitor.ts`)

```bash
rm -f /tmp/hyper-rl.log
npm run monitor:rate-limit > /tmp/hyper-rl.log 2>&1 &
RL_PID=$!
sleep 5
cat /tmp/hyper-rl.log
pkill -f rate-limit-monitor
```

**Pass criteria**: prints `Requests: X/Y (Z%)`, `Δ Requests`, `Δ Volume` lines and writes to
`rate_limit_snapshots`. First poll is immediate; subsequent polls every 60s.

### 4. Cron-job scripts

The four cron scripts must each run cleanly. Run them in this order against prod RDS.

```bash
./scripts/aggregate-1min.sh        # idempotent (ON DUPLICATE KEY)
./scripts/fetch-trades.sh          # idempotent upserts
./scripts/fetch-user-trades.sh     # idempotent upserts
bash -n ./scripts/cleanup.sh       # syntax-only — DO NOT run against prod (DELETE + OPTIMIZE)
```

**Pass criteria**:

- `aggregate-1min.sh`: `Aggregated N pairs for window: <ISO time>` with exit 0
- `fetch-trades.sh`: `Successful: N | Failed: 0` with N upserted
- `fetch-user-trades.sh`: `✓ Trades processed: X inserted, Y updated`
- `cleanup.sh`: `bash -n` returns 0 (no syntax errors)

> **Known fixed bugs (2026-05-06)**: stale `spread_snapshots` references replaced with
> `spread_snapshots_partitioned` in `aggregate-1min.sh`, `cleanup.sh`,
> `backfill-1min-aggregates.sh`, `ec2-setup.sh`, `src/services/pair-filter.ts`.
> Also added `|| true` after `grep -v "Using a password"` pipelines (under `set -e`,
> grep returning 1 on no-match silently aborts the script). Hardened in
> `aggregate-1min.sh`, `cleanup.sh`, and `backfill-1min-aggregates.sh`.

> **Behavioral change in cleanup.sh (2026-05-06)**: removed `OPTIMIZE TABLE
> spread_snapshots_partitioned`. The previous (broken) cron never ran it; now that
> the table name is correct, OPTIMIZE on the partitioned table would rebuild every
> partition under metadata locks (multi-GB, blocks inserts). Use `manage-partitions.sh`
> to drop expired partitions instead. The OPTIMIZE for `spread_snapshots_1min` and
> `trading_signals` (small tables) is retained.

---

## EC2 deployment

> Replace `<KEY>` with your `*.pem` path and `<IP>` with the EC2 public IP throughout.
> Default user is `ubuntu`. Region: `ap-northeast-1` (Tokyo).

### Pre-flight

```bash
chmod 400 <KEY>
ssh -i <KEY> ubuntu@<IP> 'echo ok && uname -a && pm2 list'
```

If `pm2: command not found`, the box is fresh — run `./scripts/ec2-setup.sh` on it once
(installs Node 18, PM2, mysql-client, AWS CLI, sets timezone, log rotation, sysctl tuning).
Read it before piping; it edits `/etc/security/limits.conf`, `/etc/sysctl.conf`, and UFW.

### Deploy each service

Each `deploy-*.sh` script tars the project (excluding `node_modules`, `data`, `dist`,
`.git`, `*.log`), `scp`s it, extracts to `~/hyperliquid-bot`, runs `npm install --production`,
then starts/restarts the relevant PM2 process. Existing installs are backed up to
`~/hyperliquid-bot.backup-<timestamp>`.

```bash
# Main collector
./scripts/deploy-to-ec2.sh <KEY> <IP>

# Rate limit monitor (separate PM2 app)
./scripts/deploy-rate-limit-monitor.sh <KEY> <IP>

# Cron crowd
./scripts/deploy-aggregation-to-ec2.sh <KEY> <IP>      # installs aggregate-1min cron
./scripts/deploy-cleanup-to-ec2.sh <KEY> <IP>          # installs weekly cleanup cron
./scripts/deploy-trades-to-ec2.sh <KEY> <IP>           # installs fetch-trades + fetch-user-trades crons
```

> The Spread REST API does not have a dedicated deploy script. It ships in the same
> tarball as the main collector; start it on EC2 with:
>
> ```bash
> ssh -i <KEY> ubuntu@<IP> "cd ~/hyperliquid-bot && pm2 start npm --name spread-api -- run api && pm2 save"
> ```

### Refresh `~/status.sh` on existing boxes

`scripts/ec2-setup.sh` embeds the `~/status.sh` helper as a heredoc and only writes
it on a fresh setup. Boxes provisioned before this fix still have the old version
that queries the missing `spread_snapshots` table. Push the corrected helper:

```bash
ssh -i <KEY> ubuntu@<IP> bash -s <<'EOF'
cat > ~/status.sh <<'INNER'
#!/bin/bash
echo "=== Application Status ==="
pm2 status
echo
echo "=== Recent Logs ==="
pm2 logs hyperliquid-bot --lines 10 --nostream
echo
echo "=== Database Connection ==="
cd ~/hyperliquid-bot && source .env 2>/dev/null
if [ -n "$DB_HOST" ]; then
  mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" ${DB_NAME} -e \
    "SELECT MAX(timestamp) AS latest_ms FROM spread_snapshots_partitioned;" 2>/dev/null \
    || echo "Cannot connect to database"
else
  echo ".env file not found"
fi
echo
echo "=== Disk Usage ==="
df -h | grep -E '/$|/home'
echo
echo "=== Memory Usage ==="
free -h
INNER
chmod +x ~/status.sh
EOF
```

> Note: replaced `SELECT COUNT(*)` with `SELECT MAX(timestamp)` — `COUNT(*)` on the
> multi-million-row partitioned table is a 10s+ full scan; `MAX(timestamp)` uses the
> partition pruning + index and is instant.

### Verify on EC2

```bash
ssh -i <KEY> ubuntu@<IP> bash -c '
pm2 list
crontab -l
~/status.sh
tail -n 20 ~/hyperliquid-bot/logs/aggregate-1min.log
tail -n 20 ~/hyperliquid-bot/logs/fetch-trades.log
tail -n 20 /tmp/fetch-user-trades.log
'
```

**Pass criteria**:

- `pm2 list` shows `hyperliquid-bot`, `spread-api`, `rate-limit-monitor` all `online`
- `crontab -l` lists 4 cron entries (aggregate, cleanup, fetch-trades, fetch-user-trades)
- Aggregate log shows `Aggregated N pairs` lines updated within the last minute
- Fetch-trades log shows `Successful: N | Failed: 0` updated within the last 5 min
- `~/status.sh` reports the data collector and spread-api as running

### Rollback

```bash
ssh -i <KEY> ubuntu@<IP> bash -c '
pm2 stop hyperliquid-bot spread-api rate-limit-monitor
ls -lt ~/hyperliquid-bot.backup-* | head -1
mv ~/hyperliquid-bot ~/hyperliquid-bot.broken-$(date +%Y%m%d-%H%M%S)
mv ~/hyperliquid-bot.backup-<timestamp> ~/hyperliquid-bot
pm2 restart hyperliquid-bot spread-api rate-limit-monitor
'
```

---

## Useful EC2 one-liners

```bash
# Tail every PM2 process at once
ssh -i <KEY> ubuntu@<IP> 'pm2 logs --lines 50'

# Last cron failures
ssh -i <KEY> ubuntu@<IP> 'grep -i error ~/hyperliquid-bot/logs/*.log | tail -20'

# Latest spread snapshot timestamp (sanity check that data is flowing)
ssh -i <KEY> ubuntu@<IP> '
source ~/hyperliquid-bot/.env
mysql -h$DB_HOST -u$DB_USER -p$DB_PASSWORD $DB_NAME -e \
  "SELECT FROM_UNIXTIME(MAX(timestamp)/1000) FROM spread_snapshots_partitioned;"
'
```
