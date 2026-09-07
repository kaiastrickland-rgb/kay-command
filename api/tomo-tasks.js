async function supabaseRequest(url, options = {}) {
  const { SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

function requireConfig(res) {
  const required = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TOMO_FEED_TOKEN','KAY_USER_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    res.status(500).json({ error: 'Server configuration incomplete', missing });
    return false;
  }
  return true;
}

function authorized(req) {
  return (req.headers.authorization || '') === `Bearer ${process.env.TOMO_FEED_TOKEN}`;
}

async function logUpdate({ taskId=null, projectId=null, actionType, message, requestedDate=null }) {
  try {
    await supabaseRequest(`${process.env.SUPABASE_URL}/rest/v1/kay_task_updates`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: process.env.KAY_USER_ID,
        task_id: taskId,
        project_id: projectId,
        action_type: actionType,
        message,
        requested_date: requestedDate,
        status: 'applied',
        processed_at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.error('Tomo task-update log failed', e);
  }
}

async function getTask(taskId) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_tasks`);
  url.searchParams.set('select','id,name,details,due_date,owner,is_done,project_id,user_id,created_at,updated_at');
  url.searchParams.set('id',`eq.${taskId}`);
  url.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  url.searchParams.set('limit','1');
  const resp = await supabaseRequest(url);
  if (!resp.ok) throw new Error(`Task lookup failed: ${resp.status}`);
  const rows = await resp.json();
  return rows[0] || null;
}

async function getProject(projectId) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_projects`);
  url.searchParams.set('select','id,name,workspace,type');
  url.searchParams.set('id',`eq.${projectId}`);
  url.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  url.searchParams.set('limit','1');
  const resp = await supabaseRequest(url);
  if (!resp.ok) throw new Error(`Project lookup failed: ${resp.status}`);
  const rows = await resp.json();
  return rows[0] || null;
}

async function updateTask(taskId, patch) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_tasks`);
  url.searchParams.set('id',`eq.${taskId}`);
  url.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  const resp = await supabaseRequest(url, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!resp.ok) throw new Error(`Task update failed: ${resp.status} ${await resp.text()}`);
  return (await resp.json())[0] || null;
}

async function findDuplicateOpenTask({ projectId, name }) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_tasks`);
  url.searchParams.set('select','id,name,project_id,is_done');
  url.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  url.searchParams.set('project_id',`eq.${projectId}`);
  url.searchParams.set('is_done','eq.false');
  const resp = await supabaseRequest(url);
  if (!resp.ok) throw new Error(`Duplicate check failed: ${resp.status}`);
  const rows = await resp.json();
  const normalized = name.trim().toLowerCase().replace(/\s+/g,' ');
  return rows.find(r => String(r.name||'').trim().toLowerCase().replace(/\s+/g,' ') === normalized) || null;
}

async function createTask({ projectId, name, dueDate=null, details=null, owner='Kay' }) {
  const project = await getProject(projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.code = 400;
    throw err;
  }

  const dup = await findDuplicateOpenTask({ projectId, name });
  if (dup) {
    const err = new Error('A matching open task already exists in that project');
    err.code = 409;
    err.duplicate = dup;
    throw err;
  }

  const payload = {
    project_id: projectId,
    user_id: process.env.KAY_USER_ID,
    name: name.trim(),
    owner: owner || 'Kay',
    due_date: dueDate || null,
    is_done: false,
    details: details ? String(details).slice(0,5000) : null
  };

  const resp = await supabaseRequest(`${process.env.SUPABASE_URL}/rest/v1/kay_tasks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(`Task creation failed: ${resp.status} ${await resp.text()}`);
  const created = (await resp.json())[0];

  await logUpdate({
    taskId: created.id,
    projectId,
    actionType: 'add_task',
    requestedDate: dueDate,
    message: `Tomo created task: ${created.name}`
  });

  return created;
}

async function listFeed() {
  const taskUrl = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_tasks`);
  taskUrl.searchParams.set('select','id,name,details,due_date,owner,is_done,project_id,created_at,updated_at');
  taskUrl.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  taskUrl.searchParams.set('order','is_done.asc,due_date.asc.nullslast,created_at.asc');

  const projectUrl = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_projects`);
  projectUrl.searchParams.set('select','id,name,workspace,type');
  projectUrl.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  projectUrl.searchParams.set('order','sort_order.asc,name.asc');

  const [taskResp, projectResp] = await Promise.all([
    supabaseRequest(taskUrl),
    supabaseRequest(projectUrl)
  ]);

  if (!taskResp.ok) throw new Error(`Task query failed: ${taskResp.status}`);
  if (!projectResp.ok) throw new Error(`Project query failed: ${projectResp.status}`);

  const tasks = await taskResp.json();
  const projects = await projectResp.json();

  const projectMap = new Map(projects.map(p => [String(p.id), {
    name: p.name || 'Unassigned',
    workspace: p.workspace || p.type || null
  }]));

  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const normalized = tasks.map(t => {
    const p = projectMap.get(String(t.project_id)) || { name:'Unassigned', workspace:null };
    let overdue=false, dueToday=false, daysUntilDue=null;
    if (t.due_date) {
      const due = new Date(`${t.due_date}T00:00:00`);
      daysUntilDue = Math.round((due - todayLocal)/86400000);
      overdue = !t.is_done && daysUntilDue < 0;
      dueToday = !t.is_done && daysUntilDue === 0;
    }
    return {
      id:t.id, task:t.name, project_id:t.project_id, project:p.name, workspace:p.workspace,
      due_date:t.due_date, is_done:t.is_done, overdue, due_today:dueToday,
      days_until_due:daysUntilDue, owner:t.owner||'Kay', details:t.details||null, updated_at:t.updated_at
    };
  });

  const open = normalized.filter(t=>!t.is_done);
  const overdue = open.filter(t=>t.overdue);
  const dueToday = open.filter(t=>t.due_today);
  const upcoming = open.filter(t=>t.due_date && !t.overdue && !t.due_today);
  const unscheduled = open.filter(t=>!t.due_date);

  return {
    generated_at:new Date().toISOString(),
    source:'KAY // COMMAND',
    access:'Tomo accountability task view',
    permissions:['read','create','complete','reopen','reschedule','update_details'],
    summary:{
      open_tasks:open.length,
      completed_visible:normalized.filter(t=>t.is_done).length,
      overdue:overdue.length,
      due_today:dueToday.length,
      upcoming_scheduled:upcoming.length,
      unscheduled:unscheduled.length
    },
    projects:projects.map(p=>({id:p.id,name:p.name,workspace:p.workspace||p.type||null})),
    priority_stack:[...overdue,...dueToday,...upcoming,...unscheduled].slice(0,10),
    tasks:normalized
  };
}

export default async function handler(req,res){
  if(!requireConfig(res)) return;
  if(!authorized(req)) return res.status(401).json({error:'Unauthorized'});
  res.setHeader('Cache-Control','no-store, max-age=0');

  try{
    if(req.method==='GET') return res.status(200).json(await listFeed());

    if(req.method==='POST'){
      const { project_id, task_name, due_date=null, details=null, owner='Kay' } = req.body || {};
      if(!project_id || !task_name || !String(task_name).trim()){
        return res.status(400).json({error:'project_id and task_name are required'});
      }
      if(due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)){
        return res.status(400).json({error:'due_date must be YYYY-MM-DD'});
      }
      try{
        const task = await createTask({
          projectId:project_id,
          name:String(task_name),
          dueDate:due_date,
          details,
          owner
        });
        return res.status(201).json({ok:true,action:'create',task});
      }catch(e){
        if(e.code===409) return res.status(409).json({error:e.message,duplicate:e.duplicate});
        if(e.code===400) return res.status(400).json({error:e.message});
        throw e;
      }
    }

    if(req.method!=='PATCH'){
      res.setHeader('Allow','GET, POST, PATCH');
      return res.status(405).json({error:'Method not allowed'});
    }

    const { task_id, action, due_date, details } = req.body || {};
    if(!task_id || !action) return res.status(400).json({error:'task_id and action are required'});

    const task = await getTask(task_id);
    if(!task) return res.status(404).json({error:'Task not found'});

    let updated;
    if(action==='complete'){
      updated = await updateTask(task_id,{is_done:true});
      await logUpdate({taskId:task.id,projectId:task.project_id,actionType:'complete',message:`Tomo marked task complete: ${task.name}`});
    }else if(action==='reopen'){
      updated = await updateTask(task_id,{is_done:false});
      await logUpdate({taskId:task.id,projectId:task.project_id,actionType:'update',message:`Tomo reopened task: ${task.name}`});
    }else if(action==='reschedule'){
      if(!due_date || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return res.status(400).json({error:'A YYYY-MM-DD due_date is required'});
      updated = await updateTask(task_id,{due_date});
      await logUpdate({taskId:task.id,projectId:task.project_id,actionType:'reschedule',requestedDate:due_date,message:`Tomo rescheduled "${task.name}" to ${due_date}`});
    }else if(action==='update_details'){
      if(typeof details!=='string') return res.status(400).json({error:'details must be text'});
      updated = await updateTask(task_id,{details:details.slice(0,5000)});
      await logUpdate({taskId:task.id,projectId:task.project_id,actionType:'update',message:`Tomo updated task details: ${task.name}`});
    }else{
      return res.status(400).json({error:'Unsupported action',allowed:['complete','reopen','reschedule','update_details']});
    }

    return res.status(200).json({ok:true,action,task:updated});
  }catch(error){
    console.error('Tomo task API error',error);
    return res.status(500).json({error:'Unable to process Tomo task request'});
  }
}