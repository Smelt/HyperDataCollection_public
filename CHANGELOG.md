# Changelog

## [1.1.0] - 2025-10-19

### Added
- **Automatic Perpetual Discovery**: Monitor ALL Hyperliquid perpetuals automatically
  - New `getAllPerpetuals()` method in HyperliquidAPI to fetch all available markets
  - Support for `PAIRS=all` configuration option (now the default)
  - Dynamic pair fetching at startup - automatically discovers new markets as they're added to Hyperliquid

### Changed
- **Default behavior**: Now monitors ALL perpetuals by default instead of just 5 pairs
- **Configuration**: Updated `.env` and `.env.example` to use `PAIRS=all` as default
- **Startup process**: Application now fetches available perpetuals from API before starting monitor
- **Documentation**: Added comprehensive explanation of automatic discovery feature

### Technical Details
- Added `HyperliquidAPI.getAllPerpetuals()` method
- Modified `HyperliquidMarketMaker` class to:
  - Lazy-initialize the OrderBookMonitor after fetching pairs
  - Support dynamic pair resolution based on `PAIRS` configuration
  - Handle "all" as a special configuration value
- Updated console output to show count of monitored perpetuals

### Migration Guide
If you were previously monitoring specific pairs and want to continue doing so:

```env
# In your .env file, change from:
PAIRS=all

# To your specific pairs:
PAIRS=REZ,SOL,BTC,ETH,ATOM
```

---

## [1.0.0] - 2025-10-19

### Initial Release
- Real-time order book monitoring via WebSocket/REST
- Multi-pair spread tracking and analysis
- CSV data logging with daily organization
- Live CLI dashboard
- JSON summary exports
- Profitability analysis after fees
