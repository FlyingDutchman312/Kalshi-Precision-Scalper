'use strict';

const { symbols } = require('./core');
const { policies } = require('./strategies');

const holdoutAt = '2026-12-01T00:00:00.000Z';
const cutoff = Date.parse(holdoutAt);
const settlementGraceMs = 30 * 60_000;
const maxRows = 10_000;
const maxAgeMs = 15 * 60_000;
const sides = ['yes', 'no'];
const rules = { development: 100, holdout: 50, maxDrawdown: 5, maxCalibrationError: 0.10 };
const fees = {
  source: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf',
  assumption: 'One contract held to settlement. Standard taker rate (7%, multiplier 1) assumed for each series, rounded up to a whole cent for conservative stress. Series-specific and historical rates, depth and execution are unverified.',
};

const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
const mean = values => values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : null;

function simulate(ask, won, cents) {
  // Use integer centicents to avoid rounding a fee up on floating-point noise.
  const price = Math.round(ask * 10_000) + cents * 100;
  if (price < 1 || price >= 10_000) return null;
  const fee = Math.ceil(7 * price * (10_000 - price) / 100_000_000);
  const cost = price + 100 * fee;
  return { fee, cost, pnl: won * 10_000 - cost };
}

function stress(rows, cents) {
  let net = 0, peak = 0, drawdown = 0, fees = 0, cost = 0, fills = 0;
  for (const row of rows) {
    const trade = simulate(row.ask, row.won, cents);
    if (!trade) continue;
    fills++;
    fees += trade.fee;
    cost += trade.cost;
    net += trade.pnl;
    peak = Math.max(peak, net);
    drawdown = Math.max(drawdown, peak - net);
  }
  return {
    cents, fills, unpriceable: rows.length - fills,
    net: fills ? net / 10_000 : null,
    expectancy: rows.length ? net / 10_000 / rows.length : null,
    fees: fills ? fees / 100 : null,
    breakEven: fills ? cost / 10_000 / fills : null,
    drawdown: fills ? drawdown / 10_000 : null,
  };
}

function summarize(rows) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lower: i / 10, values: [] }));
  const model = [], midpoint = [];
  for (const row of rows) {
    if (!probability(row.model_probability)) continue;
    const p = row.model_probability;
    bins[Math.min(9, Math.floor(p * 10))].values.push(row);
    model.push((p - row.won) ** 2);
    midpoint.push(((row.ask + row.bid) / 2 - row.won) ** 2);
  }
  const calibration = bins.filter(bin => bin.values.length).map(({ lower, values }) => ({
    lower, count: values.length,
    predicted: mean(values.map(r => r.model_probability)),
    observed: mean(values.map(r => r.won)),
  }));
  return {
    count: rows.length, wins: rows.reduce((sum, r) => sum + r.won, 0),
    accuracy: mean(rows.map(r => r.won)),
    stress: [0, 1, 2, 3].map(cents => stress(rows, cents)),
    pairedBrier: { count: model.length, model: mean(model), midpoint: mean(midpoint) },
    calibration,
    calibrationError: model.length ? calibration.reduce((sum, bin) =>
      sum + bin.count * Math.abs(bin.predicted - bin.observed), 0) / model.length : null,
  };
}

function validObservation(row, symbol, now) {
  const observed = Date.parse(row.observed_at);
  const quote = Date.parse(row.quote_at);
  const close = Date.parse(row.close_at);
  return typeof row.ticker === 'string' && row.ticker.startsWith('KX' + symbol + '15M-') &&
    /^KX[A-Z0-9-]+$/.test(row.ticker) && sides.includes(row.side) &&
    probability(row.ask) && row.ask > 0 && row.ask < 1 &&
    probability(row.bid) && row.bid > 0 && row.bid <= row.ask &&
    Number.isFinite(observed) && observed - quote <= 12_000 && quote <= observed && observed < close && observed <= now;
}

function cohort(row) {
  if (Date.parse(row.close_at) < cutoff) return 'development';
  if (Date.parse(row.observed_at) >= cutoff) return 'holdout';
  return 'boundary';
}

function reconcile(row, official, now) {
  const close = Date.parse(row.close_at);
  if (close > now) return 'open';
  if (!sides.includes(row.result)) return now - close >= settlementGraceMs ? 'overdue' : 'pending';
  const settled = Date.parse(row.settled_at);
  if (!(settled >= close && settled <= now)) return 'mismatch';
  const verified = official.get(row.ticker);
  if (!verified) return 'unverified';
  return verified.result === row.result && verified.close === close ? 'reconciled' : 'mismatch';
}

function buildReport(rows, official, now, incomplete) {
  const groups = [];
  for (const [strategy, policy] of Object.entries(policies)) {
    for (const symbol of symbols) {
      const selected = new Map();
      const audit = { duplicates: 0, invalid: 0, boundary: 0, open: 0, pending: 0,
        overdue: 0, unverified: 0, mismatch: 0, reconciled: 0 };
      const cohorts = { development: [], holdout: [] };
      const matching = rows.filter(row => row.strategy === strategy && row.symbol === symbol);
      matching.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
      for (const row of matching) {
        if (!validObservation(row, symbol, now)) { audit.invalid++; continue; }
        if (selected.has(row.ticker)) { audit.duplicates++; continue; }
        selected.set(row.ticker, row);
      }
      const ordered = [...selected.values()].sort((a, b) =>
        Date.parse(a.close_at) - Date.parse(b.close_at) || a.ticker.localeCompare(b.ticker));
      for (const row of ordered) {
        const period = cohort(row);
        if (period === 'boundary') { audit.boundary++; continue; }
        const status = reconcile(row, official, now);
        audit[status]++;
        if (status === 'reconciled') cohorts[period].push({ ...row, won: Number(row.result === row.side) });
      }
      const development = summarize(cohorts.development);
      const holdout = summarize(cohorts.holdout);
      const blockers = [];
      if (incomplete) blockers.push('Incomplete strategy history');
      if (audit.duplicates || audit.invalid || audit.mismatch || audit.overdue || audit.unverified)
        blockers.push('Unresolved observation or settlement checks');
      if (development.count < rules.development || holdout.count < rules.holdout)
        blockers.push('Insufficient reconciled sample');
      if ([development, holdout].some(sample => sample.stress.some(s =>
        s.unpriceable || !(s.expectancy > 0) || s.drawdown > rules.maxDrawdown)))
        blockers.push('Net expectancy or drawdown gate failed');
      if (policy.prob !== null && [development, holdout].some(sample =>
        sample.pairedBrier.count !== sample.count || sample.calibrationError === null ||
        sample.calibrationError > rules.maxCalibrationError ||
        !(sample.pairedBrier.model < sample.pairedBrier.midpoint)))
        blockers.push('Paired Brier or calibration gate failed');
      groups.push({ symbol, strategy, observed: selected.size, audit, development, holdout,
        qualified: blockers.length === 0, blockers });
    }
  }
  return { researchOnly: true, holdoutAt, rules, fees, groups, incomplete, at: new Date(now).toISOString() };
}

function createQualification({ db, get, table, now = Date.now }) {
  let busy = false, report = null, failure = 'Awaiting first report';
  const official = new Map(), attempted = new Map();

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const rows = [];
      const asOf = now();
      const observedThrough = encodeURIComponent(new Date(asOf).toISOString());
      let incomplete = false;
      for (const strategy of Object.keys(policies)) {
        let ticker = '', count = 0;
        while (count < maxRows) {
          const batch = await db('?strategy=eq.' + strategy + '&observed_at=lte.' + observedThrough +
            '&order=ticker.asc&limit=500' + (ticker ? '&ticker=gt.' + encodeURIComponent(ticker) : ''),
          'GET', null, table);
          if (!Array.isArray(batch)) throw Error('Invalid strategy response');
          if (!batch.length) break;
          const last = batch.at(-1).ticker;
          if (typeof last !== 'string' || last === ticker) throw Error('Strategy pagination did not advance');
          ticker = last;
          count += batch.length;
          rows.push(...batch);
          if (batch.some(row => row.strategy !== strategy || !symbols.includes(row.symbol))) incomplete = true;
        }
        if (count >= maxRows) incomplete = true;
      }

      const candidates = new Set(rows.filter(row =>
        symbols.includes(row.symbol) && validObservation(row, row.symbol, asOf) &&
        cohort(row) !== 'boundary' && Date.parse(row.close_at) <= asOf &&
        sides.includes(row.result)).map(row => row.ticker));
      for (const ticker of official.keys()) if (!candidates.has(ticker)) official.delete(ticker);
      for (const ticker of attempted.keys()) if (!candidates.has(ticker)) attempted.delete(ticker);
      const queue = [...candidates].filter(ticker => !official.has(ticker))
        .sort((a, b) => (attempted.get(a) || 0) - (attempted.get(b) || 0) || b.localeCompare(a));
      for (const ticker of queue.slice(0, 20)) {
        attempted.set(ticker, now());
        try {
          const path = '/markets/' + encodeURIComponent(ticker);
          const { market } = await get(path).catch(error => {
            if (error.httpStatus !== 404) throw error;
            return get('/historical' + path);
          });
          if (market?.ticker === ticker && market.status === 'finalized' &&
              sides.includes(market.result) && Number.isFinite(Date.parse(market.close_time))) {
            official.set(ticker, { result: market.result, close: Date.parse(market.close_time) });
          }
        } catch (error) {
          if (error.code === 'KALSHI_RATE_LIMIT') break;
        }
      }
      report = buildReport(rows, official, asOf, incomplete);
      failure = null;
    } catch {
      failure = 'Qualification data unavailable';
    } finally {
      busy = false;
    }
  }

  function status() {
    const error = failure || (now() - Date.parse(report?.at) > maxAgeMs ? 'Qualification data stale' : null);
    if (error || !report) return { researchOnly: true, qualified: false, error };
    return report;
  }

  return { refresh, status };
}

module.exports = { buildReport, createQualification, holdoutAt, simulate };
