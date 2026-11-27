'use strict';

// One public GET queue for discovery and settlement. No account/order access.
function createKalshiReader({fetchImpl=fetch, now=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), random=Math.random,
  intervalMs=1000, backoffBaseMs=10000, backoffMaxMs=120000}={}) {
  const base='https://external-api.kalshi.com/trade-api/v2';
  const pending=new Map(), cache=new Map(), queue=[];
  const counters={requests:0,rateLimited:0,cacheHits:0,coalesced:0,deferred:0};
  let running=false, nextRequestAt=0, blockedUntil=0, strikes=0;
  let lastRateLimitAt=null, lastSuccessAt=null;
  function limited() {
    const e=new Error('Kalshi HTTP 429; shared backoff active');
    e.code='KALSHI_RATE_LIMIT';e.retryAt=new Date(blockedUntil).toISOString();return e;
  }
  async function drain() {
    if(running)return;running=true;
    try {
      while(queue.length) {
        queue.sort((a,b)=>a.priority-b.priority||a.created-b.created);
        const job=queue.shift();
        try {
          if(now()<blockedUntil){counters.deferred++;throw limited();}
          const wait=Math.max(0,nextRequestAt-now());
          if(wait)await sleep(wait);
          if(now()<blockedUntil){counters.deferred++;throw limited();}
          if(now()-job.created>job.maxQueueMs)throw Error('Kalshi read expired in queue');
          nextRequestAt=now()+intervalMs;counters.requests++;
          const response=await fetchImpl(base+job.path,{
            headers:{Accept:'application/json','User-Agent':'PrecisionScalperResearch/1.4.1'},
            signal:AbortSignal.timeout(8000)});
          if(response.status===429) {
            counters.rateLimited++;strikes++;
            // Kalshi normally omits Retry-After. Respect it if a proxy supplies it.
            const retry=response.headers?.get('retry-after');
            const retryMs=retry==null?0:Number.isFinite(Number(retry))?
              Number(retry)*1000:Math.max(0,Date.parse(retry)-now())||0;
            const reset=Number(response.headers?.get('x-ratelimit-reset'))*1000;
            const exponential=Math.min(backoffMaxMs,backoffBaseMs*2**Math.min(strikes-1,10));
            blockedUntil=now()+Math.max(exponential+random()*1000,retryMs,Number.isFinite(reset)?reset:0);
            lastRateLimitAt=new Date(now()).toISOString();
            throw limited();
          }
          if(!response.ok)throw Error(`Kalshi HTTP ${response.status}`);
          const data=await response.json();
          strikes=0;lastSuccessAt=new Date(now()).toISOString();
          const ttl=data?.market?.status==='finalized'?3600000:job.cacheMs;
          if(ttl>0)cache.set(job.path,{data,expires:now()+ttl});
          job.resolve(data);
        } catch(e) {job.reject(e);}
        finally {pending.delete(job.path);}
      }
    } finally {running=false;}
  }
  function get(path) {
    if(typeof path!=='string'||!/^\/markets(?:\?|\/)[A-Za-z0-9%_=&,.-]+$/.test(path))
      return Promise.reject(Error('Only public market GET paths are allowed'));
    for(const [key,value] of cache)if(value.expires<=now())cache.delete(key);
    const hit=cache.get(path);
    if(hit){counters.cacheHits++;return Promise.resolve(hit.data);}
    if(pending.has(path)){counters.coalesced++;return pending.get(path);}
    if(now()<blockedUntil){counters.deferred++;return Promise.reject(limited());}
    if(queue.length>=80)return Promise.reject(Error('Kalshi read queue full'));
    const detail=path.startsWith('/markets/');
    const promise=new Promise((resolve,reject)=>queue.push({path,resolve,reject,
      created:now(),priority:detail?1:0,maxQueueMs:detail?60000:12000,
      // Live quotes are never served from a cache. Settlement details may be shared.
      cacheMs:detail?60000:0}));
    pending.set(path,promise);void drain();return promise;
  }
  function status(){return {...counters,queued:queue.length,inFlight:pending.size,
    intervalMs,cooldownUntil:now()<blockedUntil?new Date(blockedUntil).toISOString():null,
    lastRateLimitAt,lastSuccessAt};}
  return {get,status};
}
module.exports={createKalshiReader};
