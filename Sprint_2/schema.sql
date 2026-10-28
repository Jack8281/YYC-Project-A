PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  service TEXT NOT NULL CHECK (service IN ('Audit','Tax')),
  portfolio_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('staff','reviewer','manager','management','director')),
  team_id INTEGER REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On leave','Resigned'))
);

CREATE TABLE IF NOT EXISTS client_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_code TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  portfolio_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_code TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  group_id INTEGER NOT NULL REFERENCES client_groups(id),
  portfolio_code TEXT NOT NULL,
  services TEXT NOT NULL DEFAULT 'Audit,Tax',
  fye_month INTEGER NOT NULL CHECK (fye_month BETWEEN 1 AND 12),
  fye_day INTEGER NOT NULL CHECK (fye_day BETWEEN 1 AND 28),
  contact_email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL CHECK (service IN ('Audit','Tax')),
  version TEXT NOT NULL DEFAULT 'demo-v1',
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(service, version)
);

CREATE TABLE IF NOT EXISTS workflow_template_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  estimated_days INTEGER NOT NULL DEFAULT 0,
  planned_day INTEGER NOT NULL DEFAULT 0,
  completion_criteria TEXT NOT NULL,
  UNIQUE(template_id, step_no),
  UNIQUE(template_id, code)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  group_id INTEGER NOT NULL REFERENCES client_groups(id),
  service TEXT NOT NULL CHECK (service IN ('Audit','Tax')),
  team_id INTEGER REFERENCES teams(id),
  created_by INTEGER NOT NULL REFERENCES staff(id),
  current_owner_id INTEGER REFERENCES staff(id),
  reviewer_id INTEGER REFERENCES staff(id),
  workflow_template_id INTEGER NOT NULL REFERENCES workflow_templates(id),
  current_step_no INTEGER NOT NULL DEFAULT 1,
  fye_date TEXT NOT NULL,
  ma_received_at TEXT NOT NULL,
  draft_number INTEGER NOT NULL DEFAULT 1,
  first_draft_sent_at TEXT,
  urgency_status TEXT NOT NULL DEFAULT 'On track' CHECK (urgency_status IN ('On track','At risk','Overdue','On hold')),
  workflow_status TEXT NOT NULL DEFAULT 'Awaiting team assignment',
  approval_status TEXT NOT NULL DEFAULT 'none' CHECK (approval_status IN ('none','pending','returned')),
  approval_comment TEXT,
  delay_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  template_step_id INTEGER NOT NULL REFERENCES workflow_template_steps(id),
  step_no INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  planned_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In progress','Awaiting review','Completed','Returned','On hold')),
  assigned_to INTEGER REFERENCES staff(id),
  completed_at TEXT,
  completed_by INTEGER REFERENCES staff(id),
  completion_note TEXT,
  UNIQUE(job_id, step_no)
);

CREATE TABLE IF NOT EXISTS assignment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_staff_id INTEGER REFERENCES staff(id),
  to_staff_id INTEGER REFERENCES staff(id),
  reason TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES staff(id),
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES staff(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_team ON jobs(team_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(urgency_status);
CREATE INDEX IF NOT EXISTS idx_jobs_owner ON jobs(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_jobs_service ON jobs(service);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_steps_assignee ON job_steps(assigned_to);
CREATE INDEX IF NOT EXISTS idx_steps_status ON job_steps(status);
CREATE INDEX IF NOT EXISTS idx_clients_portfolio ON clients(portfolio_code);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
