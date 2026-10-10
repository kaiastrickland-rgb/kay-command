const ICLOUD_BASE='https://caldav.icloud.com';

function authHeader(){
  const user=process.env.ICLOUD_APPLE_ID||'';
  const pass=process.env.ICLOUD_APP_PASSWORD||'';
  if(!user||!pass)return null;
  return 'Basic '+Buffer.from(user+':'+pass).toString('base64');
}
function xmlDecode(s=''){
  return String(s)
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&amp;/g,'&');
}
function hrefFromProp(xml,prop){
  const re=new RegExp('<[^>]*'+prop+'[^>]*>[\\s\\S]*?<[^>]*href[^>]*>([\\s\\S]*?)<\\/[^>]*href>','i');
  const m=xml.match(re);
  return m?xmlDecode(m[1].trim()):'';
}
function responses(xml){
  return xml.match(/<[^>]*response[^>]*>[\s\S]*?<\/[^>]*response>/gi)||[];
}
function ensureUrl(href){
  if(/^https?:\/\//i.test(href))return href;
  return ICLOUD_BASE+(href.startsWith('/')?'':'/')+href;
}
async function dav(url,{method='PROPFIND',depth='0',body=''}={}){
  const auth=authHeader();
  if(!auth)throw new Error('iCloud credentials are not configured');
  const r=await fetch(url,{
    method,
    headers:{
      Authorization:auth,
      Depth:depth,
      'Content-Type':'application/xml; charset=utf-8',
      'User-Agent':'KayCommand/1.0'
    },
    body:body||undefined,
    redirect:'follow'
  });
  const text=await r.text();
  if(!r.ok)throw new Error('iCloud CalDAV request failed ('+r.status+')');
  return text;
}
function icsUnfold(s=''){return s.replace(/\r?\n[ \t]/g,'')}
function icsVal(lines,key){
  const line=lines.find(x=>x.startsWith(key+':')||x.startsWith(key+';'));
  if(!line)return {value:'',params:''};
  const i=line.indexOf(':');
  return {value:line.slice(i+1).trim(),params:line.slice(key.length,i)};
}
function parseIcsDate(raw,params=''){
  if(!raw)return {iso:null,allDay:false};
  if(/VALUE=DATE/i.test(params)||/^\d{8}$/.test(raw)){
    const y=raw.slice(0,4),m=raw.slice(4,6),d=raw.slice(6,8);
    return {iso:y+'-'+m+'-'+d,allDay:true};
  }
  if(/^\d{8}T\d{6}Z$/.test(raw)){
    const y=raw.slice(0,4),m=raw.slice(4,6),d=raw.slice(6,8),h=raw.slice(9,11),mi=raw.slice(11,13),s=raw.slice(13,15);
    return {iso:new Date(Date.UTC(+y,+m-1,+d,+h,+mi,+s)).toISOString(),allDay:false};
  }
  if(/^\d{8}T\d{6}$/.test(raw)){
    const y=raw.slice(0,4),m=raw.slice(4,6),d=raw.slice(6,8),h=raw.slice(9,11),mi=raw.slice(11,13),s=raw.slice(13,15);
    // Apple normally includes TZID; return local wall time so the browser can display it naturally.
    return {iso:y+'-'+m+'-'+d+'T'+h+':'+mi+':'+s,allDay:false};
  }
  return {iso:raw,allDay:false};
}
function unescapeIcs(v=''){
  return v.replace(/\\n/gi,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');
}
function parseCalendarData(ics,calendarName){
  const unfolded=icsUnfold(xmlDecode(ics));
  const blocks=unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g)||[];
  return blocks.map(block=>{
    const lines=block.split(/\r?\n/);
    const uid=icsVal(lines,'UID').value;
    const summary=unescapeIcs(icsVal(lines,'SUMMARY').value)||'Untitled event';
    const location=unescapeIcs(icsVal(lines,'LOCATION').value);
    const ds=icsVal(lines,'DTSTART'),de=icsVal(lines,'DTEND');
    const start=parseIcsDate(ds.value,ds.params),end=parseIcsDate(de.value,de.params);
    return {id:uid||summary+'|'+start.iso,title:summary,start:start.iso,end:end.iso,all_day:start.allDay,location,calendar:calendarName||'iCloud',source:'iCloud'};
  }).filter(x=>x.start);
}
function compactUtc(d){
  return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!authHeader())return res.status(503).json({configured:false,error:'iCloud Calendar is not connected yet.'});
  try{
    const now=new Date();
    const days=Math.max(1,Math.min(14,Number(req.query?.days||7)));
    const from=new Date(now);from.setHours(0,0,0,0);
    const to=new Date(from);to.setDate(to.getDate()+days+1);

    const principalXml=await dav(ICLOUD_BASE+'/',{
      method:'PROPFIND',depth:'0',
      body:'<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
    });
    const principal=hrefFromProp(principalXml,'current-user-principal');
    if(!principal)throw new Error('Could not discover iCloud CalDAV principal.');

    const homeXml=await dav(ensureUrl(principal),{
      method:'PROPFIND',depth:'0',
      body:'<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>'
    });
    const home=hrefFromProp(homeXml,'calendar-home-set');
    if(!home)throw new Error('Could not discover iCloud calendar home.');

    const listXml=await dav(ensureUrl(home),{
      method:'PROPFIND',depth:'1',
      body:'<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>'
    });
    const calendars=responses(listXml).map(r=>{
      const href=(r.match(/<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i)||[])[1]||'';
      const display=(r.match(/<[^>]*displayname[^>]*>([\s\S]*?)<\/[^>]*displayname>/i)||[])[1]||'';
      return {href:xmlDecode(href.trim()),name:xmlDecode(display.trim()),isCalendar:/<[^>]*calendar\b/i.test(r)};
    }).filter(x=>x.isCalendar&&x.href);

    let events=[];
    const start=compactUtc(from),end=compactUtc(to);
    for(const cal of calendars){
      const report=await dav(ensureUrl(cal.href),{
        method:'REPORT',depth:'1',
        body:'<?xml version="1.0" encoding="UTF-8"?>'+
          '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'+
          '<d:prop><d:getetag/><c:calendar-data><c:expand start="'+start+'" end="'+end+'"/></c:calendar-data></d:prop>'+
          '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="'+start+'" end="'+end+'"/></c:comp-filter></c:comp-filter></c:filter>'+
          '</c:calendar-query>'
      });
      const dataBlocks=[...report.matchAll(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi)];
      dataBlocks.forEach(m=>{events.push(...parseCalendarData(m[1],cal.name))});
    }

    const seen=new Set();
    events=events.filter(e=>{
      const k=[e.title,String(e.start).slice(0,16),String(e.end).slice(0,16)].join('|').toLowerCase();
      if(seen.has(k))return false;seen.add(k);return true;
    }).sort((a,b)=>String(a.start).localeCompare(String(b.start)));

    return res.status(200).json({configured:true,account:process.env.ICLOUD_APPLE_ID,events});
  }catch(error){
    return res.status(500).json({configured:true,error:error?.message||'Unable to read iCloud Calendar.',events:[]});
  }
}
