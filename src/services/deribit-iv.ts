/**
 * Deribit Implied Volatility Service
 *
 * Fetches BTC implied volatility from Deribit options market.
 * Used to detect elevated market risk (Fed announcements, geopolitical events, etc.)
 *
 * Key metrics:
 * - 1-day ATM IV: Short-term expected volatility
 * - DVOL: 30-day implied volatility index (like VIX for crypto)
 * - IV percentile: Current IV vs historical range
 */

const DERIBIT_API = 'https://www.deribit.com/api/v2/public';

export interface DeribitIVData {
  timestamp: number;

  // Current BTC price
  btc_price: number;

  // DVOL (30-day implied volatility index)
  dvol: number;

  // Short-term ATM IV (nearest expiry options)
  short_term_iv: number;
  short_term_expiry_hours: number;

  // 1-day expiry ATM IV
  one_day_iv: number | null;
  one_day_expiry: string | null;

  // Derived metrics
  iv_term_structure: 'contango' | 'backwardation' | 'flat';  // short vs long term IV
  expected_daily_move_pct: number;  // Based on short-term IV

  // Risk signal
  elevated_risk: boolean;
  risk_reason: string | null;
}

interface DeribitOption {
  instrument_name: string;
  expiration_timestamp: number;
  strike: number;
  option_type: 'call' | 'put';
}

interface DeribitTicker {
  instrument_name: string;
  mark_iv: number;
  mark_price: number;
  underlying_price: number;
}

// Deribit API response types
interface DeribitIndexPriceResponse {
  result: { index_price: number };
}

interface DeribitInstrumentsResponse {
  result: Array<{
    instrument_name: string;
    expiration_timestamp: number;
    strike: number;
  }>;
}

interface DeribitTickerResponse {
  result: {
    instrument_name: string;
    mark_iv: number;
    mark_price: number;
    underlying_price: number;
  };
  error?: unknown;
}

/**
 * Fetch current BTC price from Deribit
 */
async function getBTCPrice(): Promise<number> {
  const response = await fetch(`${DERIBIT_API}/get_index_price?index_name=btc_usd`);
  const data = await response.json() as DeribitIndexPriceResponse;
  return data.result.index_price;
}

/**
 * Fetch DVOL (30-day implied volatility index)
 */
async function getDVOL(): Promise<number> {
  const response = await fetch(`${DERIBIT_API}/get_index_price?index_name=btcdvol_usdc`);
  const data = await response.json() as DeribitIndexPriceResponse;
  return data.result.index_price;
}

/**
 * Get all active BTC options
 */
async function getBTCOptions(): Promise<DeribitOption[]> {
  const response = await fetch(`${DERIBIT_API}/get_instruments?currency=BTC&kind=option&expired=false`);
  const data = await response.json() as DeribitInstrumentsResponse;
  return data.result.map((opt) => ({
    instrument_name: opt.instrument_name,
    expiration_timestamp: opt.expiration_timestamp,
    strike: opt.strike,
    option_type: opt.instrument_name.endsWith('-C') ? 'call' as const : 'put' as const
  }));
}

/**
 * Get ticker (including IV) for a specific option
 */
async function getOptionTicker(instrumentName: string): Promise<DeribitTicker | null> {
  try {
    const response = await fetch(`${DERIBIT_API}/ticker?instrument_name=${instrumentName}`);
    const data = await response.json() as DeribitTickerResponse;
    if (data.error) return null;
    return {
      instrument_name: data.result.instrument_name,
      mark_iv: data.result.mark_iv,
      mark_price: data.result.mark_price,
      underlying_price: data.result.underlying_price
    };
  } catch {
    return null;
  }
}

/**
 * Find ATM options for a specific expiry
 */
function findATMOptions(options: DeribitOption[], btcPrice: number, targetExpiry: number): DeribitOption[] {
  // Filter to target expiry
  const expiryOptions = options.filter(opt => opt.expiration_timestamp === targetExpiry);

  // Sort by distance from ATM
  expiryOptions.sort((a, b) => Math.abs(a.strike - btcPrice) - Math.abs(b.strike - btcPrice));

  // Return closest call and put
  const atmStrike = expiryOptions[0]?.strike;
  return expiryOptions.filter(opt => opt.strike === atmStrike);
}

/**
 * Get ATM IV for a specific expiry
 */
async function getATMIV(options: DeribitOption[], btcPrice: number, targetExpiry: number): Promise<number | null> {
  const atmOptions = findATMOptions(options, btcPrice, targetExpiry);
  if (atmOptions.length === 0) return null;

  // Get IV from call option (or put if call not available)
  const callOption = atmOptions.find(opt => opt.option_type === 'call') || atmOptions[0];
  const ticker = await getOptionTicker(callOption.instrument_name);

  return ticker?.mark_iv || null;
}

/**
 * Calculate expected daily price move from annualized IV
 * Formula: daily_move = IV / sqrt(365)
 */
function ivToDailyMove(annualizedIV: number): number {
  return annualizedIV / Math.sqrt(365);
}

/**
 * Main function: Fetch comprehensive IV data
 */
export async function fetchDeribitIV(): Promise<DeribitIVData> {
  const now = Date.now();

  // Fetch in parallel
  const [btcPrice, dvol, options] = await Promise.all([
    getBTCPrice(),
    getDVOL(),
    getBTCOptions()
  ]);

  // Find unique expiries sorted by time
  const expiries = [...new Set(options.map(opt => opt.expiration_timestamp))].sort((a, b) => a - b);
  const validExpiries = expiries.filter(exp => exp > now);

  // Get nearest expiry (shortest term IV)
  const nearestExpiry = validExpiries[0];
  const nearestExpiryHours = nearestExpiry ? (nearestExpiry - now) / (1000 * 60 * 60) : 0;
  const shortTermIV = nearestExpiry ? await getATMIV(options, btcPrice, nearestExpiry) : null;

  // Find ~1-day expiry (closest to 24 hours from now)
  const oneDayTarget = now + (24 * 60 * 60 * 1000);
  const oneDayExpiry = validExpiries.reduce((closest, exp) => {
    const currentDiff = Math.abs(exp - oneDayTarget);
    const closestDiff = Math.abs(closest - oneDayTarget);
    return currentDiff < closestDiff ? exp : closest;
  }, validExpiries[0]);

  const oneDayIV = oneDayExpiry ? await getATMIV(options, btcPrice, oneDayExpiry) : null;
  const oneDayExpiryDate = oneDayExpiry ? new Date(oneDayExpiry).toISOString() : null;

  // Determine term structure
  const effectiveShortIV = shortTermIV || oneDayIV || dvol;
  let termStructure: 'contango' | 'backwardation' | 'flat';
  if (effectiveShortIV && dvol) {
    const diff = effectiveShortIV - dvol;
    if (diff > 3) termStructure = 'backwardation';  // Short IV > Long IV (fear)
    else if (diff < -3) termStructure = 'contango';  // Long IV > Short IV (normal)
    else termStructure = 'flat';
  } else {
    termStructure = 'flat';
  }

  // Calculate expected daily move
  const ivForMove = shortTermIV || oneDayIV || dvol;
  const expectedDailyMove = ivForMove ? ivToDailyMove(ivForMove) : 0;

  // Determine risk level
  // Elevated risk if:
  // 1. Short-term IV > 60% (high absolute vol)
  // 2. Backwardation (short IV >> long IV, indicates fear/event)
  // 3. Expected daily move > 4%
  let elevatedRisk = false;
  let riskReason: string | null = null;

  if (effectiveShortIV && effectiveShortIV > 60) {
    elevatedRisk = true;
    riskReason = `High short-term IV: ${effectiveShortIV.toFixed(1)}% (threshold: 60%)`;
  } else if (termStructure === 'backwardation' && effectiveShortIV && dvol && (effectiveShortIV - dvol) > 10) {
    elevatedRisk = true;
    riskReason = `Strong backwardation: short IV ${effectiveShortIV.toFixed(1)}% vs DVOL ${dvol.toFixed(1)}%`;
  } else if (expectedDailyMove > 4) {
    elevatedRisk = true;
    riskReason = `High expected daily move: ${expectedDailyMove.toFixed(1)}%`;
  }

  return {
    timestamp: now,
    btc_price: btcPrice,
    dvol,
    short_term_iv: shortTermIV || 0,
    short_term_expiry_hours: nearestExpiryHours,
    one_day_iv: oneDayIV,
    one_day_expiry: oneDayExpiryDate,
    iv_term_structure: termStructure,
    expected_daily_move_pct: expectedDailyMove,
    elevated_risk: elevatedRisk,
    risk_reason: riskReason
  };
}

// Test if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    console.log('Fetching Deribit IV data...\n');
    const data = await fetchDeribitIV();
    console.log('BTC Price:', `$${data.btc_price.toLocaleString()}`);
    console.log('DVOL (30-day IV):', `${data.dvol.toFixed(1)}%`);
    console.log('Short-term IV:', `${data.short_term_iv.toFixed(1)}%`, `(${data.short_term_expiry_hours.toFixed(1)}h expiry)`);
    console.log('1-day IV:', data.one_day_iv ? `${data.one_day_iv.toFixed(1)}%` : 'N/A');
    console.log('Term Structure:', data.iv_term_structure);
    console.log('Expected Daily Move:', `${data.expected_daily_move_pct.toFixed(2)}%`);
    console.log('Elevated Risk:', data.elevated_risk ? `YES - ${data.risk_reason}` : 'NO');
  })();
}
