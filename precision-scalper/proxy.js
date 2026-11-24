async function readSpot(symbol){
 const bnb=symbol==='BNB';
 const endpoint=bnb?'https://api.binance.us/api/v3/trades?symbol=BNBUSD&limit=1':`https://api.exchange.coinbase.com/products/${symbol}-USD/ticker`;
 const r=await fetch(endpoint,{headers:{Accept:'application/json','User-Agent':'PrecisionScalperResearch/1.1'},signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Spot HTTP '+r.status);
 const j=await r.json();const item=bnb?j[0]:j;const at=bnb?Number(item.time):Date.parse(item.time);const price=Number(item.price);
 if(!Number.isFinite(at)||Date.now()-at>12000||at>Date.now()+2000||!Number.isFinite(price)||price<=0)throw Error('Stale or invalid spot proxy');
 return {at,price,source:bnb?'Binance.US BNB-USD':'Coinbase Exchange USD'};
}
module.exports={readSpot};
