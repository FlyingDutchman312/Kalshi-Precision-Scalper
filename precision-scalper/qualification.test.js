'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, createQualification, holdoutAt, simulate } = require('./qualification');

const cutoff = Date.parse(holdoutAt);
const asOf = cutoff + 2 * 86_400_000;
const iso = ms => new Date(ms).toISOString();

function sample(id, close, overrides = {}) {
  return {
    ticker: 'KXBTC15M-' + id, symbol: 'BTC', strategy: 'aggressive', side: 'no',
    ask: 0.87, bid: 0.85, model_probability: 0.98, result: 'no',
    observed_at: iso(close - 30_000), quote_at: iso(close - 31_000),
    close_at: iso(close), settled_at: iso(close + 60_000), ...overrides,
  };
}

const verified = rows => new Map(rows.map(r => [r.ticker, { result: r.result, close: Date.parse(r.close_at) }]));
const btc = report => report.groups.find(g => g.symbol === 'BTC' && g.strategy === 'aggressive');

test('applies adverse ask slippage, one-contract fee and impossible-price handling', () => {
  assert.deepEqual(simulate(0.49, 1, 1), { fee: 2, cost: 5200, pnl: 4800 });
  assert.deepEqual(simulate(0.98, 0, 1), { fee: 1, cost: 10000, pnl: -10000 });
  assert.equal(simulate(0.98, 1, 2), null);
});

test('deduplicates before looking at results and keeps assets and cutoff cohorts separate', () => {
  const early = sample('EARLY', cutoff - 600_000);
  const later = { ...early, observed_at: iso(cutoff - 620_000), ask: 0.92 };
  const boundary = sample('BOUNDARY', cutoff);
  const forward = sample('FORWARD', cutoff + 60_000, { result: 'yes', model_probability: null });
  const eth = sample('ETH', cutoff + 60_000, { symbol: 'ETH', ticker: 'KXETH15M-ETH' });
  const rows = [later, boundary, forward, early, eth];
  const report = buildReport(rows, verified(rows), asOf, false);
  const g = btc(report);
  assert.equal(g.audit.duplicates, 1);
  assert.equal(g.audit.boundary, 1);
  assert.equal(g.development.count, 1);
  assert.equal(g.development.stress[0].net, 0.12);
  assert.equal(g.holdout.count, 1);
  assert.equal(g.holdout.wins, 0);
  assert.equal(g.holdout.stress[0].drawdown, 0.88);
  assert.equal(g.holdout.pairedBrier.count, 0);
  assert.equal(report.groups.find(x => x.symbol === 'ETH' && x.strategy === 'aggressive').holdout.count, 1);
});

test('fails closed for missing, conflicting, or untimely settlement evidence', () => {
  const closed = cutoff + 60_000;
  const rows = [sample('MISSING', closed), sample('DISAGREE', closed), sample('CLOSE', closed),
    sample('PREMATURE', closed, { settled_at: iso(closed - 1) }),
    sample('OVERDUE', closed, { result: null, settled_at: null }),
    sample('PENDING', asOf - 10_000, { result: null, settled_at: null }),
    sample('LATE', closed, { observed_at: iso(closed) })];
  const official = verified(rows);
  official.delete(rows[0].ticker);
  official.set(rows[1].ticker, { result: 'yes', close: closed });
  official.set(rows[2].ticker, { result: 'no', close: closed + 1 });
  const g = btc(buildReport(rows, official, asOf, false));
  assert.equal(g.holdout.count, 0);
  assert.equal(g.audit.mismatch, 3);
  assert.equal(g.audit.unverified, 1);
  assert.equal(g.audit.overdue, 1);
  assert.equal(g.audit.pending, 1);
  assert.equal(g.audit.invalid, 1);
  assert.equal(g.qualified, false);
});

test('requires complete holdout evidence, positive stressed results and paired model skill', () => {
  const rows = Array.from({ length: 150 }, (_, i) =>
    sample(String(i), cutoff + (i - 100) * 60_000 + 40_000));
  const official = verified(rows);
  const report = btc(buildReport(rows, official, asOf, false));
  assert.equal(report.development.count, 100);
  assert.equal(report.holdout.count, 50);
  assert.equal(report.holdout.calibration[0].count, 50);
  assert.ok(report.holdout.pairedBrier.model < report.holdout.pairedBrier.midpoint);
  assert.equal(report.qualified, true);
  assert.equal(btc(buildReport(rows, official, asOf, true)).qualified, false);
  rows.at(-1).model_probability = null;
  assert.equal(btc(buildReport(rows, official, asOf, false)).qualified, false);
  rows.at(-1).model_probability = 0.98;
  rows.at(-1).ask = 0.99;
  assert.equal(btc(buildReport(rows, official, asOf, false)).qualified, false);
});

test('reader uses keyset pages, verifies each ticker once, falls back for archives and drops stale data', async () => {
  const row = sample('ARCHIVED', cutoff + 60_000);
  let now = asOf, fail = false;
  const paths = [];
  const worker = createQualification({
    now: () => now, table: 'research',
    db: async (path, method, body, table) => {
      assert.equal(method, 'GET');
      assert.equal(table, 'research');
      if (fail) throw Error('database unavailable');
      return path.includes('strategy=eq.aggressive') && !path.includes('ticker=gt.') ? [row] : [];
    },
    get: async path => {
      paths.push(path);
      if (!path.startsWith('/historical')) throw Object.assign(Error('not found'), { httpStatus: 404 });
      return { market: { ticker: row.ticker, result: 'no', status: 'finalized', close_time: row.close_at } };
    },
  });
  assert.equal(worker.status().qualified, false);
  await worker.refresh();
  await worker.refresh();
  assert.equal(paths.length, 2);
  assert.equal(btc(worker.status()).holdout.count, 1);
  now += 16 * 60_000;
  assert.match(worker.status().error, /stale/);
  fail = true;
  await worker.refresh();
  assert.equal(worker.status().qualified, false);
  assert.equal(worker.status().groups, undefined);
});
