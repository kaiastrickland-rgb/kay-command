const send=(r,c,o)=>{r.setHeader('Cache-Control','no-store');return r.status(c).json(o);};
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
async function read(path,token){
 const base=process.env.SUPABASE_URL.replace(/\/$/,'');
 const r=await fetch(base+'/rest/v1/'+path,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Could not read your saved résumé and job.');return r.json();
}
export default async function handler(req,res){
 if(req.method==='GET')return send(res,200,{configured:!!process.env.OPENAI_API_KEY});
 if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
 if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'Full AI tailoring is not yet connected to Kay Command. OPENAI_API_KEY must be configured. Another copy-paste résumé will not be generated.'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)return send(res,401,{error:'Sign in to Kay Command first.'});
 try{
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+token}});
  if(!auth.ok)return send(res,401,{error:'Kay Command sign-in expired.'});
  const user=await auth.json(),id=String(req.body?.job_id||'');
  if(!/^[a-f\d-]{36}$/i.test(id))return send(res,400,{error:'Select a saved job.'});
  const [jobs,masters]=await Promise.all([
   read('kay_jobs?id=eq.'+id+'&user_id=eq.'+user.id+'&select=*',token),
   read('kay_resume_documents?user_id=eq.'+user.id+'&kind=eq.master&select=content_text&limit=1',token)
  ]);
  if(jobs.length!==1||masters.length!==1)return send(res,404,{error:'Saved master résumé or job not found.'});
  const j=jobs[0],source=masters[0].content_text,structure=req.body?.master_structure;
  if(!structure||clean(structure.name)!==clean(source.split('\n')[0])||!Array.isArray(structure.experience))return send(res,400,{error:'Verified master résumé structure missing. Refresh Kay Command.'});
  const requirements=String(req.body?.job_description||j.job_description||'').trim().slice(0,23000);
  if(requirements.length<180)return send(res,422,{error:'The full job requirements are not saved. Paste them into Job Details first. I will not guess from the job title.'});
  const prompt=[
   'You are an elite, evidence-first executive résumé writer and ATS specialist. Reply with ONLY valid JSON.',
   'Analyze the ENTIRE job description and REWRITE the WHOLE résumé, including executive headline, profile, wins, categorized skills, and work bullets INSIDE their original employment entries. Do NOT add a pasted top section or merely reorder old bullets.',
   'Preserve each employer, position, and date EXACTLY as in HISTORY; do not add or omit any. Paraphrase documented experience with relevant keywords naturally; never invent data, metrics, supervision, certifications, domain history or product ownership. 2-3 pages, concise compelling bullets.',
   'Report confirmed matches and unsupported role requirements SEPARATELY in analysis, not inside the résumé.',
   'Return JSON: {"resume":{"name":"...","contact":"...","headline":"...","summary":"...","wins":["..."],"competencies":[{"label":"...","items":["..."]}],"experience":[{"employer":"...","dates":"...","role":"...","bullets":["..."]}],"education":["..."],"certifications":["..."],"tools":[{"label":"...","items":["..."]}]},"analysis":{"matched":["..."],"gaps":["..."],"summary":"..."}}.',
   'SOURCE MASTER:\n'+source,
   'HISTORY TO PRESERVE:\n'+JSON.stringify(structure.experience),
   'JOB '+j.title+' AT '+j.employer+':\n'+requirements
  ].join('\n\n');
  const ai=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.KAY_RESUME_AI_MODEL||'gpt-5.2',input:prompt,max_output_tokens:8000}),signal:AbortSignal.timeout(65000)});
  const data=await ai.json();if(!ai.ok)return send(res,502,{error:'AI provider error: '+(data.error?.message||'Could not generate')});
  const output=(data.output||[]).flatMap(v=>v.content||[]).filter(v=>v.type==='output_text').map(v=>v.text).join('\n').trim();
  const obj=JSON.parse(output),d=obj.resume;
  if(!d||d.experience?.length!==structure.experience.length||clean(d.name)!==clean(structure.name)||clean(d.contact)!==clean(structure.contact))throw Error('Generated résumé failed identity or work-history checks.');
  for(let i=0;i<structure.experience.length;i++){
   const x=d.experience[i],y=structure.experience[i];
   if(clean(x.employer)!==clean(y.employer)||clean(x.dates)!==clean(y.dates)||clean(x.role)!==clean(y.role)||!Array.isArray(x.bullets)||!x.bullets.length)throw Error('AI changed an employer, position, date, or omitted work details.');
  }
  return send(res,200,{resume:d,analysis:{matched:obj.analysis?.matched||[],gaps:obj.analysis?.gaps||[],summary:obj.analysis?.summary||'Review all factual assertions.',hasFullRequirements:true},method:'verified_ai_rewrite'});
 }catch(e){return send(res,500,{error:'AI tailoring failed verification: '+(e.message||String(e))});}
}