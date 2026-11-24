/* Kay Command executive resume document engine.
   A single-column ATS-friendly structure is used in both preview and Word export. */
(function(){
"use strict";
const SECTION_NAMES = new Set(["EXECUTIVE IMPACT","EXECUTIVE SUMMARY","PROFESSIONAL SUMMARY","EXECUTIVE PROFILE","EXECUTIVE COMPETENCIES","CORE COMPETENCIES","SELECTED CAREER WINS","SELECTED IMPACT","WORK EXPERIENCE","PROFESSIONAL EXPERIENCE","EDUCATION AND OTHER CREDENTIALS","EDUCATION","CERTIFICATIONS","PLATFORMS & TOOLS","PLATFORMS AND TOOLS"]);
const SKILL_GROUPS = new Set(["Transformation Leadership","Enterprise Delivery & Governance","Process & Operational Excellence","Technology Transformation","Leadership","ERP & Enterprise Applications","Transportation & Trade","Warehouse Management","Delivery & Reporting","Delivery Methodologies","Program & Portfolio Leadership","Analytics & Measurement","Business Transformation","Stakeholder & Change Leadership","Technology & Integration Delivery","Logistics & Operations","Product, Data & Insights","Strategic Execution","Financial & Operational Performance","Testing & Release Readiness"]);
const DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{4}\s*[–\-]\s*(?:Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{4})\s*$/i;
const xesc = v=>String(v||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean = x=>String(x||"").replace(/[\u200b-\u200f\u2060\uFFFE\uFFFF]/g,"").replace(/\uF0B7/g,"•").replace(/[\t ]+/g," ").trim();
const bullet = s=>/^[•●▪\u2022*-]\s+/.test(String(s||"").trim());
const stripBullet = s=>clean(s).replace(/^[•●▪*-]\s*/,"").trim();
const norm = s=>clean(s).replace(/\s+/g," ");
function parse(text) {
 const lines=String(text||"").replace(/\r/g,"").split("\n").map(clean);
 const data={name:lines[0]||"Candidate",contact:lines[1]||"",headline:"",summary:"",highlights:[],wins:[],competencies:[],experience:[],education:[],certifications:[],tools:[]};
 let section="HEADLINE", skillGroup=null,toolGroup=null,job=null,buffer="";
 function flush(){
  if(!buffer)return;
  const val=norm(buffer); buffer="";
  if(section==="EXECUTIVE SUMMARY"||section==="EXECUTIVE PROFILE"||section==="PROFESSIONAL SUMMARY"){data.summary+=(data.summary?" ":"")+val;}
  else if(section==="EXECUTIVE IMPACT") data.highlights.push(val);
  else if(section==="SELECTED CAREER WINS"||section==="SELECTED IMPACT")data.wins.push(val);
  else if(section==="WORK EXPERIENCE"||section==="PROFESSIONAL EXPERIENCE"){if(job)job.bullets.push(val);}
  else if(section==="EDUCATION AND OTHER CREDENTIALS"||section==="EDUCATION"||section==="CERTIFICATIONS"){
   if(/Planned\s*20\d{2}/i.test(val))return; // planned, not an earned certification
   if(/certific|green belt|scrum master|PMP\b/i.test(val))data.certifications.push(val);else data.education.push(val);
  }else if(section==="EXECUTIVE COMPETENCIES"||section==="CORE COMPETENCIES"){
   if(skillGroup){skillGroup.items.push(...val.split(/\s*•\s*/).filter(Boolean));}
  }else if(section==="PLATFORMS & TOOLS"||section==="PLATFORMS AND TOOLS"){
   if(toolGroup)toolGroup.items.push(...val.split(/\s*[|•]\s*/).filter(Boolean));
  }
 }
 for(let i=2;i<lines.length;i++){
  const line=lines[i];if(!line){if(buffer&&!bullet(lines[i+1]||"")){flush();}continue;}
  if(/^TARGET APPLICATION:/i.test(line)||/^JOB-ALIGNED EXPERIENCE FOR/i.test(line)){flush();section="SKIP_GENERATED";continue;}
  const up=line.toUpperCase();
  if(SECTION_NAMES.has(up)){flush();section=up;skillGroup=null;toolGroup=null;job=null;continue;}
  if(section==="SKIP_GENERATED"){if(!SECTION_NAMES.has(up))continue;}
  if(section==="HEADLINE"){data.headline+=(data.headline?" ":"")+line;continue;}
  if(section==="WORK EXPERIENCE"||section==="PROFESSIONAL EXPERIENCE"){
   const m=line.match(DATE_RE);
   if(m && !bullet(line) && !/^Sr\.?\s|^Senior |^Manager /i.test(line)){
    flush();const pre=line.slice(0,m.index).trim().replace(/[, ]+$/,"");
    job={employer:pre.toUpperCase(),dates:m[0],role:"",bullets:[]};data.experience.push(job);continue;
   }
   if(!job)continue;
   if(!job.role&&!bullet(line)){job.role=line;continue;}
   if(bullet(line)){flush();buffer=stripBullet(line);continue;}
   if(buffer){buffer+=" "+line;}else if(!job.role){job.role=line;}else{job.role+=" "+line;}
   continue;
  }
  if(section==="EXECUTIVE COMPETENCIES"||section==="CORE COMPETENCIES"){
   if(SKILL_GROUPS.has(line)){flush();skillGroup={label:line,items:[]};data.competencies.push(skillGroup);continue;}
   if(!skillGroup){skillGroup={label:"Executive Capabilities",items:[]};data.competencies.push(skillGroup);}
   buffer+=(buffer?" ":"")+line;continue;
  }
  if(section==="PLATFORMS & TOOLS"||section==="PLATFORMS AND TOOLS"){
   if(SKILL_GROUPS.has(line)){flush();toolGroup={label:line,items:[]};data.tools.push(toolGroup);continue;}
   if(!toolGroup){toolGroup={label:"Tools",items:[]};data.tools.push(toolGroup);}
   buffer+=(buffer?" ":"")+line;continue;
  }
  if(section==="EXECUTIVE IMPACT"||section==="SELECTED CAREER WINS"||section==="SELECTED IMPACT"){
   if(bullet(line)){flush();buffer=stripBullet(line);}
   else buffer+=(buffer?" ":"")+line;
   continue;
  }
  if(section==="EXECUTIVE SUMMARY"||section==="EXECUTIVE PROFILE"||section==="PROFESSIONAL SUMMARY"){buffer+=(buffer?" ":"")+line;continue;}
  if(section==="EDUCATION"||section==="CERTIFICATIONS"||section==="EDUCATION AND OTHER CREDENTIALS"){flush();buffer=line;continue;}
 }
 flush();
 data.headline=norm(data.headline).replace(/\s+\|\s*$/,"");
 data.competencies.forEach(g=>g.items=g.items.map(norm).filter(Boolean));
 data.tools.forEach(g=>g.items=g.items.map(norm).filter(Boolean));
 return data;
}
function serialize(d){
 const out=[d.name,d.contact,d.headline,"","EXECUTIVE SUMMARY",d.summary,"","SELECTED CAREER WINS"];
 d.wins.slice(0,4).forEach(v=>out.push("• "+v));
 out.push("","EXECUTIVE COMPETENCIES");
 d.competencies.forEach(g=>{out.push(g.label);out.push(g.items.join(" • "));});
 out.push("","WORK EXPERIENCE");
 d.experience.forEach(job=>{out.push(job.employer+" "+job.dates);out.push(job.role);job.bullets.forEach(v=>out.push("• "+v));out.push("");});
 out.push("EDUCATION AND OTHER CREDENTIALS");d.education.forEach(x=>out.push(x));d.certifications.forEach(x=>out.push(x));
 out.push("","PLATFORMS & TOOLS");d.tools.forEach(g=>{out.push(g.label);out.push(g.items.join(" | "));});
 return out.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}
function render(text){
 const d=typeof text==="string"?parse(text):text;
 function section(title,content){return content?'<section class="xrSection"><h2>'+xesc(title)+'</h2>'+content+'</section>':"";}
 function bullets(items,limit){return '<ul class="xrBullets">'+items.slice(0,limit||99).map(x=>'<li>'+xesc(x)+'</li>').join("")+'</ul>';}
 const win=bullets(d.wins.slice(0,4));
 const competencies=d.competencies.map(g=>'<div class="xrSkillRow"><div class="xrSkillLabel">'+xesc(g.label)+'</div><div class="xrSkillValues">'+xesc(g.items.join(" · "))+'</div></div>').join("");
 const experience=d.experience.map(j=>'<div class="xrJob"><div class="xrJobHead"><strong>'+xesc(j.employer)+'</strong><span class="xrDates">'+xesc(j.dates)+'</span></div><div class="xrRole">'+xesc(j.role)+'</div>'+bullets(j.bullets)+'</div>').join("");
 const education=d.education.map(x=>'<div class="xrEdu">'+xesc(x)+'</div>').join("");
 const certs=d.certifications.map(x=>'<div class="xrEdu">'+xesc(x)+'</div>').join("");
 const tools=d.tools.map(g=>'<div class="xrSkillRow"><div class="xrSkillLabel">'+xesc(g.label)+'</div><div class="xrSkillValues">'+xesc(g.items.join(" · "))+'</div></div>').join("");
 return '<article class="xrPaper"><header class="xrHeader"><h1>'+xesc(d.name)+'</h1><p class="xrContact">'+xesc(d.contact)+'</p><p class="xrHeadline">'+xesc(d.headline)+'</p></header>'+
 section("EXECUTIVE PROFILE",'<p class="xrSummary">'+xesc(d.summary)+'</p>')+
 section("SELECTED BUSINESS IMPACT",win)+section("CORE COMPETENCIES",competencies)+
 section("PROFESSIONAL EXPERIENCE",experience)+
 section("EDUCATION",education)+section("CERTIFICATIONS",certs)+section("TECHNOLOGY & METHODS",tools)+
 '</article>';
}
function thumbnail(text){
 const d=typeof text==="string"?parse(text):text;
 const c=document.createElement("canvas");c.width=560;c.height=740;
 const x=c.getContext("2d");x.fillStyle="#ffffff";x.fillRect(0,0,560,740);
 const navy="#183d56";let y=70;
 function drawLine(s,size=14,bold=false,color="#27394a",maxWidth=475){
  x.font=(bold?"bold ":"")+size+"px Arial";x.fillStyle=color;
  const chunks=norm(s).split(/\s+/);let current="";
  for(const w of chunks){const next=current?current+" "+w:w;
   if(x.measureText(next).width>maxWidth&&current){x.fillText(current,46,y);y+=size*1.5;current=w;}else current=next;
   if(y>690)break;
  }
  if(current){x.fillText(current,46,y);y+=size*1.5;}
 }
 function rule(label){y+=9;drawLine(label,14,true,navy);x.fillStyle="#2b6a8e";x.fillRect(46,y-12,470,1);y+=7;}
 drawLine(d.name.toUpperCase(),27,true,navy);drawLine(d.contact,11);drawLine(d.headline,13,true,navy);rule("EXECUTIVE PROFILE");
 drawLine(d.summary.slice(0,360),13);
 rule("SELECTED BUSINESS IMPACT");d.wins.slice(0,2).forEach(a=>drawLine("• "+a.slice(0,150),12));
 rule("CORE COMPETENCIES");d.competencies.slice(0,2).forEach(g=>{drawLine(g.label,12,true,navy);drawLine(g.items.join(" · ").slice(0,140),11);});
 rule("PROFESSIONAL EXPERIENCE");d.experience.slice(0,1).forEach(j=>{drawLine(j.employer+"   "+j.dates,12,true,navy);drawLine(j.role,12,true);});
 return c.toDataURL("image/png");
}
function analyze(master,job){
 const d=typeof master==="string"?parse(master):master;
 const requirements=(job.job_description||job.fit_note||"")+" "+job.title;
 const checks=[
 ["Supply chain & logistics",["supply chain","logistics","transport","warehouse","inventory","distribution"],["distribution","logistics","supply chain","warehouse"]],
 ["Program delivery & governance",["program","initiative","delivery","governance","strategy","roadmap"],["program","governance","initiative","strategic"]],
 ["Analytics & KPI governance",["analytics","metric","measurement","kpi","data","insight","dashboard"],["analytics","kpi","dashboard","reporting"]],
 ["Stakeholder / partner leadership",["stakeholder","partner","cross-functional","leadership","vendor","communication"],["stakeholder","executive","cross-functional","vendor"]],
 ["Operations & change",["operations","process","change","improvement","service"],["operations","change","process","efficiency"]],
 ["Technical integration",["integration","technical","technology","systems","product","requirements"],["integration","systems","technology","ERP"]],
 ["Financial / cost control",["cost","finance","financial","budget","savings"],["financial","cost","budget","savings"]]
 ];
 const lower=requirements.toLowerCase(),corpus=serialize(d).toLowerCase();
 const matched=[],notEvidenced=[],unrequested=[];
 for(const [label,reqWords,evidenceWords] of checks){
  const needs=reqWords.some(w=>lower.includes(w));if(!needs){unrequested.push(label);continue;}
  const supported=evidenceWords.some(w=>corpus.includes(w.toLowerCase()));
  (supported?matched:notEvidenced).push(label);
 }
 if(/airline|flight|reservation/i.test(requirements)&&!/airline|reservation domain/i.test(corpus))notEvidenced.push("Airline-specific or reservation-platform experience");
 if(/direct reports|people management|supervisory|staff/i.test(requirements)&&!/direct reports|supervisory/i.test(corpus))notEvidenced.push("Direct supervisory reports (not established by the master résumé)");
 if(/more than 50%|50% overnight/i.test(requirements))notEvidenced.push("Overnight travel requirement: confirm willingness separately");
 return {matched:[...new Set(matched)],gaps:[...new Set(notEvidenced)],hasFullRequirements:!!String(job.job_description||"").trim(),source:job.apply_url||"",summary:"This analysis identifies transferable, documented experience. It does not claim missing industry experience or fabricate qualifications."};
}
function align(master,job){
 const d=parse(master);
 const analysis=analyze(d,job);
 const role=String(job.title||"Enterprise Transformation").toLowerCase();
 const analytics=/analytics|data|insight|product/i.test(role);
 const operations=/strategic initiatives|logistics|supply chain|delivery/i.test(role);
 d.headline=analytics?"ENTERPRISE ANALYTICS & KPI GOVERNANCE | DIGITAL TRANSFORMATION | CROSS-FUNCTIONAL DELIVERY":
   operations?"SUPPLY CHAIN & LOGISTICS TRANSFORMATION | STRATEGIC PROGRAM DELIVERY | OPERATING GOVERNANCE":
   "ENTERPRISE TRANSFORMATION | PROGRAM LEADERSHIP | OPERATIONAL EXCELLENCE";
 const domain=analytics?"measurement strategy, executive analytics, data governance, and complex technology delivery":
   operations?"logistics strategy, operational improvement, enterprise execution, and cross-functional program governance":
   "program leadership, enterprise systems, process improvement, and strategic transformation";
 d.summary="Enterprise transformation and technology program leader with 20+ years of experience spanning "+domain+
 ". Has directed a $9.6M transformation program, aligned complex business and technology stakeholders, and built executive reporting, risk and governance practices. Brings transferable experience across supply chain, digital modernization, operational performance, and change adoption.";
 function score(text){
  const roleTokens=((job.job_description||job.fit_note||job.title||"").toLowerCase().match(/[a-z]{5,}/g)||[]).filter(w=>!["these","where","about","strong","experience","ability","required","preferred","relevant","related","company","their"].includes(w));
  return roleTokens.reduce((n,w)=>n+(text.toLowerCase().includes(w)?1:0),0);
 }
 d.competencies.sort((a,b)=>score(b.label+" "+b.items.join(" "))-score(a.label+" "+a.items.join(" ")));
 d.experience.forEach(j=>{j.bullets.sort((a,b)=>score(b)-score(a));j.bullets=j.bullets.slice(0,j.employer.includes("KROGER")||j.employer.includes("WESCO")||j.employer.includes("HOME DEPOT")?5:3);});
 d.wins=d.wins.sort((a,b)=>score(b)-score(a)).slice(0,4);
 return {content:serialize(d),analysis,automaticOnly:true};
}
async function toWord(text,filename){
 if(!window.docx||!window.docx.Packer)throw new Error("Word export library is unavailable. Check your connection.");
 const dx=window.docx,d=parse(text);const nodes=[];
 const p=(value,opts={})=>new dx.Paragraph({children:[new dx.TextRun({text:String(value||""),bold:!!opts.bold,size:opts.size||19,color:opts.color||"253747",font:"Aptos"})],
  alignment:opts.center?dx.AlignmentType.CENTER:dx.AlignmentType.LEFT,
  spacing:{before:opts.before||0,after:opts.after||65,line:260},keepWithNext:!!opts.keep,
  border:opts.rule?{bottom:{color:"44758E",space:4,size:5}}:undefined,
  bullet:opts.bullet?{level:0}:undefined});
 function section(title){nodes.push(p(title,{bold:true,size:21,color:"163E57",before:150,after:110,rule:true,keep:true}));}
 nodes.push(p(d.name.toUpperCase(),{bold:true,size:35,color:"173F57",center:true,after:50}));
 nodes.push(p(d.contact,{size:17,center:true,after:80}));
 nodes.push(p(d.headline,{bold:true,size:18,color:"356B88",center:true,after:140}));
 section("EXECUTIVE PROFILE");nodes.push(p(d.summary,{after:140}));
 section("SELECTED BUSINESS IMPACT");d.wins.slice(0,4).forEach(x=>nodes.push(p(x,{bullet:true,after:55})));
 section("CORE COMPETENCIES");
 d.competencies.forEach(g=>nodes.push(new dx.Paragraph({children:[new dx.TextRun({text:g.label+":  ",bold:true,size:18,color:"173F57",font:"Aptos"}),new dx.TextRun({text:g.items.join(" • "),size:18,font:"Aptos",color:"253747"})],spacing:{after:65}})));
 section("PROFESSIONAL EXPERIENCE");
 d.experience.forEach(j=>{
  nodes.push(new dx.Paragraph({children:[new dx.TextRun({text:j.employer+"    ",bold:true,size:20,font:"Aptos",color:"193C55"}),new dx.TextRun({text:j.dates,bold:true,size:17,color:"4B5D68",font:"Aptos"})],spacing:{before:110,after:30},keepWithNext:true}));
  nodes.push(p(j.role,{bold:true,size:19,color:"35647E",after:50,keep:true}));
  j.bullets.forEach(v=>nodes.push(p(v,{bullet:true,after:35})));
 });
 if(d.education.length){section("EDUCATION");d.education.forEach(x=>nodes.push(p(x)));}
 if(d.certifications.length){section("CERTIFICATIONS");d.certifications.forEach(x=>nodes.push(p(x)));}
 if(d.tools.length){section("TECHNOLOGY & METHODS");d.tools.forEach(g=>nodes.push(new dx.Paragraph({children:[new dx.TextRun({text:g.label+":  ",bold:true,size:18,font:"Aptos"}),new dx.TextRun({text:g.items.join(" • "),size:18,font:"Aptos"})],spacing:{after:50}})));}
 const doc=new dx.Document({sections:[{properties:{page:{margin:{top:700,bottom:700,left:800,right:800}}},children:nodes}]});
 const blob=await dx.Packer.toBlob(doc);
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename||"Kaia_Strickland_Resume.docx";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);
 return a.download;
}
window.KayResumeEngine={parse,serialize,render,thumbnail,align,analyze,toWord};
})();