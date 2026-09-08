async function jsonBody(req){
  if(req.body && typeof req.body === 'object') return req.body;
  try{return JSON.parse(req.body || '{}')}catch{return {}}
}

function send(res,status,payload){
  res.status(status).json(payload);
}

async function supabaseAdmin(path, options={}){
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${base}${path}`,{
    ...options,
    headers:{
      apikey:key,
      Authorization:`Bearer ${key}`,
      'Content-Type':'application/json',
      ...(options.headers||{})
    }
  });
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');

  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return send(res,405,{error:'Method not allowed'});
  }

  const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','KAY_USER_ID'];
  const missing=required.filter(k=>!process.env[k]);
  if(missing.length)return send(res,500,{error:'Server configuration incomplete'});

  // Use a dedicated trusted-device code if one exists. Until then, reuse the
  // already-configured private TOMO_FEED_TOKEN so no new Vercel variable is required.
  const expected=process.env.KAY_TRUSTED_DEVICE_CODE || process.env.TOMO_FEED_TOKEN;
  if(!expected)return send(res,500,{error:'Trusted-device access code is not configured'});

  const body=await jsonBody(req);
  const supplied=String(body.code||'');
  if(!supplied || supplied!==expected)return send(res,401,{error:'Invalid device access code'});

  try{
    const userResp=await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(process.env.KAY_USER_ID)}`);
    if(!userResp.ok){
      console.error('Trusted device user lookup failed',userResp.status,await userResp.text());
      return send(res,500,{error:'Unable to resolve Kay Command user'});
    }
    const user=await userResp.json();
    if(!user?.email)return send(res,500,{error:'Kay Command user email is unavailable'});

    const linkResp=await supabaseAdmin('/auth/v1/admin/generate_link',{
      method:'POST',
      body:JSON.stringify({
        type:'magiclink',
        email:user.email,
        options:{
          redirectTo:'https://kay-command.vercel.app/'
        }
      })
    });

    const linkData=await linkResp.json().catch(()=>({}));
    if(!linkResp.ok){
      console.error('Trusted device generate_link failed',linkResp.status,linkData);
      return send(res,500,{error:'Unable to create trusted-device session'});
    }

    const tokenHash=
      linkData?.properties?.hashed_token ||
      linkData?.hashed_token ||
      linkData?.properties?.email_otp ||
      null;

    if(!tokenHash){
      console.error('Trusted device token hash missing');
      return send(res,500,{error:'Trusted-device session token was not returned'});
    }

    return send(res,200,{ok:true,token_hash:tokenHash});
  }catch(error){
    console.error('Trusted device auth error',error);
    return send(res,500,{error:'Unable to authorize trusted device'});
  }
}