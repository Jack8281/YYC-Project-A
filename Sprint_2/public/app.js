'use strict';

const state = {
  token: sessionStorage.getItem('yycSprint2Token') || '',
  user: null,
  users: [],
  teams: [],
  bootstrap: null,
  activeTab: 'my-jobs',
  page: 0,
  pageSize: 25,
  totalJobs: 0,
  filters: { q: '', service: '', stage: '', status: '', team: '', owner: '' },
  detail: null,
  clientResults: [],
  clientSearchTimer: null,
  toastTimer: null
};

const roleNames = {
  staff: 'Staff / Preparer', reviewer: 'Reviewer / Supervisor', manager: 'Team Manager',
  management: 'Management · Read only', director: 'Director'
};
const tabNames = {
  'my-jobs': ['My Jobs', 'Your assigned work, ordered by urgency.'],
  search: ['Job Search', 'Find permitted job status without changing work assigned to another person.'],
  'team-board': ['Team Board', 'A team-level view of job progress, review queues and ownership.'],
  'needs-review': ['Needs Manager Check', 'Work completed by staff and awaiting manager approval.'],
  overview: ['Overview', 'A cross-team snapshot of job control status.'],
  'intake-queue': ['Intake Queue', 'Unallocated jobs that need a director to choose the correct team.'],
  'all-jobs': ['All Jobs', 'Search and inspect jobs within your access level.'],
  'staff-teams': ['Staff & Teams', 'Fictitious team, staff and workload records.'],
  workflows: ['Workflow Templates', 'Audit and tax step templates used when jobs are created.'],
  audit: ['Audit Trail', 'Read-only records of actions and changes.'],
  database: ['Database & Backup', 'Related-table data model, JSON backup and restore.']
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401 && state.token) logoutLocal();
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
  }
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response;
}

async function loadDemoUsers() {
  try {
    const payload = await fetch('/api/demo-users').then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load demo accounts.');
      return body;
    });
    state.users = payload.users || [];
    state.teams = payload.teams || [];
    const select = $('#demoUserSelect');
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'Select a demo role and team…';
    select.append(first);
    const groups = [
      ['staff', 'Staff / Preparer'], ['reviewer', 'Reviewer / Supervisor'],
      ['manager', 'Team Manager'], ['management', 'Management'], ['director', 'Director']
    ];
    groups.forEach(([role, label]) => {
      const items = state.users.filter(user => user.role === role);
      if (!items.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      items.forEach(user => {
        const option = document.createElement('option');
        option.value = String(user.id);
        option.textContent = `${user.name}${user.team_name ? ` · ${user.team_name}` : ''}`;
        group.append(option);
      });
      select.append(group);
    });
    const firstStaff = state.users.find(user => user.role === 'staff' && user.team_name === 'Audit 1');
    if (firstStaff) select.value = String(firstStaff.id);
    if (state.token) {
      try { await loadWorkspace(); } catch { logoutLocal(); }
    }
  } catch (error) {
    $('#loginError').textContent = `${error.message} Make sure the Python server is running.`;
  }
}

function logoutLocal() {
  state.token = '';
  state.user = null;
  state.bootstrap = null;
  sessionStorage.removeItem('yycSprint2Token');
  $('#appShell').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
}

async function signIn() {
  const userId = $('#demoUserSelect').value;
  $('#loginError').textContent = '';
  if (!userId) {
    $('#loginError').textContent = 'Choose a demo account first.';
    return;
  }
  $('#signInButton').disabled = true;
  $('#signInButton').textContent = 'Opening workspace…';
  try {
    const payload = await api('/api/login', { method: 'POST', body: JSON.stringify({ user_id: Number(userId) }) });
    state.token = payload.token;
    state.user = payload.user;
    sessionStorage.setItem('yycSprint2Token', state.token);
    await loadWorkspace();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    $('#signInButton').disabled = false;
    $('#signInButton').innerHTML = 'Open workspace <span aria-hidden="true">→</span>';
  }
}

async function loadWorkspace() {
  const payload = await api('/api/bootstrap');
  state.bootstrap = payload;
  state.user = payload.user;
  state.teams = payload.teams || state.teams;
  const role = state.user.role;
  if (role === 'staff' || role === 'reviewer') state.activeTab = 'my-jobs';
  else if (role === 'manager') state.activeTab = 'team-board';
  else state.activeTab = 'overview';
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  renderShell();
  await renderPage();
}

function initials(name) {
  return (name || 'Demo User').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}
function humanRole(role) { return roleNames[role] || role; }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
}
function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-MY', { day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit' });
}
function statusClass(value) {
  if (value === 'On track') return 'status-on-track';
  if (value === 'At risk') return 'status-at-risk';
  if (value === 'Overdue') return 'status-overdue';
  if (value === 'On hold') return 'status-on-hold';
  return 'status-plain';
}
function statusChip(value) { return `<span class="status-chip ${statusClass(value)}">${esc(value || 'Unknown')}</span>`; }
function workflowClass(value) {
  if (/Needs manager check|Awaiting/i.test(value || '')) return 'workflow-pending';
  if (/Returned/i.test(value || '')) return 'workflow-returned';
  if (/Closed/i.test(value || '')) return 'workflow-closed';
  return '';
}
function workflowPill(value) { return `<span class="workflow-pill ${workflowClass(value)}">${esc(value || '—')}</span>`; }
function prettyService(service) { return service === 'Audit' ? 'Audit' : 'Tax'; }
function canCreateJob() { return ['manager', 'director'].includes(state.user?.role); }
function isStaffRole() { return ['staff', 'reviewer'].includes(state.user?.role); }
function isAllTeamsRole() { return ['director', 'management'].includes(state.user?.role); }

function navItems() {
  const role = state.user.role;
  if (role === 'staff' || role === 'reviewer') {
    return [
      { section: 'MY WORK' }, { id:'my-jobs', icon:'▦', label:'My Jobs' },
      { id:'search', icon:'⌕', label:'Job Search' },
      { section: 'REFERENCE' }, { id:'workflows', icon:'≋', label:'Workflow Templates' }
    ];
  }
  if (role === 'manager') {
    return [
      { section: 'TEAM CONTROL' }, { id:'team-board', icon:'▦', label:'Team Board' },
      { id:'needs-review', icon:'✓', label:'Needs Manager Check' }, { id:'all-jobs', icon:'☷', label:'Team Job List' },
      { id:'search', icon:'⌕', label:'Job Search' },
      { section: 'REFERENCE' }, { id:'staff-teams', icon:'♙', label:'Staff & Workload' },
      { id:'workflows', icon:'≋', label:'Workflow Templates' }, { id:'audit', icon:'◷', label:'Audit Trail' }
    ];
  }
  if (role === 'director') {
    return [
      { section:'OVERVIEW' }, { id:'overview', icon:'▦', label:'All-team Overview' },
      { id:'intake-queue', icon:'⇥', label:'Intake Queue' }, { id:'all-jobs', icon:'☷', label:'All Jobs' },
      { section:'ADMINISTRATION' }, { id:'staff-teams', icon:'♙', label:'Staff & Teams' },
      { id:'workflows', icon:'≋', label:'Workflow Templates' }, { id:'audit', icon:'◷', label:'Audit Trail' }, { id:'database', icon:'▤', label:'Database & Backup' }
    ];
  }
  return [
    { section:'OVERVIEW' }, { id:'overview', icon:'▦', label:'All-team Overview' },
    { id:'all-jobs', icon:'☷', label:'All Jobs' },
    { section:'REFERENCE' }, { id:'staff-teams', icon:'♙', label:'Staff & Teams' },
    { id:'workflows', icon:'≋', label:'Workflow Templates' }, { id:'audit', icon:'◷', label:'Audit Trail' }, { id:'database', icon:'▤', label:'Database & Backup' }
  ];
}

function renderShell() {
  const user = state.user;
  $('#sidebarRole').textContent = humanRole(user.role);
  $('#sidebarTeam').textContent = user.team_name || (user.role === 'director' ? 'All 8 teams · Team allocation' : 'All 8 teams');
  $('#headerUser').textContent = user.name;
  $('#headerUserRole').textContent = humanRole(user.role);
  $('#userInitials').textContent = initials(user.name);
  const nav = $('#sideNav');
  nav.innerHTML = navItems().map(item => {
    if (item.section) return `<div class="nav-section-label">${esc(item.section)}</div>`;
    return `<button class="nav-item ${state.activeTab === item.id ? 'active' : ''}" data-tab="${item.id}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${esc(item.label)}</span>${item.id === 'needs-review' ? `<span class="nav-count" id="reviewNavCount">—</span>` : ''}${item.id === 'intake-queue' ? `<span class="nav-count" id="intakeNavCount">—</span>` : ''}</button>`;
  }).join('');
  const meta = tabNames[state.activeTab] || tabNames['my-jobs'];
  $('#currentSection').textContent = meta[0];
  $('#pageTitle').textContent = meta[0];
  $('#pageSubtitle').textContent = meta[1];
  updateNavCounts().catch(() => {});
}

async function updateNavCounts() {
  if (!state.token) return;
  const stats = await api('/api/stats');
  const review = $('#reviewNavCount');
  const intake = $('#intakeNavCount');
  if (review) review.textContent = stats.counts.pending_review ?? '0';
  if (intake) intake.textContent = stats.counts.unassigned_team ?? '0';
}

async function renderPage() {
  const container = $('#pageContent');
  const tab = state.activeTab;
  const meta = tabNames[tab] || tabNames['my-jobs'];
  $('#currentSection').textContent = meta[0];
  $('#pageTitle').textContent = meta[0];
  $('#pageSubtitle').textContent = meta[1];
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  container.innerHTML = '<div class="content-card"><div class="card-body muted">Loading records…</div></div>';
  try {
    if (tab === 'my-jobs') await renderJobsPage('my-jobs');
    else if (tab === 'search') await renderJobsPage('search');
    else if (tab === 'all-jobs') await renderJobsPage('all-jobs');
    else if (tab === 'team-board') await renderTeamBoard();
    else if (tab === 'needs-review') await renderNeedsReview();
    else if (tab === 'overview') await renderOverview();
    else if (tab === 'intake-queue') await renderIntakeQueue();
    else if (tab === 'staff-teams') await renderStaffTeams();
    else if (tab === 'workflows') await renderWorkflows();
    else if (tab === 'audit') await renderAudit();
    else if (tab === 'database') await renderDatabase();
    else await renderJobsPage('my-jobs');
    await updateNavCounts();
  } catch (error) {
    container.innerHTML = `<div class="content-card"><div class="card-body"><strong>Could not load this view</strong><p class="muted">${esc(error.message)}</p><button class="button button-secondary" data-action="reload-page">Try again</button></div></div>`;
  }
}

function heading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function metric(label, value, foot, icon='•') {
  return `<div class="metric-card"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon">${icon}</span></div><strong class="metric-value">${esc(value)}</strong><span class="metric-foot">${esc(foot || '')}</span></div>`;
}
function jobTable(jobs, options = {}) {
  const showOwner = options.showOwner !== false;
  const isSearch = Boolean(options.search);
  const noRowsText = options.empty || 'No jobs match these filters.';
  const canAction = state.user.role === 'manager';
  const headers = ['Job ID','Client / group','Service','Current stage', ...(showOwner ? ['Current owner'] : []), 'Status','Workflow state', ''];
  const rows = jobs.map(job => {
    const ownerCell = showOwner ? `<td>${esc(job.owner_name || 'Not assigned')}${job.owner_name ? `<span class="subtext">${esc(job.team_name || 'No team')}</span>` : ''}</td>` : '';
    let actionCell = '';
    if (job.status_only) actionCell = `<td><span class="readonly-tag">Status only</span></td>`;
    else actionCell = `<td><button class="button button-secondary button-small" data-open-job="${job.id}">Details</button>${['staff','reviewer','manager'].includes(state.user.role) && job.current_owner_id === state.user.id && job.approval_status !== 'pending' ? ` <button class="button button-primary button-small" data-done-job="${job.id}">Done</button>` : ''}</td>`;
    const service = `<span class="workflow-pill">${esc(job.service)}</span>`;
    return `<tr><td><button class="job-link" data-open-job="${job.id}" ${job.status_only?'disabled':''}>${esc(job.job_id)}</button><span class="subtext">${job.days_elapsed !== undefined ? `${Number(job.days_elapsed)} days elapsed` : 'Read-only search result'}</span></td><td><span class="client-name">${esc(job.client_name)}</span><span class="subtext">${esc(job.group_name || '')}</span></td><td>${service}</td><td>${esc(job.current_stage || '—')}</td>${ownerCell}<td>${statusChip(job.urgency_status)}</td><td>${workflowPill(job.workflow_status)}</td>${actionCell}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="table-empty">${esc(noRowsText)}</td></tr>`}</tbody></table></div>`;
}
function filtersHTML(options = {}) {
  const role = state.user.role;
  const allTeams = isAllTeamsRole();
  const includeOwner = ['manager','management','director'].includes(role);
  return `<form id="jobFiltersForm" class="filter-bar">
    <input class="control search-input" name="q" id="filterQ" value="${esc(state.filters.q)}" placeholder="Search client, Job ID or group…" aria-label="Search client, job ID or group">
    <select class="control" name="service" aria-label="Filter service"><option value="">All services</option><option ${state.filters.service==='Audit'?'selected':''}>Audit</option><option ${state.filters.service==='Tax'?'selected':''}>Tax</option></select>
    <select class="control" name="stage" aria-label="Filter stage"><option value="">All stages</option>${['Preparation','Review','Amendments','Draft to client','Client review','Re-review','Finalisation','Submission'].map(x=>`<option ${state.filters.stage===x?'selected':''}>${x}</option>`).join('')}</select>
    <select class="control" name="status" aria-label="Filter status"><option value="">All statuses</option>${['On track','At risk','Overdue','On hold'].map(x=>`<option ${state.filters.status===x?'selected':''}>${x}</option>`).join('')}</select>
    ${allTeams ? `<select class="control" name="team" aria-label="Filter team"><option value="">All teams</option>${state.teams.map(x=>`<option value="${esc(x.name)}" ${state.filters.team===x.name?'selected':''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
    <input class="control" name="owner" aria-label="Filter owner" value="${esc(state.filters.owner)}" placeholder="Owner name…">
    <button type="submit" class="button button-primary button-small">Search</button>
  </form>`;
}

async function renderJobsPage(kind) {
  const isMyJobs = kind === 'my-jobs';
  const isSearch = kind === 'search';
  const title = isMyJobs ? 'My assigned jobs' : isSearch ? 'Search visible job status' : (state.user.role === 'manager' ? 'Team jobs' : 'All jobs');
  let actions = '';
  if (canCreateJob()) actions += '<button class="button button-primary" data-action="open-create">＋ Create job</button>';
  if (isMyJobs) actions += '<button class="button button-secondary" data-tab="search">Search other job status</button>';
  const result = await api(`/api/jobs?${new URLSearchParams({ mode: isSearch ? 'search' : 'normal', q:state.filters.q, service:state.filters.service, stage:state.filters.stage, status:state.filters.status, team:state.filters.team, owner:state.filters.owner, limit:String(state.pageSize), offset:String(state.page*state.pageSize) })}`);
  state.totalJobs = result.total;
  const stats = await api('/api/stats');
  const counts = stats.counts;
  let intro = '';
  if (isSearch && isStaffRole()) intro = `<div class="hint-strip"><span class="hint-symbol">ⓘ</span><div><strong>Read-only cross-service search.</strong> Search is limited to your team's client portfolio. For jobs assigned to another person/team, only the client/group label, service, stage and status are exposed; opening full details is blocked.</div></div>`;
  else if (isMyJobs) intro = `<div class="hint-strip"><span class="hint-symbol">↗</span><div><strong>Work assigned to you.</strong> Other jobs do not appear in My Jobs. Use Job Search to check permitted audit/tax status without editing another person's work.</div></div>`;
  else if (state.user.role === 'manager') intro = `<div class="hint-strip"><span class="hint-symbol">✓</span><div><strong>Manager view.</strong> You can see jobs in ${esc(state.user.team_name)}. Initial assignment and reassignment are manager-only; director-only team allocation remains in the Intake Queue.</div></div>`;
  const summary = isMyJobs ? `<div class="summary-grid">${metric('Active jobs',counts.total,'Assigned to you','▦')}${metric('Overdue',counts.Overdue,'Needs attention','!')}${metric('At risk',counts['At risk'],'Target approaching / passed','◷')}${metric('On track',counts['On track'],'Within current target','✓')}</div>` : '';
  const empty = isSearch ? 'No permitted status matches. Try a client name, group or Job ID.' : 'No jobs match the current filters.';
  const pagination = `<div class="pagination"><span>Showing ${result.total ? state.page*state.pageSize+1 : 0}–${Math.min((state.page+1)*state.pageSize,result.total)} of ${result.total.toLocaleString()} jobs</span><div class="pagination-actions"><button class="button button-secondary button-small" data-page="prev" ${state.page===0?'disabled':''}>← Previous</button><button class="button button-secondary button-small" data-page="next" ${((state.page+1)*state.pageSize>=result.total)?'disabled':''}>Next →</button></div></div>`;
  $('#pageContent').innerHTML = `${heading(title, isMyJobs ? 'Sorted by urgency: overdue, at risk, on hold, then on track.' : isSearch ? 'At least three characters are required for staff status searches.' : 'Filter the jobs visible to your role.', actions)}${intro}${summary}<div class="content-card"><div class="card-header"><div><h3>${isSearch?'Job status search':isMyJobs?'Jobs assigned to you':state.user.role==='manager'?'Team job list':'Job register'}</h3><p>${isSearch && isStaffRole() ? 'Cross-service results remain read-only.' : `${result.total.toLocaleString()} records match your current view.`}</p></div><span class="readonly-tag">${isSearch?'Status lookup':'Role-filtered list'}</span></div>${filtersHTML()}${jobTable(result.jobs,{showOwner:!isSearch || !isStaffRole(),search:isSearch,empty})}${pagination}</div>`;
}

async function renderTeamBoard() {
  const stats = await api('/api/stats');
  const jobs = await api(`/api/jobs?${new URLSearchParams({limit:'12',offset:'0'})}`);
  const staff = await api('/api/team-staff');
  const reviewCount = stats.counts.pending_review || 0;
  const workload = staff.staff.filter(x => ['staff','reviewer'].includes(x.role)).sort((a,b)=>b.active_jobs-a.active_jobs).slice(0,6);
  const workloadRows = workload.map(person => `<tr><td><span class="client-name">${esc(person.name)}</span><span class="subtext">${esc(humanRole(person.role))}</span></td><td>${person.active_jobs}</td><td><span class="workflow-pill">${esc(person.status)}</span></td></tr>`).join('');
  $('#pageContent').innerHTML = `${heading('Team Board',`Live team view for ${state.user.team_name}.`,`<button class="button button-primary" data-action="open-create">＋ Create job</button><button class="button button-secondary" data-tab="needs-review">View review queue (${reviewCount})</button>`)}
    <div class="summary-grid">${metric('Team jobs',stats.counts.total,'Jobs in your team','▦')}${metric('Overdue',stats.counts.Overdue,'Review late work','!')}${metric('At risk',stats.counts['At risk'],'Keep an eye on these','◷')}${metric('Needs manager check',reviewCount,'Approve or return work','✓')}</div>
    <div class="split-grid"><div class="content-card"><div class="card-header"><div><h3>Team jobs by urgency</h3><p>Highest urgency first; click a job to inspect its timeline.</p></div><button class="button button-secondary button-small" data-tab="all-jobs">Full list</button></div>${jobTable(jobs.jobs,{showOwner:true,empty:'No jobs in this team.'})}</div>
    <div class="content-card"><div class="card-header"><div><h3>Workload by staff member</h3><p>Active jobs currently owned by each person.</p></div></div><div class="table-wrap"><table><thead><tr><th>Staff member</th><th>Jobs</th><th>Status</th></tr></thead><tbody>${workloadRows || '<tr><td colspan="3" class="table-empty">No staff records.</td></tr>'}</tbody></table></div><div class="card-body"><p class="metric-caption">Workload counts are a basic prototype measure. A full workload-balancing report is planned for later sprint work.</p></div></div></div>`;
}

async function renderNeedsReview() {
  const result = await api(`/api/jobs?${new URLSearchParams({needs_review:'1',limit:'50',offset:'0'})}`);
  $('#pageContent').innerHTML = `${heading('Needs Manager Check','Review completed work before it moves to the next workflow step.')}<div class="hint-strip"><span class="hint-symbol">✓</span><div><strong>Manager decision required.</strong> Open a job and approve it to advance to the next template step, or return it with a reason. The action is recorded in the audit trail.</div></div><div class="content-card"><div class="card-header"><div><h3>Pending checks</h3><p>${result.total} job(s) are waiting for review in your team.</p></div></div>${jobTable(result.jobs,{showOwner:true,empty:'There are no jobs waiting for a manager check.'})}</div>`;
}

async function renderOverview() {
  const [stats] = await Promise.all([api('/api/stats')]);
  const c = stats.counts;
  const allTeamRows = stats.byTeam.map(team => {
    const onTrack = Math.max(0, team.jobs - (team.overdue || 0) - (team.pending_review || 0));
    return `<tr><td><span class="client-name">${esc(team.name)}</span></td><td>${esc(team.service)}</td><td>${Number(team.jobs).toLocaleString()}</td><td>${Number(team.overdue||0).toLocaleString()}</td><td>${Number(team.pending_review||0).toLocaleString()}</td><td><div class="progress-track"><div class="progress-fill" style="width:${team.jobs?Math.max(0,Math.min(100,100*(team.jobs-(team.overdue||0))/team.jobs)):0}%"></div></div><span class="subtext">${team.jobs?Math.round(100*(team.jobs-(team.overdue||0))/team.jobs):0}% not overdue</span></td></tr>`;
  }).join('');
  const isDirector = state.user.role === 'director';
  const title = isDirector ? 'Director overview' : 'Management overview';
  const button = isDirector ? '<button class="button button-primary" data-action="open-create">＋ Create job</button><button class="button button-secondary" data-tab="intake-queue">Open intake queue</button>' : '<button class="button button-secondary" data-tab="all-jobs">View all jobs</button>';
  $('#pageContent').innerHTML = `${heading(title,'Cross-team visibility for management. Directors also allocate unassigned jobs to the appropriate team.',button)}
    <div class="summary-grid">${metric('All jobs',c.total.toLocaleString(),'Fictitious demo dataset','▦')}${metric('Overdue',c.Overdue.toLocaleString(),'Status labels in current sample','!')}${metric('At risk',c['At risk'].toLocaleString(),'Target monitoring sample','◷')}${metric('Awaiting team',c.unassigned_team.toLocaleString(),'Director allocation queue','⇥')}</div>
    <div class="team-grid">${stats.byTeam.map(team=>`<div class="team-card"><div class="team-title"><span>${esc(team.name)}</span><span class="workflow-pill">${esc(team.service)}</span></div><strong>${Number(team.jobs).toLocaleString()}</strong><p>Jobs in current dataset</p><div class="team-micro"><span><b>${team.overdue||0}</b> overdue</span><span>${team.pending_review||0} pending check</span></div><div class="progress-track"><div class="progress-fill" style="width:${team.jobs?Math.max(0,Math.min(100,100*(team.jobs-(team.overdue||0))/team.jobs)):0}%"></div></div></div>`).join('')}</div>
    <div class="content-card"><div class="card-header"><div><h3>Team status overview</h3><p>Summary view across all eight teams; management view is read-only.</p></div><span class="readonly-tag">All teams</span></div><div class="table-wrap"><table><thead><tr><th>Team</th><th>Service</th><th>Jobs</th><th>Overdue</th><th>Needs check</th><th>Not overdue</th></tr></thead><tbody>${allTeamRows}</tbody></table></div></div>
    <div class="notice-card" style="margin-top:16px"><strong>Prototype limitation</strong>The backlog's automatic status calculation, full target variance rules, workload balancing and management KPI calculations are Sprint 3/Sprint 6 work. This view displays the generated sample statuses and is intended to validate role visibility and navigation first.</div>`;
}

async function renderIntakeQueue() {
  const result = await api(`/api/jobs?${new URLSearchParams({unassigned_team:'1',limit:'50',offset:'0'})}`);
  $('#pageContent').innerHTML = `${heading('Director Intake Queue','Choose the team manually. Automatic team routing is intentionally not used after the client feedback.','<button class="button button-primary" data-action="open-create">＋ Create job</button>')}<div class="hint-strip"><span class="hint-symbol">⇥</span><div><strong>Director decision.</strong> The service and client portfolio limit the available team choices. After a team is selected, the team manager assigns the staff owner. Only directors can complete the team-allocation step.</div></div><div class="content-card"><div class="card-header"><div><h3>Awaiting team allocation</h3><p>${result.total} job(s) have no team yet.</p></div><span class="readonly-tag">Director only</span></div>${jobTable(result.jobs,{showOwner:false,empty:'The Intake Queue is empty.'})}</div>`;
}

async function renderStaffTeams() {
  const payload = await api('/api/team-staff');
  const staffRows = payload.staff.map(person => `<tr><td><span class="client-name">${esc(person.name)}</span><span class="subtext">${esc(person.email)}</span></td><td>${esc(person.team_name || 'All teams')}</td><td>${esc(humanRole(person.role))}</td><td><span class="workflow-pill">${esc(person.status)}</span></td><td>${person.active_jobs}</td></tr>`).join('');
  $('#pageContent').innerHTML = `${heading('Staff & Teams','Role, team and active-job references for the current access scope.')}<div class="summary-grid">${metric('Visible staff',payload.staff.length,'Filtered by role/team','♙')}${metric('Active',payload.staff.filter(s=>s.status==='Active').length,'Can be assigned work','✓')}${metric('On leave',payload.staff.filter(s=>s.status==='On leave').length,'Assignment blocked','◷')}${metric('Resigned',payload.staff.filter(s=>s.status==='Resigned').length,'Assignment blocked','!')}</div><div class="content-card"><div class="card-header"><div><h3>Staff directory</h3><p>Staff email addresses use the reserved example.invalid domain; they are not real accounts.</p></div></div><div class="table-wrap"><table><thead><tr><th>Name / email</th><th>Team</th><th>Role</th><th>Status</th><th>Active jobs</th></tr></thead><tbody>${staffRows}</tbody></table></div></div>`;
}

async function renderWorkflows() {
  const payload = await api('/api/workflows');
  const templates = payload.templates.map(template => `<div class="workflow-template"><div class="workflow-template-head"><strong>${esc(template.service)} workflow</strong><span>${esc(template.version)} · ${template.steps.length} steps</span></div><ol>${template.steps.map(step=>`<li><b>${esc(step.name)}</b><span>Owner: ${esc(step.owner_role)} · ${step.estimated_days ? `${step.estimated_days} day(s)` : 'No duration supplied'}</span></li>`).join('')}</ol><p class="metric-caption">First-draft target in this demo: ${template.service==='Audit'?'45':'65'} days from MA received. Detailed step durations must be confirmed with YYC; values shown are provisional placeholders that align to the target.</p></div>`).join('');
  $('#pageContent').innerHTML = `${heading('Workflow Templates','New jobs copy the active service template into linked Job Step records.')}<div class="hint-strip"><span class="hint-symbol">≋</span><div><strong>Separate workflow templates.</strong> Audit and tax use different templates. The first-draft target is 45 calendar days for audit and 65 for tax. The client brief says detailed step durations will be supplied separately, so allocations in this demo are provisional and should not be presented as final YYC-approved estimates.</div></div><div class="workflow-list">${templates}</div>`;
}

async function renderAudit() {
  const payload = await api('/api/audit');
  const items = payload.audit.map(row => `<div class="audit-item"><strong>${esc(row.action)} · ${esc(row.entity_type)} ${esc(row.entity_id)}</strong><p>By ${esc(row.actor_name)}${row.old_value ? ` · Old: ${esc(shorten(row.old_value,180))}`:''}${row.new_value ? ` · New: ${esc(shorten(row.new_value,180))}`:''}</p><time>${esc(fmtTime(row.created_at))}</time></div>`).join('');
  $('#pageContent').innerHTML = `${heading('Audit Trail','Read-only history for create, Done, manager review, assignment and reassignment actions.')}<div class="hint-strip"><span class="hint-symbol">◷</span><div><strong>Append-only in the app.</strong> The interface has no edit/delete control for audit records. For an actual production system, also enforce append-only permissions and retention through the deployment platform.</div></div><div class="content-card"><div class="card-header"><div><h3>Recent actions</h3><p>Showing the latest 100 actions available to your role.</p></div><span class="readonly-tag">Read only</span></div><div class="card-body"><div class="audit-list">${items || '<p class="table-empty">No audit actions yet. Create a job or complete a step to see activity.</p>'}</div></div></div>`;
}

async function renderDatabase() {
  const [payload, workflows] = await Promise.all([api('/api/bootstrap'),api('/api/workflows')]);
  const c = payload.counts;
  const cards = [
    ['Teams',c.teams,'Eight service teams: Audit 1/2/11/12 and Tax 1/2/11/12.'],
    ['Staff',c.staff,'Fictitious role and active-status records.'],
    ['Client groups',c.groups,'Groups are linked to clients with a portfolio code.'],
    ['Clients',c.clients,'Fictional client names; no real YYC client data.'],
    ['Workflow templates',workflows.templates.length,'Audit and tax templates are stored separately.'],
    ['Jobs',Number(c.jobs).toLocaleString(),'Jobs link to client, group, team, template, owner and step records.']
  ].map(([title,value,desc])=>`<div class="data-card"><h3>${esc(title)}</h3><div class="data-number">${esc(value)}</div><p>${esc(desc)}</p></div>`).join('');
  const canBackup = ['management','director'].includes(state.user.role);
  $('#pageContent').innerHTML = `${heading('Database & Backup','The app uses a local SQLite relational database; no database server or third-party Python package is required.')}<div class="data-grid">${cards}</div><div class="content-card"><div class="card-header"><div><h3>Linked data model</h3><p>Data is split into related tables instead of one large spreadsheet.</p></div><span class="readonly-tag">SQLite</span></div><div class="card-body"><p class="muted" style="font-size:12px;line-height:1.7;margin-top:0">Teams ↔ Staff · Client Groups ↔ Clients · Workflow Templates ↔ Template Steps · Clients + Groups + Teams + Staff + Workflow Template ↔ Jobs · Jobs ↔ Job Steps · Jobs ↔ Assignment History · Audit Log ↔ Actor</p><p class="metric-caption">Indexed columns include Team, Status, CurrentOwner, Service, Client, assigned step and audit entity. The local SQLite file is <code>sprint2/yyc_demo.db</code>.</p></div></div>
    <div class="content-card"><div class="card-header"><div><h3>Backup and restore</h3><p>Management can download a backup. Directors can restore a JSON backup.</p></div><span class="readonly-tag">Local prototype</span></div><div class="card-body"><div class="hint-strip"><span class="hint-symbol">i</span><div><strong>Not an M365 production backup.</strong> This downloads a copy of the local prototype database. For YYC, the final backup/restore policy must be agreed and tested in the selected M365/hosting environment.</div></div>${canBackup?`<div class="heading-actions"><button class="button button-primary" data-action="backup-json">Download JSON backup</button><button class="button button-secondary" data-action="backup-sqlite">Download SQLite backup</button>${state.user.role==='director'?'<button class="button button-secondary" data-action="restore-json">Restore JSON backup</button>':''}</div>`:`<p class="muted" style="font-size:11px">Backup downloads are restricted to management and directors.</p>`}<p id="backupStatus" class="metric-caption"></p></div></div>
    <div class="content-card"><div class="card-header"><div><h3>Data handling note</h3><p>Project Sprint 2 safety boundary</p></div></div><div class="card-body"><p class="muted" style="font-size:12px;line-height:1.65;margin-top:0">This prototype contains only generated fictional records and reserved example.invalid email addresses. Do not import real client records, personal identifiers, real staff information, or confidential documents. Do not send YYC data to public AI tools. A production build needs approved identity, access permissions, environment separation, backup retention and PDPA review.</p></div></div>`;
}

function shorten(value, max) {
  const str = String(value || '');
  return str.length > max ? `${str.slice(0,max)}…` : str;
}

async function openJob(jobId) {
  try {
    const payload = await api(`/api/jobs/${jobId}`);
    state.detail = payload;
    renderDetail(payload);
    $('#detailDialog').showModal();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderDetail(payload) {
  const job = payload.job;
  const permissions = payload.permissions;
  const steps = payload.steps.map(step => {
    const completed = step.status === 'Completed';
    const current = step.step_no === job.current_step_no;
    const meta = completed ? `Completed ${fmtTime(step.completed_at)} · ${step.completed_by_name || 'Fictitious seed record'}` : `Planned day ${step.planned_day} · Owner role: ${step.owner_role}`;
    return `<div class="timeline-step ${completed?'completed':''} ${current?'current':''}"><div class="timeline-dot">${completed?'✓':step.step_no}</div><div><h4>${esc(step.name)}</h4><p>${esc(meta)}${step.completion_note?`<br>Note: ${esc(step.completion_note)}`:''}</p></div><span class="step-state">${esc(step.status)}</span></div>`;
  }).join('');
  const auditItems = payload.audit.map(row=>`<div class="audit-item"><strong>${esc(row.action)} · ${esc(row.actor_name)}</strong><p>${row.old_value?`Old: ${esc(shorten(row.old_value,160))} `:''}${row.new_value?`New: ${esc(shorten(row.new_value,180))}`:''}</p><time>${esc(fmtTime(row.created_at))}</time></div>`).join('');
  const assignmentItems = payload.assignments.map(row=>`<div class="audit-item"><strong>${esc(row.from_name||'Unassigned')} → ${esc(row.to_name||'Unassigned')}</strong><p>Reason: ${esc(row.reason)} · Changed by ${esc(row.changed_by_name)}</p><time>${esc(fmtTime(row.changed_at))}</time></div>`).join('');
  const linkedServiceName = job.service === 'Audit' ? 'Tax' : 'Audit';
  const linkedServiceJobs = (payload.linkedServiceJobs || []).map(linked => `<div class="detail-item"><span>${esc(linked.service)} job · ${esc(linked.job_id)}</span><strong>${esc(linked.team_name || 'Awaiting team allocation')}<br>${esc(linked.current_stage || linked.workflow_status || 'Stage not set')}<br><span style="display:inline-flex;gap:5px;flex-wrap:wrap;margin-top:7px">${statusChip(linked.urgency_status)}${workflowPill(linked.workflow_status)}</span></strong></div>`).join('');
  let actionBox = '';
  if (permissions.can_done) {
    actionBox += `<div class="detail-action-box"><h3>Update current step</h3><p>Press Done once. The app records your name and timestamp, then sends the step to the team manager for checking before the workflow moves on.</p><button class="button button-primary" data-detail-action="done" data-job-id="${job.id}">✓ Mark current step Done</button></div>`;
  }
  if (permissions.can_review) {
    actionBox += `<div class="detail-action-box"><h3>Manager check</h3><p>Approve to advance to the next step and assign its owner from the workflow template. Return sends it back to the preparer and records the reason.</p><div class="field"><label for="returnReason">Return reason (required only when returning)</label><textarea id="returnReason" class="control" rows="2" placeholder="e.g. Please clarify the supporting schedule…"></textarea></div><div class="action-row"><button class="button button-danger" data-detail-action="return" data-job-id="${job.id}">Return for amendment</button><button class="button button-success" data-detail-action="approve" data-job-id="${job.id}">Approve &amp; continue</button></div></div>`;
  }
  if (permissions.can_team_assign && payload.teamChoices.length) {
    actionBox += `<div class="detail-action-box"><h3>Director: assign this job to a team</h3><p>Service and client portfolio constrain the team options. Team allocation is manual, not automatic.</p><div class="inline-form"><div class="field"><label for="teamChoice">Destination team</label><select class="control" id="teamChoice">${payload.teamChoices.map(t=>`<option value="${t.id}">${esc(t.name)} · ${esc(t.service)}</option>`).join('')}</select></div><button class="button button-primary" data-detail-action="assign-team" data-job-id="${job.id}">Assign team</button></div></div>`;
  }
  if (permissions.can_assign) {
    const isAssigned = Boolean(job.current_owner_id);
    actionBox += `<div class="detail-action-box"><h3>${isAssigned?'Reassign job':'Assign preparer'}</h3><p>${isAssigned?'Only the team manager can reassign an active job. A reason and history entry are required.':'Choose an active member of this team to take ownership.'}</p><div class="inline-form"><div class="field"><label for="ownerChoice">New owner</label><select class="control" id="ownerChoice"><option value="">Choose staff member…</option>${payload.staffChoices.map(person=>`<option value="${person.id}" ${person.id===job.current_owner_id?'selected':''}>${esc(person.name)} · ${esc(humanRole(person.role))}</option>`).join('')}</select></div><div class="field"><label for="reassignReason">Reason</label><select id="reassignReason" class="control"><option value="">Select reason…</option><option>Initial preparer assignment</option><option>On leave</option><option>Resigned</option><option>Workload</option><option>Other</option></select></div><button class="button button-primary" data-detail-action="assign" data-job-id="${job.id}">${isAssigned?'Reassign':'Assign owner'}</button></div></div>`;
  }
  if (!actionBox) actionBox = `<div class="detail-action-box"><h3>${permissions.read_only?'Read-only job details':'No action available'}</h3><p>${permissions.read_only?'This role can view the full job and timeline but cannot update or assign it.':'You can view this job, but only the current owner can mark their step Done.'}</p></div>`;

  $('#detailContent').innerHTML = `<div class="detail-head"><div><span class="eyebrow">JOB DETAIL · ${esc(job.service.toUpperCase())}</span><h2>${esc(job.job_id)}</h2><p>${esc(job.client_name)} · ${esc(job.group_name)}</p><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">${statusChip(job.urgency_status)}${workflowPill(job.workflow_status)}${job.approval_status==='pending'?'<span class="workflow-pill workflow-pending">Awaiting manager check</span>':''}</div></div><div class="detail-head-actions"><button class="button button-secondary button-small" data-action="refresh-detail" data-job-id="${job.id}">Refresh</button><button type="button" class="icon-button" data-close-dialog="detailDialog" aria-label="Close">×</button></div></div>
    <div class="detail-body"><div class="detail-metrics"><div class="detail-metric"><span>Days since MA received</span><strong>${job.days_elapsed} days</strong></div><div class="detail-metric"><span>First draft target</span><strong>${job.target_days} days</strong></div><div class="detail-metric"><span>FYE</span><strong>${fmtDate(job.fye_date)}</strong></div><div class="detail-metric"><span>Draft number</span><strong>Draft ${job.draft_number}</strong></div></div>
    <div class="detail-grid"><div class="detail-item"><span>Client / group</span><strong>${esc(job.client_name)}<br>${esc(job.group_name)}</strong></div><div class="detail-item"><span>Service / team</span><strong>${esc(job.service)} · ${esc(job.team_name||'Awaiting director allocation')}</strong></div><div class="detail-item"><span>Current owner</span><strong>${esc(job.owner_name||'Not assigned')}</strong></div><div class="detail-item"><span>MA received</span><strong>${fmtDate(job.ma_received_at)}</strong></div><div class="detail-item"><span>First draft sent</span><strong>${fmtDate(job.first_draft_sent_at)}</strong></div><div class="detail-item"><span>Current workflow step</span><strong>${esc(job.current_stage||job.current_step_name||'Not allocated')}</strong></div></div>
    <div class="detail-section-title">Linked ${linkedServiceName} job status <span>Read only · same client</span></div>${linkedServiceJobs ? `<div class="detail-grid">${linkedServiceJobs}</div>` : `<p class="metric-caption">No linked ${linkedServiceName.toLowerCase()} job was found for this client. Cross-service status never includes the other job's owner or detailed timeline.</p>`}
    <div class="detail-section-title">Workflow timeline <span>Planned day · status · completion history</span></div><div class="timeline">${steps}</div>${job.approval_comment?`<div class="notice-card"><strong>Latest manager comment</strong>${esc(job.approval_comment)}</div>`:''}${actionBox}
    <div class="detail-section-title">Assignment history <span>Newest first</span></div><div class="audit-list">${assignmentItems||'<p class="metric-caption">No assignment changes recorded yet.</p>'}</div>
    <div class="detail-section-title">Job audit history <span>Read only</span></div><div class="audit-list">${auditItems||'<p class="metric-caption">No actions for this seeded job have been recorded yet. Actions from this point forward will appear here.</p>'}</div></div>`;
}

async function performJobAction(button) {
  const action = button.dataset.detailAction;
  const jobId = button.dataset.jobId;
  const routeAction = action === 'assign' ? ($('#ownerChoice')?.value && state.detail.job.current_owner_id ? 'reassign' : 'assign') : action;
  let body = {};
  if (action === 'return') {
    body.comment = ($('#returnReason')?.value || '').trim();
  } else if (action === 'assign') {
    body.staff_id = Number($('#ownerChoice')?.value || 0);
    body.reason = ($('#reassignReason')?.value || '').trim();
  } else if (action === 'assign-team') {
    body.team_id = Number($('#teamChoice')?.value || 0);
  }
  button.disabled = true;
  try {
    const response = await api(`/api/jobs/${jobId}/${routeAction}`, { method:'POST', body:JSON.stringify(body) });
    toast(response.message || 'Saved.');
    const payload = await api(`/api/jobs/${jobId}`);
    state.detail = payload;
    renderDetail(payload);
    await renderPage();
    $('#detailDialog').showModal();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function openCreateDialog() {
  $('#createError').textContent = '';
  $('#clientSearch').value = '';
  $('#clientId').innerHTML = '<option value="">Search for a client first</option>';
  $('#serviceSelect').value = state.user.team_service === 'Tax' ? 'Tax' : 'Audit';
  $('#maDate').value = new Date().toISOString().slice(0,10);
  $('#fyeDate').value = new Date().toISOString().slice(0,10);
  $('#createDialog').showModal();
  searchClients('');
}

async function searchClients(query) {
  const hint = $('#clientSearchHint');
  if (!$('#clientId')) return;
  try {
    const payload = await api(`/api/clients?${new URLSearchParams({q:query||''})}`);
    state.clientResults = payload.clients;
    const select = $('#clientId');
    const previous = select.value;
    select.innerHTML = '<option value="">Choose a client…</option>' + payload.clients.map(client => `<option value="${client.id}">${esc(client.client_code)} · ${esc(client.client_name)} · ${esc(client.group_name)}</option>`).join('');
    if (previous && payload.clients.some(c=>String(c.id)===previous)) select.value = previous;
    hint.textContent = `${payload.clients.length} matching client(s) shown. Type more of the name or code to narrow the list.`;
  } catch (error) {
    hint.textContent = error.message;
  }
}

async function createJob(event) {
  event.preventDefault();
  $('#createError').textContent = '';
  const button = $('#createJobForm button[type="submit"]');
  button.disabled = true;
  const body = { client_id:Number($('#clientId').value||0), service:$('#serviceSelect').value, fye_date:$('#fyeDate').value, ma_received_at:$('#maDate').value };
  try {
    const response = await api('/api/jobs',{method:'POST',body:JSON.stringify(body)});
    $('#createDialog').close();
    toast(`Created ${response.job_id}. ${response.message}`);
    if (state.user.role === 'director') state.activeTab = 'intake-queue';
    else state.activeTab = 'team-board';
    renderShell();
    await renderPage();
    if (response.job_id) {
      // The created job may be unassigned, so its details are only opened after the director allocates a team.
    }
  } catch (error) {
    $('#createError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function downloadBackup(kind) {
  const status = $('#backupStatus');
  if (status) status.textContent = 'Preparing backup…';
  try {
    let response;
    let filename;
    if (kind === 'json') {
      response = await fetch('/api/backup-json', {headers:{Authorization:`Bearer ${state.token}`}});
      filename = 'yyc-sprint2-backup.json';
    } else {
      response = await fetch('/api/backup', {headers:{Authorization:`Bearer ${state.token}`}});
      filename = 'yyc-sprint2-backup.sqlite';
    }
    if (!response.ok) {
      const payload = await response.json().catch(()=>({}));
      throw new Error(payload.error || 'Unable to download backup.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    if (status) status.textContent = `Backup downloaded (${Math.round(blob.size/1024)} KB). Keep it in a secure location.`;
    toast('Backup downloaded.');
  } catch (error) {
    if (status) status.textContent = error.message;
    toast(error.message,true);
  }
}

async function restoreJsonBackup() {
  const input = $('#restoreFile');
  input.value = '';
  input.click();
}

async function handleRestoreFile(file) {
  if (!file) return;
  const status = $('#backupStatus');
  if (!window.confirm(`Restore ${file.name}? This replaces the current demo database. Download a backup first if you need to keep the current state.`)) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.format !== 'YYC Sprint 2 JSON backup') throw new Error('This is not a YYC Sprint 2 JSON backup.');
    const result = await api('/api/restore',{method:'POST',body:JSON.stringify({backup})});
    if (status) status.textContent = result.message;
    toast(result.message);
    logoutLocal();
    await loadDemoUsers();
  } catch (error) {
    if (status) status.textContent = error.message;
    toast(error.message,true);
  }
}

function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error',isError);
  element.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=>element.classList.add('hidden'),6500);
}

function switchTab(tab) {
  if (!tabNames[tab]) return;
  state.activeTab = tab;
  state.page = 0;
  if (tab === 'search' || tab === 'all-jobs' || tab === 'my-jobs') {
    state.filters = { q:'',service:'',stage:'',status:'',team:'',owner:'' };
  }
  renderShell();
  renderPage();
}

async function handleClick(event) {
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) { event.preventDefault(); switchTab(tabButton.dataset.tab); return; }
  const openButton = event.target.closest('[data-open-job]');
  if (openButton && !openButton.disabled) { event.preventDefault(); await openJob(Number(openButton.dataset.openJob)); return; }
  const doneButton = event.target.closest('[data-done-job]');
  if (doneButton) { event.preventDefault(); await quickDone(Number(doneButton.dataset.doneJob)); return; }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'open-create') openCreateDialog();
    if (action === 'reload-page') renderPage();
    if (action === 'backup-json') downloadBackup('json');
    if (action === 'backup-sqlite') downloadBackup('sqlite');
    if (action === 'restore-json') restoreJsonBackup();
    if (action === 'refresh-detail') await openJob(Number(actionButton.dataset.jobId));
    return;
  }
  const detailAction = event.target.closest('[data-detail-action]');
  if (detailAction) { await performJobAction(detailAction); return; }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton && !pageButton.disabled) {
    if (pageButton.dataset.page === 'prev') state.page = Math.max(0,state.page-1);
    else state.page += 1;
    await renderPage();
    return;
  }
  const close = event.target.closest('[data-close-dialog]');
  if (close) { const dialog = document.getElementById(close.dataset.closeDialog); if (dialog?.open) dialog.close(); }
}

async function quickDone(jobId) {
  try {
    const response = await api(`/api/jobs/${jobId}/done`,{method:'POST',body:'{}'});
    toast(response.message);
    await renderPage();
  } catch (error) { toast(error.message,true); }
}

async function handleFilterSubmit(event) {
  if (event.target.id !== 'jobFiltersForm') return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.filters = Object.fromEntries(['q','service','stage','status','team','owner'].map(key=>[key,String(form.get(key)||'').trim()]));
  state.page = 0;
  await renderPage();
}

function logout() {
  const token = state.token;
  if (token) api('/api/logout',{method:'POST',body:'{}'}).catch(()=>{});
  logoutLocal();
  $('#loginError').textContent = '';
}

$('#signInButton').addEventListener('click',signIn);
$('#demoUserSelect').addEventListener('keydown',event=>{if(event.key==='Enter')signIn();});
$('#logoutButton').addEventListener('click',logout);
$('#createJobForm').addEventListener('submit',createJob);
$('#clientSearch').addEventListener('input',()=>{
  clearTimeout(state.clientSearchTimer);
  const query = $('#clientSearch').value.trim();
  state.clientSearchTimer = setTimeout(()=>searchClients(query),250);
});
$('#clientId').addEventListener('change',()=>{
  const client = state.clientResults.find(c=>String(c.id)===$('#clientId').value);
  if (!client) return;
  const today = new Date();
  let year = today.getFullYear();
  const month = Number(client.fye_month);
  const day = Number(client.fye_day);
  if (month < today.getMonth()+1 || (month === today.getMonth()+1 && day < today.getDate())) year++;
  $('#fyeDate').value = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
});
$('#serviceSelect').addEventListener('change',()=>{});
$('#restoreFile').addEventListener('change',event=>handleRestoreFile(event.target.files?.[0]));
document.addEventListener('click',handleClick);
document.addEventListener('submit',handleFilterSubmit);

loadDemoUsers();
