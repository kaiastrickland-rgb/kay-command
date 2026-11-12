// Kay Command: authenticated Tomo project/task management API.
// Scoped to Kay's project-management records, never arbitrary database tables.
// TOMO_FEED_TOKEN is a private server-side credential; do not put it in a chat.
const RESOURCE = {
  projects: { table: 'kay_projects',
    read: ['id','name','workspace','type','status','target_date','next_move','sort_order','created_at','updated_at'],
    create: ['name','workspace','type','status','target_date','next_move','sort_order'],
    update: ['name','workspace','type','status','target_date','next_move','sort_order'] },
  tasks: { table: 'kay_tasks',
    read: ['id','project_id','name','details','owner','due_date','is_done','created_at','updated_at'],
    create: ['project_id','name','details','owner','due_date','is_done'],
    update: ['project_id','name','details','owner','due_date','is_done'] },
  plans: { table: 'kay_project_plans',
    read: ['id','project_id','name','source_name','source_type','summary','created_at','updated_at'],
    create: ['project_id','name','source_name','source_type','summary'],
    update: ['name','summary','source_name','source_type'] },
  plan_tasks: { table: 'kay_project_plan_tasks',
    read: ['id','project_id','plan_id','name','phase','category','owner','due_date','status','priority','notes','is_done','progress_fraction','created_at','updated_at'],
    create: ['project_id','plan_id','name','phase','category','owner','due_date','status','priority','notes','is_done','progress_fraction'],
    update: ['name','phase','category','owner','due_date','status','priority','notes','is_done','progress_fraction'] },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const requiredEnv=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TOMO_FEED_TOKEN','KAY_USER_ID'];
function validDate(v){return v===null || (typeof v==='string' && DATE.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z')));}
function allowedPatch(input, keys){
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Expected a field object');
  const extra=Object.keys(input).filter(k=>!keys.includes(k));
  if(extra.length) throw new Error('Unsupported fields: '+extra.join(', '));
  if(!Object.keys(input).length) throw new Error('No fields provided');
  for (const [key,val] of Object.entries(input)) {
    if(key.endsWith('_date') && !validDate(val)) throw new Error('Invalid date: '+key);
    if(['is_done'].includes(key) && typeof val!=='boolean') throw new Error('Expected boolean: '+key);
    if(['sort_order'].includes(key) && (!Number.isInteger(val) || val<0)) throw new Error('Invalid sort order');
    if(['progress_fraction'].includes(key) && (typeof val!=='number' || val<0 || val>1)) throw new Error('progress_fraction must be 0..1');
    if(typeof val==='string' && val.length>5000) throw new Error('Field too long: '+key);
    if(['project_id','plan_id'].includes(key) && !UUID.test(String(val))) throw new Error('Invalid id: '+key);
  }
  return input;
}
async function db(table,method,{id,fields,order,limit}={}){
 const u=new URL(process.env.SUPABASE_URL+'/rest/v1/'+table);
 u.searchParams.set('user_id','eq.'+process.env.KAY_USER_ID);
 if(id) u.searchParams.set('id','eq.'+id);
 if(order) u.searchParams.set('order',order);
 if(limit) u.searchParams.set('limit',String(limit));
 const resp=await fetch(u,{
  method,
  headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,
   'Content-Type':'application/json',Prefer:'return=representation'},
  body:fields===undefined?undefined:JSON.stringify(fields)
 });
 if(!resp.ok) throw new Error('Data request failed ('+resp.status+')');
 return resp.json();
}
async function existing(resource,id){
 const items=await db(RESOURCE[resource].table,'GET',{id,limit:1});
 return items[0]||null;
}
async function projectOwned(id){
 if(!UUID.test(String(id))) throw new Error('Invalid project ID');
 if(!await existing('projects',id)) throw new Error('Project not found');
}
async function planOwned(id,projectId){
 if(!UUID.test(String(id))) throw new Error('Invalid plan ID');
 const plan=await existing('plans',id);
 if(!plan || (projectId && plan.project_id!==projectId)) throw new Error('Plan not found in project');
}
async function audit(resource,action,id,previous,current){
 // Best-effort audit, never permit arbitrary user content to become an instruction.
 try {
  const msg=JSON.stringify({origin:'Tomo',resource,action,record_id:id,
    before:previous?{name:previous.name,due_date:previous.due_date,is_done:previous.is_done,status:previous.status}:null,
    after:current?{name:current.name,due_date:current.due_date,is_done:current.is_done,status:current.status}:null}).slice(0,4500);
  const resp=await fetch(process.env.SUPABASE_URL+'/rest/v1/kay_task_updates',{
   method:'POST',
   headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,
     'Content-Type':'application/json',Prefer:'return=minimal'},
   body:JSON.stringify({user_id:process.env.KAY_USER_ID,task_id:resource==='tasks'?id:null,
    project_id:current?.project_id||previous?.project_id||(resource==='projects'?id:null),
    action_type:'tomo_'+action,message:msg,status:'applied',processed_at:new Date().toISOString()})
  });
  if(!resp.ok) console.error('Tomo audit write failed',resp.status);
 }catch(e){console.error('Tomo audit write failed',e.message);}
}
async function tomoAuthorized(req) {
  const auth = req.headers.authorization || '';
  if (auth === 'Bearer ' + process.env.TOMO_FEED_TOKEN) return true;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return false;
  try {
    const response = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + match[1]
      }
    });
    if (!response.ok) return false;
    const user = await response.json();
    return !!user?.id && user.id === process.env.KAY_USER_ID && !!user.email_confirmed_at;
  } catch (_) {
    return false;
  }
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(requiredEnv.some(k=>!process.env[k])) return res.status(503).json({error:'Service unavailable'});
 // Owner authorized no-login Tomo workspace. Restrict to project/task resources listed above.
 const resource=String(req.query?.resource||'');
 const def=RESOURCE[resource];
 if(!def) return res.status(400).json({error:'Invalid resource',allowed:Object.keys(RESOURCE)});
 const id=req.query?.id||req.body?.id;
 if(id && !UUID.test(String(id))) return res.status(400).json({error:'Invalid record ID'});
 if(!['GET','POST','PATCH','DELETE'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
 try {
  if(req.method==='GET'){
   const rows=await db(def.table,'GET',{id,order:'created_at.desc',limit:id?1:500});
   return res.status(200).json({resource,rows:rows.map(row=>Object.fromEntries(def.read.filter(k=>k in row).map(k=>[k,row[k]])))});
  }
  if(req.method==='POST'){
   const fields=validFields(req.body?.fields,def.create);
   if(['tasks','plans','plan_tasks'].includes(resource)) await projectOwned(fields.project_id);
   if(resource==='plan_tasks') await planOwned(fields.plan_id,fields.project_id);
   if(!fields.name || !String(fields.name).trim()) return res.status(400).json({error:'Name required'});
   if(resource==='projects' && !fields.status) fields.status='Active';
   if(resource==='tasks' || resource==='plan_tasks') fields.is_done=fields.is_done??false;
   const rows=await db(def.table,'POST',{fields:{...fields,user_id:process.env.KAY_USER_ID}});
   const row=rows[0]; if(!row) throw new Error('Create returned no record');
   await audit(resource,'create',row.id,null,row);
   return res.status(201).json({ok:true,row});
  }
  if(!id) return res.status(400).json({error:'Record ID required'});
  const old=await existing(resource,id);
  if(!old) return res.status(404).json({error:'Record not found'});
  if(req.method==='PATCH'){
   const fields=validFields(req.body?.fields,def.update);
   if(resource==='tasks' && fields.project_id) await projectOwned(fields.project_id);
   if(resource==='plan_tasks' && 'is_done' in fields && !('status' in fields)) fields.status=fields.is_done?'Complete':'Open';
   const rows=await db(def.table,'PATCH',{id,fields:{...fields,updated_at:new Date().toISOString()}});
   const row=rows[0]; if(!row) throw new Error('Update returned no record');
   await audit(resource,'update',id,old,row);
   return res.status(200).json({ok:true,row});
  }
  // Explicit delete request flag protects against accidental destructive commands.
  if(req.body?.confirm_delete!==true) return res.status(400).json({error:'confirm_delete:true required'});
  // Avoid cascading destruction: preserve projects/plans with children.
  if(resource==='projects' || resource==='plans') return res.status(400).json({error:'Archive project or preserve plan instead of permanent deletion'});
  await audit(resource,'delete',id,old,null);
  await db(def.table,'DELETE',{id});
  return res.status(200).json({ok:true,deleted_id:id});
 }catch(e){
  console.error('Tomo command operation error',e.message);
  return res.status(400).json({error:e.message});
 }
}
function validFields(obj,keys){return allowedPatch(obj,keys);}
