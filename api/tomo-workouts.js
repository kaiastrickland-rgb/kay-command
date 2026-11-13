// Kay 2.0 workout prescription and shared set-by-set performance log.
// Public Tomo route follows the owner's no-login setting. All queries are
// restricted to the known Kay user and to BFL tasks in the reset project.
const PROJECT_ID='068a92e2-9c66-4197-a71b-9bfd12002a0d';
const jsonHeaders={'Content-Type':'application/json'};
function config(){const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,KAY_USER_ID}=process.env;if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!KAY_USER_ID)throw Error('Server config unavailable');return {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,KAY_USER_ID}}
async function request(table,params={},options={}){
 const c=config();
 const url=new URL(c.SUPABASE_URL+'/rest/v1/'+table);
 Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
 const r=await fetch(url,{...options,headers:{apikey:c.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+c.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}});
 if(!r.ok)throw Error('Workout datastore '+r.status+': '+(await r.text()).slice(0,160));
 return await r.json();
}
function prescription(task){
 const name=task.name||'';
 const details=task.details||'';
 const week=Number((name.match(/BFL W(\d+)/)||[])[1]);
 if(!week||week>12)throw Error('Not a scheduled BFL workout');
 const gym=/ GYM$/.test(name);
 const category=gym?'strength':/RECOVERY/.test(name)?'recovery':'cardio';
 let exercises=[];
 if(gym){
  if(/3\) Prescription:\s*EXACT SETS:/i.test(details)){
   const specified=details.match(/3\) Prescription:\s*EXACT SETS:\s*([\s\S]*?)These are the exact prescribed targets/i);
   if(!specified)throw Error('Exact sets prescription incomplete');
   const targets=specified[1].split(';').map(x=>x.trim()).filter(Boolean);
   exercises=targets.map(item=>{
     const match=item.match(/^([^=]+?)\s*=\s*([\s\S]+)$/);
     if(!match)throw Error('Unrecognized exact exercise prescription: '+item);
     const exerciseName=match[1].trim();
     const optional=/\(optional\)/i.test(match[2]);
     const repsText=match[2].replace(/\(optional\)/ig,'').replace(/[.\s]+$/g,'').trim();
     const repTargets=repsText.split('/').map(x=>x.trim()).filter(Boolean);
     if(!exerciseName||!repTargets.length||repTargets.some(x=>!/^\d+(?:\s+per side)?$/i.test(x)))throw Error('Invalid exact reps for '+exerciseName);
     return {name:exerciseName,optional,sets:repTargets.map((target,i)=>({set:i+1,target_reps:target,rest_seconds:'45–90'}))};
   });
   if(exercises.length!==6)throw Error('Exactly six prescribed exercises required');
  }else if(/CANONICAL WORKOUT FOR TOMO, KAY COMMAND AND CHATGPT/i.test(details)){
   // The named canonical workout wins over generic week templates.
   // Parse the actual per-exercise prescription, preserving its exact sets/reps.
   const matcher=/(?:^|\s)([1-6])\)\s*([A-Z][A-Z ]+):\s*([\s\S]*?)(?=\s+[1-6]\)\s*[A-Z][A-Z ]+:|\s+Rest\s+\d|$)/g;
   const blocks=[...details.matchAll(matcher)];
   if(blocks.length!==6)throw Error('Canonical workout has incomplete exercise instructions');
   exercises=blocks.map((block,index)=>{
    const exercise=block[2].trim().toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
    const instruction=block[3];
    let repTargets=[];
    if(index===0){
     const pyramid=instruction.match(/(\d+)\s+sets?\s+of\s+([\d\s/]+)\s+reps/i);
     if(!pyramid)throw Error('Canonical main-lift pyramid missing');
     repTargets=pyramid[2].split('/').map(x=>x.trim()).filter(Boolean);
     if(repTargets.length!==Number(pyramid[1]))throw Error('Canonical pyramid set count does not match the rep sequence');
    }else{
     const amount=instruction.match(/(\d+)\s+sets?\s*[×x]\s*(\d+(?:[–-]\d+)?)\s+reps(\s+per\s+side)?/i);
     if(!amount)throw Error('Canonical accessory set prescription missing: '+exercise);
     repTargets=Array(Number(amount[1])).fill(amount[2]+(amount[3]||''));
    }
    return {name:exercise,optional:/optional/i.test(instruction),
      sets:repTargets.map((reps,i)=>({set:i+1,target_reps:String(reps),rest_seconds:'45–90'}))};
   });
  }else{
   // Deliberately fail closed. Never invent sets from the week number.
   // One source of truth: exact prescription stored with this dated task.
   throw Error('This workout has no exact set-by-set prescription. Please correct the saved Kay Command task.');
  }
 }else{
  exercises=[{name:category==='recovery'?'Recovery walk and mobility':/TREADMILL/.test(name)?'Treadmill walk/run':'Outdoor walk/run',optional:category==='recovery',
    sets:[{set:1,target_reps:'Log actual minutes, RPE and notes',rest_seconds:'As needed'}]}];
 }
 return {task_id:task.id,name:task.name,due_date:task.due_date,week,category,workout_details:details,
   instructions:{warmup:gym?'5 min easy treadmill walk plus movement-specific warm-up':'Follow the warm-up in full workout instructions',rest:gym?'45–75 seconds between sets; up to 90 seconds or longer as needed for form/breathing':'Walk/recover as needed',cooldown:gym?'3–5 min easy walking and gentle stretching':'Follow the cool-down in full workout instructions'},exercises};
}
function optionalNumber(value,field,{min=0,max=1000,integer=false}={}){
 if(value===null||value===undefined||value==='')return null;
 const n=Number(value);
 if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('Invalid '+field);
 return n;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET to read or POST to save a set'});
 try{
  const task_id=req.method==='GET'?req.query.task_id:req.body?.task_id;
  if(typeof task_id!=='string'||!(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(task_id)))return res.status(400).json({error:'Valid task_id required'});
  const user_id=config().KAY_USER_ID;
  const tasks=await request('kay_tasks',{select:'id,name,due_date,details,is_done,project_id',id:'eq.'+task_id,user_id:'eq.'+user_id,project_id:'eq.'+PROJECT_ID,limit:'1'});
  const task=tasks[0];
  if(!task||!/^BFL W\d{2} — /.test(task.name))return res.status(404).json({error:'Workout not found'});
  const plan=prescription(task);
  if(req.method==='POST'){
   const {exercise,weight_lb,reps,duration_minutes,rpe,notes}=req.body||{};
   const set_number=Number(req.body?.set_number);
   if(!Number.isInteger(set_number))return res.status(400).json({error:'Set must be an integer'});
   if(typeof exercise!=='string'||exercise.length>120) return res.status(400).json({error:'Choose a valid exercise'});
   const ex=plan.exercises.find(x=>x.name===exercise);
   if(!ex||!ex.sets.some(x=>x.set===set_number))return res.status(400).json({error:'Exercise/set not in scheduled workout'});
   const weight=optionalNumber(weight_lb,'weight_lb',{max:2000});
   const actualReps=optionalNumber(reps,'reps',{max:1000,integer:true});
   const mins=optionalNumber(duration_minutes,'duration_minutes',{max:240});
   const effort=optionalNumber(rpe,'rpe',{min:1,max:10});
   const safeNotes=typeof notes==='string'?notes.trim().slice(0,1000):null;
   if(weight===null&&actualReps===null&&mins===null&&effort===null&&!safeNotes)return res.status(400).json({error:'Enter weight, reps, minutes, RPE, or notes before saving'});
   const existing=await request('kay_workout_sets',{select:'weight_lb,reps,duration_minutes,rpe,notes',user_id:'eq.'+user_id,task_id:'eq.'+task_id,exercise:'eq.'+exercise,set_number:'eq.'+set_number,limit:'1'});
   const prior=existing[0]||{};
   const row={user_id,task_id,exercise,set_number,weight_lb:weight??prior.weight_lb??null,reps:actualReps??prior.reps??null,duration_minutes:mins??prior.duration_minutes??null,rpe:effort??prior.rpe??null,notes:safeNotes||prior.notes||null,entry_source:'tomo',updated_at:new Date().toISOString()};
   const result=await request('kay_workout_sets',{on_conflict:'user_id,task_id,exercise,set_number'},{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)});
   return res.status(200).json({ok:true,record:result[0],message:'Workout set saved in Kay Command'});
  }
  const sets=await request('kay_workout_sets',{select:'id,task_id,exercise,set_number,weight_lb,reps,duration_minutes,rpe,notes,entry_source,logged_at,updated_at',task_id:'eq.'+task_id,user_id:'eq.'+user_id,order:'exercise.asc,set_number.asc'});
  return res.status(200).json({plan,sets,task_completed:task.is_done,permissions:['read_plan','read_performance','log_set','overwrite_set']});
 }catch(e){console.error('Tomo workout API',e.message);return res.status(500).json({error:'Unable to read or save workout log'})}
}
