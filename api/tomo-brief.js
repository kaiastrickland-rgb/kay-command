// Public, strictly limited no-login status for Tomo's daily coaching.
// Never return task names, user identity, notes, private projects, or write access.
const PROJECT_ID='068a92e2-9c66-4197-a71b-9bfd12002a0d';
const ITEMS=[
  {id:'body',label:'BODY',display:'10–20 minutes of movement',name:'Body — Start small, consistent movement'},
  {id:'space',label:'SPACE',display:'15 minutes clearing the bedroom or organizing shoes',name:'Week 1 — Reclaim the bedroom floor and shoe zone'},
  {id:'future',label:'FUTURE',display:'20 minutes on career or a home project',name:'Career — Three focused job-search blocks weekly'}
];
export default async function handler(req,res){
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=60');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Access-Control-Allow-Origin','https://kay-command.vercel.app');
  if(req.method!=='GET') return res.status(405).json({error:'Read-only'});
  const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,KAY_USER_ID}=process.env;
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!KAY_USER_ID) return res.status(503).json({error:'Status unavailable'});
  try{
    const url=new URL(SUPABASE_URL+'/rest/v1/kay_tasks');
    url.searchParams.set('select','name,is_done,due_date');
    url.searchParams.set('user_id','eq.'+KAY_USER_ID);
    url.searchParams.set('project_id','eq.'+PROJECT_ID);
    url.searchParams.set('name','in.('+ITEMS.map(x=>'"'+x.name.replace(/"/g,'')+'"').join(',')+')');
    const response=await fetch(url,{headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY}});
    if(!response.ok) throw new Error('Database unavailable');
    const rows=await response.json();
    const status=new Map(rows.map(x=>[x.name,x]));
    return res.status(200).json({
      source:'Kay Command — Kay 2.0',
      read_only:true,
      generated_at:new Date().toISOString(),
      tasks:ITEMS.map(item=>({
        id:item.id,category:item.label,action:item.display,
        completed_milestone:status.has(item.name)?!!status.get(item.name).is_done:null,
        target_date:status.get(item.name)?.due_date||null
      })),
      note:'Daily actions are small steps. Milestone completion is not the same as completion of today’s action. This public view excludes private task titles, medical details, finances and write actions.'
    });
  }catch(error){
    console.error('Public Tomo brief unavailable',error.message);
    return res.status(503).json({error:'Status temporarily unavailable'});
  }
}
