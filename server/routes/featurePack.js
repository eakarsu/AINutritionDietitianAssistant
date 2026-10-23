
const express=require('express');
let jwt; try{jwt=require('jsonwebtoken')}catch(e){}
function fallbackAuth(req,res,next){
  if(req.user||req.userId) return next();
  const secret=process.env.JWT_SECRET;
  if(!secret) return res.status(500).json({error:'Authentication is not configured'});
  const token=req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'Authentication required'});
  try{ const d=jwt.verify(token,secret); req.user=d; req.userId=d.userId||d.id; next(); }catch{ return res.status(401).json({error:'Invalid token'}); }
}
function ownerOf(req){ const u=req.user||{}; return String(u.id||u.userId||req.userId||u.email||u.sub||'user'); }
const COLS=['id','title','description','status','priority','category','dueDate','completed','score','createdAt','updatedAt'];
function esc(v){ if(v===null||v===undefined) return ''; const s=String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCSV(records){ return [COLS.join(','), ...records.map(r=>COLS.map(c=>esc(r[c])).join(','))].join('\n'); }
function filterRecords(records,{q,search,status,priority,category,completed}={}){
  const term=String(q||search||'').toLowerCase().trim();
  return records.filter(r=>{
    if(status && String(r.status)!==String(status)) return false;
    if(priority && String(r.priority)!==String(priority)) return false;
    if(category && String(r.category)!==String(category)) return false;
    if(completed!==undefined && completed!=='' && String(r.completed)!==String(completed)) return false;
    if(!term) return true;
    return [r.title,r.description,r.status,r.priority,r.category,r.notes].map(v=>v===null||v===undefined?'':String(v).toLowerCase()).join(' ').includes(term);
  });
}
function createStore(){
  let seq=1; const items=[];
  return {
    list(owner){ return items.filter(x=>x.owner===owner); },
    create(owner,data){ if(!data||!String(data.title||'').trim()) { const e=new Error('title is required'); e.status=400; throw e; }
      const now=new Date().toISOString();
      const rec={id:seq++, title:String(data.title), description:data.description||'', status:data.status||'todo', priority:data.priority||'medium', category:data.category||'', dueDate:data.dueDate||null, completed:data.completed===true||data.completed==='true'?true:false, score:(data.score===0||data.score)?data.score:0, notes:data.notes||'', owner, createdAt:now, updatedAt:now};
      items.push(rec); return rec; },
    update(owner,id,data){ const rec=items.find(x=>x.id===Number(id)&&x.owner===owner); if(!rec) return null;
      for(const k of ['title','description','status','priority','category','dueDate','completed','score','notes']) if(data[k]!==undefined) rec[k]=data[k];
      rec.updatedAt=new Date().toISOString(); return rec; },
    all:items
  };
}
const store=createStore();
function hasProvider(){ return !!(process.env.OPENROUTER_API_KEY||process.env.OPENAI_API_KEY); }
async function tryProvider(prompt){
  if(!hasProvider()) return null;
  try{
    const isOR=!!process.env.OPENROUTER_API_KEY;
    const url=isOR?'https://openrouter.ai/api/v1/chat/completions':'https://api.openai.com/v1/chat/completions';
    const key=isOR?process.env.OPENROUTER_API_KEY:process.env.OPENAI_API_KEY;
    const model=process.env.OPENROUTER_MODEL||process.env.OPENAI_MODEL||(isOR?'openai/gpt-4o-mini':'gpt-4o-mini');
    const resp=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],max_tokens:500})});
    if(!resp.ok) return null;
    const data=await resp.json(); const text=data?.choices?.[0]?.message?.content; return text||null;
  }catch{ return null; }
}
function labelled(feature,record,sections){
  return {aiGenerated:false, provider:null, label:'Deterministic fallback — no AI provider configured', feature, sections, record:{...record}};
}
const aiFeatures={
 'meal-plan-balance': (r)=>labelled('meal-plan-balance', r, [
  {title:'Meal-plan balance', content:`Plan/task: ${r.title||''} category=${r.category||''}. Balance protein, fibre, hydration across day.`},
  {title:'Preserved fields', content:`completed=${r.completed} score=${r.score} description=${r.description||''}`},
 ]),
 'nutrient-gap-summary': (r)=>labelled('nutrient-gap-summary', r, [
  {title:'Nutrient gap summary', content:`For ${r.title||''}: flag gaps when score=${r.score} is 0/low; notes=${r.notes||''}.`},
  {title:'Next step', content:`Add one nutrient-dense option; do not remove empty fields.`},
 ]),
 'hydration-reminder-plan': (r)=>labelled('hydration-reminder-plan', r, [
  {title:'Hydration reminder plan', content:`Status ${r.status||'todo'} priority ${r.priority||'medium'} for ${r.title||''}. Schedule reminders around meals.`},
  {title:'Evidence', content:`dueDate=${r.dueDate||''} completed=${r.completed}`},
 ]),
};
function createRouter(auth){
  const router=express.Router(); const authenticate=auth||fallbackAuth;
  router.use(authenticate);
  router.get('/tasks',(req,res)=>{ const data=filterRecords(store.list(ownerOf(req)),req.query); res.json({data,total:data.length}); });
  router.get('/search',(req,res)=>{ const data=filterRecords(store.list(ownerOf(req)),req.query); res.json({data,total:data.length}); });
  router.get('/tasks/export',(req,res)=>{
    const data=filterRecords(store.list(ownerOf(req)),req.query); const fmt=String(req.query.format||'json').toLowerCase();
    if(fmt==='csv'){ res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="tasks-export.csv"'); return res.send(toCSV(data)); }
    if(fmt==='json'){ res.setHeader('Content-Disposition','attachment; filename="tasks-export.json"'); return res.json({data,total:data.length}); }
    return res.status(400).json({error:'format must be csv or json'});
  });
  router.get('/export',(req,res)=>{ req.url='/tasks/export'; router.handle(req,res,()=>{}); });
  router.post('/tasks',(req,res)=>{ try{ res.status(201).json(store.create(ownerOf(req),req.body||{})); }catch(e){ res.status(e.status||400).json({error:e.message}); } });
  router.put('/tasks/:id',(req,res)=>{ const rec=store.update(ownerOf(req),req.params.id,req.body||{}); if(!rec) return res.status(404).json({error:'Not found'}); res.json(rec); });
  // domain AI over own records (tasks above)
  for(const [name,fn] of Object.entries(aiFeatures)){
    router.post('/ai/'+name, async (req,res)=>{
      const record=(req.body&&req.body.record)||req.body||{};
      // preserve false/0/empty by not filtering record fields
      const result=fn(record);
      const text=await tryProvider(`Feature ${name}: ${JSON.stringify(record)}`);
      if(text) return res.json({aiGenerated:true, provider:process.env.OPENROUTER_API_KEY?'openrouter':'openai', label:'AI-generated', feature:name, sections:[{title:name,content:text}], record:{...record}});
      res.json(result);
    });
  }
  return router;
}
const router=createRouter();
module.exports=router;
module.exports.createRouter=createRouter; module.exports.filterRecords=filterRecords; module.exports.toCSV=toCSV; module.exports.createStore=createStore; module.exports.aiFeatures=aiFeatures; module.exports.store=store;
