const MODEL='proxy-average-v1';
const checkpoints=[180,120,60,30];
function normal(x){const t=1/(1+0.2316419*Math.abs(x));const a=1-Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?a:1-a;}
function estimate(samples,target,close,now){
 if(!Number.isFinite(target)||target<=0||!Number.isFinite(close)||close<=now)return null;
 const s=samples.filter(x=>x.at<=now&&x.at>=now-180000&&Number.isFinite(x.price)&&x.price>0).sort((a,b)=>a.at-b.at);
 if(s.length<12||now-s.at(-1).at>12000||s.at(-1).at-s[0].at<60000)return null;
 let sum=0,n=0;for(let i=1;i<s.length;i++){const dt=(s[i].at-s[i-1].at)/1000;if(dt>0&&dt<=12){sum+=Math.log(s[i].price/s[i-1].price)**2/dt;n++;}}
 if(n<10)return null;
 const spot=s.at(-1).price, remaining=(close-now)/1000, known=Math.max(0,60-remaining), future=60-known;
 const observed=s.filter(x=>x.at>=close-60000);
 if(known>0&&(observed.length<Math.max(1,Math.floor(known/8))||observed[0].at>close-60000+12000||observed.some((x,i)=>i&&x.at-observed[i-1].at>12000)))return null;
 const avg=known?observed.reduce((a,x)=>a+x.price,0)/observed.length:spot;
 const projected=(known*avg+future*spot)/60;
 // Zero-drift Brownian proxy; extra 5 bp basis floor is a fixed assumption, not calibrated.
 const variance=spot**2*Math.max(sum/n,1e-12)*(future/60)**2*(Math.max(0,remaining-60)+future/3);
 const sigma=Math.sqrt(variance+(spot*0.0005)**2);
 const p=Math.max(.001,Math.min(.999,normal((projected-target)/sigma)));
 return {model:MODEL,spot,target,cushion:spot-target,volatility:Math.sqrt(sum/n),projected,sigma,pYes:p,source:s.at(-1).source,spotAt:s.at(-1).at};
}
function checkpoint(seconds){return checkpoints.find(x=>seconds<=x&&seconds>x-12)??null;}
module.exports={estimate,checkpoint,MODEL};
