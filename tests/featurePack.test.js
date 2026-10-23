
const test=require('node:test'); const assert=require('node:assert/strict');
process.env.JWT_SECRET='test-secret-test-secret-test-secret-1234';
process.env.OPENROUTER_API_KEY=''; process.env.OPENAI_API_KEY=''; // empty (not deleted) so dotenv cannot repopulate a real key during tests
const fp=require('../server/routes/featurePack');
const jwt=require('../server/node_modules/jsonwebtoken');
function reqRes(){ return null; }
test('filterRecords search/filter preserves false/0/empty',()=>{
  const recs=[{title:'Alpha report',description:'',status:'todo',priority:'high',category:'a',completed:false,score:0},{title:'Beta',description:'x',status:'done',priority:'low',category:'b',completed:true,score:5}];
  assert.equal(fp.filterRecords(recs,{q:'alpha'}).length,1);
  assert.equal(fp.filterRecords(recs,{status:'done'}).length,1);
  assert.equal(fp.filterRecords(recs,{q:'alpha'})[0].score,0);
  assert.equal(fp.filterRecords(recs,{q:'alpha'})[0].completed,false);
});
test('toCSV header and falsy preserved',()=>{ const csv=fp.toCSV([{id:1,title:'A',description:'',status:'todo',priority:'medium',category:'',dueDate:null,completed:false,score:0,createdAt:'t',updatedAt:'t'}]); assert.ok(csv.startsWith('id,title')); assert.ok(csv.includes('false,0')); });
test('domain AI fallback labelled aiGenerated:false with sections',()=>{
  const names=Object.keys(fp.aiFeatures); assert.ok(names.length>=2 && names.length<=3);
  for(const n of names){ const out=fp.aiFeatures[n]({title:'T',description:'',completed:false,score:0}); assert.equal(out.aiGenerated,false); assert.ok(out.label.includes('Deterministic fallback')); assert.ok(out.sections.length>=1); assert.ok(out.sections.every(s=>s.title&&s.content!==undefined)); }
});
test('tasks CRUD + search + export via HTTP requires auth', async ()=>{
  const express=require('../server/node_modules/express'); const app=express(); app.use(express.json());
  let authMod=null; try{ authMod=require('../server/routes/featurePack'); }catch(e){}
  app.use('/api/feature-pack', authMod ? fp.createRouter(authMod) : fp);
  const srv=await new Promise(r=>{ const s=app.listen(0,()=>r(s)); });
  const base=`http://127.0.0.1:${srv.address().port}/api/feature-pack`;
  try{
    assert.equal((await fetch(base+'/tasks')).status,401);
    const token=jwt.sign({id:7,userId:7},process.env.JWT_SECRET); const h={Authorization:'Bearer '+token,'Content-Type':'application/json'};
    const created=await (await fetch(base+'/tasks',{method:'POST',headers:h,body:JSON.stringify({title:'Alpha task',score:0,completed:false})})).json();
    assert.equal(created.title,'Alpha task'); assert.equal(created.score,0);
    const list=await (await fetch(base+'/tasks?q=alpha',{headers:h})).json(); assert.equal(list.total,1);
    const upd=await (await fetch(base+'/tasks/'+created.id,{method:'PUT',headers:h,body:JSON.stringify({status:'done'})})).json(); assert.equal(upd.status,'done');
    const csv=await (await fetch(base+'/tasks/export?format=csv',{headers:h})).text(); assert.ok(csv.includes('Alpha task'));
    const jsonExp=await (await fetch(base+'/tasks/export?format=json',{headers:h})).json(); assert.equal(jsonExp.total,1);
    const ai=await (await fetch(base+'/ai/'+Object.keys(fp.aiFeatures)[0],{method:'POST',headers:h,body:JSON.stringify({title:'Alpha task',score:0,completed:false,description:''})})).json(); assert.equal(ai.aiGenerated,false);
  } finally { srv.close(); }
});
