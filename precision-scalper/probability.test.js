const test=require('node:test'),assert=require('node:assert/strict');const {estimate,checkpoint}=require('./probability');const now=Date.now();const s=Array.from({length:25},(_,i)=>({at:now-(24-i)*5000,price:100+i*.001,source:'test'}));
test('direction and symmetry',()=>{const up=estimate(s,99,now+120000,now),down=estimate(s,101,now+120000,now);assert.ok(up.pYes>.5);assert.ok(down.pYes<.5);});
test('missing and stale data fail closed',()=>{assert.equal(estimate([],100,now+60000,now),null);assert.equal(estimate(s,100,now+60000,now+20000),null);assert.equal(estimate(s,NaN,now+60000,now),null);});
test('partial average and checkpoints',()=>{assert.ok(estimate(s,100,now+30000,now));assert.equal(checkpoint(175),180);assert.equal(checkpoint(140),null);assert.equal(checkpoint(25),30);});
