'use strict';

// Fetch a ticker once, then apply its official result to all research tables.
// Bounded work and a rotating attempt order keep catch-up behind live discovery.
function createSettlementRefresher({db,get,tables,now=Date.now,maxMarkets=20}) {
  let busy=false;
  const attempted=new Map();
  const state={lastCheckedAt:null,lastCompletedAt:null,checked:0,settled:0,error:null};
  async function refresh() {
    if(busy)return;busy=true;state.lastCheckedAt=new Date(now()).toISOString();
    let checked=0,settled=0;
    const errors=[];
    try {
      const candidates=new Map();
      for(const table of tables) {
        const rows=await db('?result=is.null&close_at=lt.'+encodeURIComponent(new Date(now()).toISOString())+
          '&order=close_at.asc&limit=100','GET',null,table);
        for(const row of rows) {
          if(typeof row.ticker!=='string'||!/^KX[A-Z0-9-]+$/.test(row.ticker))continue;
          if(!candidates.has(row.ticker))candidates.set(row.ticker,new Set());
          candidates.get(row.ticker).add(table);
        }
      }
      for(const ticker of attempted.keys())if(!candidates.has(ticker))attempted.delete(ticker);
      const entries=[...candidates].sort(([a],[b])=>(attempted.get(a)||0)-(attempted.get(b)||0));
      for(const [ticker,targetTables] of entries.slice(0,maxMarkets)) {
        attempted.set(ticker,now());
        try {
          const {market}=await get('/markets/'+encodeURIComponent(ticker));checked++;
          if(market?.ticker!==ticker||market.status!=='finalized'||!['yes','no'].includes(market.result))continue;
          for(const table of targetTables)await db('?ticker=eq.'+encodeURIComponent(ticker),'PATCH',
            {result:market.result,settled_at:new Date(now()).toISOString()},table);
          settled++;
        } catch(e) {
          errors.push(e.message);
          if(e.code==='KALSHI_RATE_LIMIT')break;
        }
      }
      state.lastCompletedAt=new Date(now()).toISOString();
    } catch(e) {errors.push(e.message);}
    finally {
      state.checked=checked;state.settled=settled;state.error=[...new Set(errors)].join('; ')||null;
      busy=false;
    }
    return {...state};
  }
  return {refresh,status:()=>({...state,busy})};
}
module.exports={createSettlementRefresher};
