const policies={baseline:{min:.90,max:.96,window:180,prob:null},aggressive:{min:.85,max:.90,window:180,prob:.92},balanced:{min:.90,max:.94,window:120,prob:.96},conservative:{min:.95,max:.97,window:60,prob:.99}};
function assess(m,model,now=Date.now()){
 const seconds=(Date.parse(m?.close)-now)/1000, age=now-Date.parse(m?.at), result={};
 for(const [strategy,p] of Object.entries(policies)){
  let reason='PRICE / SPREAD'; let candidate=null;
  if(!m?.ticker||!Number.isFinite(age)||age<0||age>12000||['ERROR','INACTIVE','CLOSED','NO OPEN MARKET'].includes(m.status))reason='MARKET UNAVAILABLE';
  else if(!(seconds>=15&&seconds<=p.window))reason='OUTSIDE WINDOW';
  else {const q=(m.sides||[]).find(q=>Number.isFinite(q.ask)&&Number.isFinite(q.bid)&&q.bid>0&&q.ask>=q.bid&&q.ask>=p.min&&q.ask<=p.max&&q.ask-q.bid<=.020000001);if(q){const ma=now-Date.parse(model?.at),sa=now-model?.spotAt;const valid=model?.ticker===m.ticker&&model.status==='UNVALIDATED PROXY'&&ma>=0&&ma<=12000&&sa>=-2000&&sa<=12000&&Number.isFinite(model.pYes)&&model.pYes>=0&&model.pYes<=1;const probability=valid?(q.side==='yes'?model.pYes:1-model.pYes):null;
  if(p.prob!==null&&probability===null)reason='MODEL UNAVAILABLE';else if(p.prob!==null&&probability<p.prob)reason='MODEL THRESHOLD';else {reason='OBSERVED';candidate={strategy,ticker:m.ticker,side:q.side,ask:q.ask,bid:q.bid,seconds_left:seconds,observed_at:new Date(now).toISOString(),close_at:m.close,model_probability:probability,source:valid?model.source:null,quote_at:m.at};}}}
  result[strategy]={reason,candidate};
 }return result;
}
module.exports={policies,assess};
