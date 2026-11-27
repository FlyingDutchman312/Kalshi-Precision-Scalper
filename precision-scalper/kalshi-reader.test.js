'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createKalshiReader}=require('./kalshi-reader');
function harness(responses=[]) {
  let time=Date.parse('2026-11-27T03:00:00Z');const calls=[];
  const reader=createKalshiReader({now:()=>time,sleep:async ms=>{time+=ms;},random:()=>0,
    fetchImpl:async url=>{calls.push({url,at:time});const next=responses.shift()||{status:200,data:{markets:[]}};
      return {status:next.status,ok:next.status===200,headers:new Headers(next.headers),json:async()=>next.data};}});
  return {reader,calls,advance:ms=>{time+=ms;}};
}
test('all consumers share pacing and coalesce identical reads',async()=>{
  const {reader,calls}=harness([{status:200,data:{market:{ticker:'KXBTC15M-X',status:'closed'}}}]);
  const a=reader.get('/markets/KXBTC15M-X'),b=reader.get('/markets/KXBTC15M-X');
  assert.deepEqual(await a,await b);assert.equal(calls.length,1);
  await reader.get('/markets?series_ticker=KXBTC15M&status=open');
  assert.equal(calls[1].at-calls[0].at,1000);assert.equal(reader.status().coalesced,1);
});
test('429 pauses every consumer, cancels queued reads and backs off exponentially',async()=>{
  const {reader,calls,advance}=harness([{status:429},{status:429},{status:200,data:{markets:[]}}]);
  const results=await Promise.allSettled([
    reader.get('/markets?series_ticker=KXBTC15M'),reader.get('/markets?series_ticker=KXETH15M')]);
  assert.ok(results.every(r=>r.status==='rejected'&&r.reason.code==='KALSHI_RATE_LIMIT'));
  assert.equal(calls.length,1);assert.equal(reader.status().rateLimited,1);
  await assert.rejects(reader.get('/markets/KXBTC15M-X'),{code:'KALSHI_RATE_LIMIT'});
  assert.equal(calls.length,1);advance(10000);
  await assert.rejects(reader.get('/markets?series_ticker=KXBTC15M'),{code:'KALSHI_RATE_LIMIT'});
  const retry=Date.parse(reader.status().cooldownUntil);assert.equal(retry-calls.at(-1).at,20000);
  advance(20000);await reader.get('/markets?series_ticker=KXBTC15M');
  assert.equal(reader.status().cooldownUntil,null);assert.ok(reader.status().lastSuccessAt);
});
test('Retry-After and reset headers extend the shared backoff',async()=>{
  const {reader,calls}=harness([{status:429,headers:{'Retry-After':'30','X-RateLimit-Reset':'45'}}]);
  await assert.rejects(reader.get('/markets?status=open'));
  assert.equal(Date.parse(reader.status().cooldownUntil)-calls[0].at,45000);
});
test('live discovery is not cached; settlement reuse is bounded and finalized results persist',async()=>{
  const {reader,calls,advance}=harness([
    {status:200,data:{market:{ticker:'KXBTC15M-X',status:'closed'}}},
    {status:200,data:{market:{ticker:'KXBTC15M-X',status:'finalized',result:'yes'}}}]);
  await reader.get('/markets/KXBTC15M-X');await reader.get('/markets/KXBTC15M-X');assert.equal(calls.length,1);
  advance(60001);await reader.get('/markets/KXBTC15M-X');advance(60001);
  await reader.get('/markets/KXBTC15M-X');assert.equal(calls.length,2);
  await reader.get('/markets?status=open');await reader.get('/markets?status=open');assert.equal(calls.length,4);
});
test('queue prioritizes live discovery over queued settlement work',async()=>{
  let release;const order=[];const now=Date.now();
  const reader=createKalshiReader({intervalMs:0,fetchImpl:async url=>{
    order.push(url.split('/v2')[1]);if(order.length===1)await new Promise(r=>{release=r;});
    return {ok:true,status:200,json:async()=>({markets:[]})};}});
  const jobs=[reader.get('/markets/KXBTC15M-FIRST'),reader.get('/markets/KXBTC15M-SECOND'),
    reader.get('/markets?status=open')];release();await Promise.all(jobs);
  assert.deepEqual(order,['/markets/KXBTC15M-FIRST','/markets?status=open','/markets/KXBTC15M-SECOND']);
  assert.ok(Date.now()-now<1000);
});
test('reader cannot issue account, order, cross-origin or malformed paths',async()=>{
  const {reader,calls}=harness();
  for(const path of ['/portfolio/orders','https://example.com/markets','/markets/../portfolio/orders'])
    await assert.rejects(reader.get(path));
  assert.equal(calls.length,0);
});
