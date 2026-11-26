const {scenario}=require('./economics');
function diagnostics(rows){
 const settled=rows.map(r=>scenario(r)).filter(r=>r&&r.pnl!==null);
 const bins=[[0,.85],[.85,.90],[.90,.95],[.95,.98],[.98,1]].map(([lo,hi])=>{
 const a=settled.filter(r=>Number.isFinite(r.model_probability)&&r.model_probability>=lo&&(r.model_probability<hi||hi===1&&r.model_probability===1));
 const avg=f=>a.length?a.reduce((s,r)=>s+f(r),0)/a.length:null;
 return {label:`${Math.round(lo*100)}–${Math.round(hi*100)}%`,n:a.length,mean:avg(r=>r.model_probability),winRate:avg(r=>+(r.side===r.result)),brier:avg(r=>(r.model_probability-+(r.side===r.result))**2),edge:avg(r=>r.model_probability-r.breakEven)};
 });
 const groups=new Map();for(const r of settled){const t=Date.parse(r.close_at);if(!Number.isFinite(t))continue;const g=groups.get(t)||{cost:0,net:0};g.cost+=r.cost;g.net+=r.pnl;groups.set(t,g);}
 const g=[...groups.values()];return {bins,exposure:{groups:g.length,maxCost:g.length?Math.max(...g.map(x=>x.cost)):null,worstNet:g.length?Math.min(...g.map(x=>x.net)):null}};
}
module.exports={diagnostics};
