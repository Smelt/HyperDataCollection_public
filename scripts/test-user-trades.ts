import WebSocket from 'ws';

const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

interface Trade {
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  tid: number;
  users: [string, string];
}

ws.on('open', () => {
  console.log('Connected - watching for trades with same user...\n');

  ws.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'trades', coin: 'HYPE' }
  }));
});

const recentTrades: Trade[] = [];
let tradeCount = 0;

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.channel === 'trades' && msg.data) {
    for (const trade of msg.data as Trade[]) {
      tradeCount++;
      recentTrades.push(trade);

      // Keep last 50 trades
      if (recentTrades.length > 50) recentTrades.shift();

      // Check for same user in recent trades (within 1 second)
      const sameUserTrades = recentTrades.filter(t =>
        t.users[0] === trade.users[0] && // same buyer
        t.side === trade.side &&
        Math.abs(t.time - trade.time) < 1000 // within 1 second
      );

      if (sameUserTrades.length > 1) {
        const totalSize = sameUserTrades.reduce((sum, t) => sum + parseFloat(t.sz), 0);
        const totalNotional = sameUserTrades.reduce((sum, t) => sum + parseFloat(t.sz) * parseFloat(t.px), 0);
        console.log(`\n🔍 MULTI-FILL ORDER DETECTED!`);
        console.log(`   Buyer: ${trade.users[0].slice(0, 10)}...`);
        console.log(`   ${sameUserTrades.length} fills in <1 sec`);
        console.log(`   Individual fills: ${sameUserTrades.map(t => parseFloat(t.sz).toFixed(2)).join(', ')}`);
        console.log(`   Total size: ${totalSize.toFixed(2)} HYPE`);
        console.log(`   Total notional: $${totalNotional.toFixed(2)}\n`);
      }

      // Show individual trade
      const notional = parseFloat(trade.sz) * parseFloat(trade.px);
      console.log(`#${tradeCount}: ${trade.side === 'B' ? 'BUY' : 'SELL'} ${parseFloat(trade.sz).toFixed(2)} @ $${parseFloat(trade.px).toFixed(3)} = $${notional.toFixed(2)} | buyer: ${trade.users[0].slice(0, 10)}... seller: ${trade.users[1].slice(0, 10)}...`);

      if (tradeCount >= 40) {
        console.log('\n✓ Sample complete - user addresses ARE available in trade data');
        ws.close();
        process.exit(0);
      }
    }
  }
});

setTimeout(() => {
  console.log('\nTimeout reached');
  ws.close();
  process.exit(0);
}, 60000);
