const {test}=require('node:test');const assert=require('node:assert/strict');const {scenario,report}=require('./economics');const {validate}=require('./proxy');
test('budget includes fee and loss',()=>{const r=scenario({ask:.96,side:'yes',result:'no'});assert.equal(r.contracts,5);assert.ok(r.cost<=5);assert.equal(r.pnl,-r.cost);});
test('pending is not a loss',()=>assert.equal(scenario({ask:.9,side:'no'}).pnl,null));
test('drawdown and wins',()=>{const r=report([{ticker:'a',ask:.9,side:'yes',result:'yes'},{ticker:'b',ask:.9,side:'yes',result:'no'}]);assert.equal(r.win,1);assert.ok(r.net<0);assert.ok(r.drawdown>4);});
test('reject stale proxy',()=>assert.throws(()=>validate(100,1000,'x',14000)));
