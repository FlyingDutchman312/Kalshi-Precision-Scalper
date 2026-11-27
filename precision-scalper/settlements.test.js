'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSettlementRefresher}=require('./settlements');
test('one official market read updates matching pending rows in every table',async()=>{
  const reads=[],writes=[];const ticker='KXBTC15M-X';
  const svc=createSettlementRefresher({tables:['observations','probability','strategies'],
    db:async(path,method,body,table)=>{if(method==='GET')return [{ticker},{ticker}];writes.push({path,body,table});},
    get:async path=>{reads.push(path);return {market:{ticker,status:'finalized',result:'yes'}};}});
  const result=await svc.refresh();assert.equal(reads.length,1);assert.equal(writes.length,3);
  assert.equal(result.settled,1);assert.equal(result.error,null);
});
test('unfinalized or mismatched ticker never writes an outcome',async()=>{
  let writes=0;let response={market:{ticker:'KXBTC15M-X',status:'closed',result:'yes'}};
  const svc=createSettlementRefresher({tables:['observations'],
    db:async(_path,method)=>{if(method==='GET')return [{ticker:'KXBTC15M-X'}];writes++;},get:async()=>response});
  await svc.refresh();response={market:{ticker:'KXBTC15M-OTHER',status:'finalized',result:'yes'}};
  await svc.refresh();assert.equal(writes,0);
});
test('one rate limit stops the settlement pass instead of hammering the rest',async()=>{
  let calls=0;const error=Object.assign(Error('Kalshi HTTP 429'),{code:'KALSHI_RATE_LIMIT'});
  const svc=createSettlementRefresher({tables:['observations'],
    db:async()=>[{ticker:'KXBTC15M-A'},{ticker:'KXBTC15M-B'}],get:async()=>{calls++;throw error;}});
  assert.equal((await svc.refresh()).error,'Kalshi HTTP 429');assert.equal(calls,1);
});
test('bounded passes rotate unfinished tickers and recover failed database writes',async()=>{
  let time=1000,fail=true;const calls=[],writes=[];
  const svc=createSettlementRefresher({tables:['observations'],maxMarkets:1,now:()=>time,
    db:async(_path,method,body)=>{if(method==='GET')return [{ticker:'KXBTC15M-A'},{ticker:'KXBTC15M-B'}];
      if(fail){fail=false;throw Error('Database HTTP 503');}writes.push(body);},
    get:async path=>{const ticker=path.split('/').at(-1);calls.push(ticker);return {market:{ticker,status:'finalized',result:'no'}};}});
  assert.match((await svc.refresh()).error,/503/);time+=1000;await svc.refresh();time+=1000;await svc.refresh();
  assert.deepEqual(calls,['KXBTC15M-A','KXBTC15M-B','KXBTC15M-A']);assert.equal(writes.length,2);
});
