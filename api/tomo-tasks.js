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
  url.searchParams.set('select','id,name,workspace,type,target_date,next_move,sort_order');
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

async function updatePlanTask(taskId, patch) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_project_plan_tasks`);
  url.searchParams.set('id',`eq.${taskId}`);
  url.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  const resp = await supabaseRequest(url, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!resp.ok) throw new Error(`Project-plan task update failed: ${resp.status} ${await resp.text()}`);
  return (await resp.json())[0] || null;
}

async function getPlanTask(taskId) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/kay_project_plan_tasks`);
  url.searchParams.set('select','id,name,notes,due_date,owner,is_done,project_id,plan_id,phase,category,status,priority');
  url.searchParams.set('id',`eq.${taskId}`);
  url.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
  url.searchParams.set('limit','1');
  const resp = await supabaseRequest(url);
  if (!resp.ok) throw new Error(`Project-plan task lookup failed: ${resp.status}`);
  const rows = await resp.json();
  return rows[0] || null;
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

function taskTiming(dueDate, isDone) {
  if (!dueDate || isDone) return { overdue:false, due_today:false, days_until_due:null };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due - today)/86400000);
  return { overdue:days < 0, due_today:days === 0, days_until_due:days };
}

async function listFeed() {
  const makeUrl = (table, select) => {
    const u = new URL(`${process.env.SUPABASE_URL}/rest/v1/${table}`);
    u.searchParams.set('select',select);
    u.searchParams.set('user_id',`eq.${process.env.KAY_USER_ID}`);
    return u;
  };

  const taskUrl = makeUrl('kay_tasks','id,name,details,due_date,owner,is_done,project_id,created_at,updated_at');
  taskUrl.searchParams.set('order','is_done.asc,due_date.asc.nullslast,created_at.asc');

  const projectUrl = makeUrl('kay_projects','id,name,workspace,type,target_date,next_move,sort_order,created_at,updated_at');
  projectUrl.searchParams.set('order','sort_order.asc,name.asc');

  const planUrl = makeUrl('kay_project_plans','id,project_id,name,source_name,source_type,summary,created_at,updated_at');
  planUrl.searchParams.set('order','updated_at.desc');

  const planTaskUrl = makeUrl('kay_project_plan_tasks','id,plan_id,project_id,name,phase,category,owner,due_date,status,priority,notes,is_done,created_at,updated_at');
  planTaskUrl.searchParams.set('order','is_done.asc,due_date.asc.nullslast,created_at.asc');

  const [taskResp, projectResp, planResp, planTaskResp] = await Promise.all([
    supabaseRequest(taskUrl),
    supabaseRequest(projectUrl),
    supabaseRequest(planUrl),
    supabaseRequest(planTaskUrl)
  ]);

  for (const [label,resp] of [['Task',taskResp],['Project',projectResp],['Plan',planResp],['Plan task',planTaskResp]]) {
    if (!resp.ok) throw new Error(`${label} query failed: ${resp.status}`);
  }

  const tasks = await taskResp.json();
  const projects = await projectResp.json();
  const plans = await planResp.json();
  const planTasks = await planTaskResp.json();

  const liveTasks = tasks.map(t => ({
    id:t.id,
    task_type:'live',
    task:t.name,
    project_id:t.project_id,
    due_date:t.due_date,
    is_done:t.is_done,
    owner:t.owner || 'Kay',
    details:t.details || null,
    updated_at:t.updated_at,
    ...taskTiming(t.due_date,t.is_done)
  }));

  const formalTasks = planTasks.map(t => ({
    id:t.id,
    task_type:'plan',
    task:t.name,
    project_id:t.project_id,
    plan_id:t.plan_id,
    due_date:t.due_date,
    is_done:t.is_done,
    owner:t.owner || 'Kay',
    details:t.notes || null,
    phase:t.phase || null,
    category:t.category || null,
    status:t.status || null,
    priority:t.priority || null,
    updated_at:t.updated_at,
    ...taskTiming(t.due_date,t.is_done)
  }));

  const projectDetails = projects.map(p => {
    const pLive = liveTasks.filter(t => String(t.project_id)===String(p.id));
    const pFormal = formalTasks.filter(t => String(t.project_id)===String(p.id));
    const pPlans = plans.filter(pl => String(pl.project_id)===String(p.id));
    const openLive = pLive.filter(t=>!t.is_done);
    const openFormal = pFormal.filter(t=>!t.is_done);

    return {
      id:p.id,
      name:p.name,
      workspace:p.workspace || p.type || null,
      target_date:p.target_date || null,
      next_move:p.next_move || null,
      plans:pPlans.map(pl => ({
        id:pl.id,
        name:pl.name,
        source_name:pl.source_name || null,
        source_type:pl.source_type || null,
        summary:pl.summary || null
      })),
      counts:{
        live_open:openLive.length,
        live_total:pLive.length,
        plan_open:openFormal.length,
        plan_total:pFormal.length
      },
      open_live_tasks:openLive,
      open_plan_tasks:openFormal
    };
  });

  const openAll = [...liveTasks.filter(t=>!t.is_done), ...formalTasks.filter(t=>!t.is_done)];
  const overdue = openAll.filter(t=>t.overdue);
  const dueToday = openAll.filter(t=>t.due_today);
  const upcoming = openAll.filter(t=>t.due_date && !t.overdue && !t.due_today);
  const unscheduled = openAll.filter(t=>!t.due_date);

  return {
    generated_at:new Date().toISOString(),
    source:'KAY // COMMAND',
    access:'Tomo project + accountability view',
    permissions:['read_projects','read_project_plans','read','create_live_task','complete','reopen','reschedule','update_details'],
    summary:{
      projects:projectDetails.length,
      open_live_tasks:liveTasks.filter(t=>!t.is_done).length,
      open_plan_tasks:formalTasks.filter(t=>!t.is_done).length,
      overdue:overdue.length,
      due_today:dueToday.length
    },
    projects:projectDetails,
    priority_stack:[...overdue,...dueToday,...upcoming,...unscheduled].slice(0,15)
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
        const task = await createTask({projectId:project_id,name:String(task_name),dueDate:due_date,details,owner});
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

    const { task_id, task_type='live', action, due_date, details } = req.body || {};
    if(!task_id || !action) return res.status(400).json({error:'task_id and action are required'});

    const isPlan = task_type==='plan';
    const task = isPlan ? await getPlanTask(task_id) : await getTask(task_id);
    if(!task) return res.status(404).json({error:'Task not found'});

    let updated;
    if(action==='complete'){
      updated = isPlan
        ? await updatePlanTask(task_id,{is_done:true,status:'Complete'})
        : await updateTask(task_id,{is_done:true});
      await logUpdate({
        taskId:isPlan?null:task.id,
        projectId:task.project_id,
        actionType:'complete',
        message:`Tomo marked ${isPlan?'project-plan ':' '}task complete: ${task.name}`
      });
    }else if(action==='reopen'){
      updated = isPlan
        ? await updatePlanTask(task_id,{is_done:false,status:'Open'})
        : await updateTask(task_id,{is_done:false});
      await logUpdate({
        taskId:isPlan?null:task.id,
        projectId:task.project_id,
        actionType:'update',
        message:`Tomo reopened ${isPlan?'project-plan ':' '}task: ${task.name}`
      });
    }else if(action==='reschedule'){
      if(!due_date || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return res.status(400).json({error:'A YYYY-MM-DD due_date is required'});
      updated = isPlan ? await updatePlanTask(task_id,{due_date}) : await updateTask(task_id,{due_date});
      await logUpdate({
        taskId:isPlan?null:task.id,
        projectId:task.project_id,
        actionType:'reschedule',
        requestedDate:due_date,
        message:`Tomo rescheduled ${isPlan?'project-plan ':' '}task "${task.name}" to ${due_date}`
      });
    }else if(action==='update_details'){
      if(typeof details!=='string') return res.status(400).json({error:'details must be text'});
      updated = isPlan
        ? await updatePlanTask(task_id,{notes:details.slice(0,5000)})
        : await updateTask(task_id,{details:details.slice(0,5000)});
      await logUpdate({
        taskId:isPlan?null:task.id,
        projectId:task.project_id,
        actionType:'update',
        message:`Tomo updated ${isPlan?'project-plan ':' '}task details: ${task.name}`
      });
    }else{
      return res.status(400).json({error:'Unsupported action',allowed:['complete','reopen','reschedule','update_details']});
    }

    return res.status(200).json({ok:true,action,task_type,task:updated});
  }catch(error){
    console.error('Tomo task API error',error);
    return res.status(500).json({error:'Unable to process Tomo task request'});
  }
}