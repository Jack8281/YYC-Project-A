#!/usr/bin/env python3
"""YYC Job Control Sprint 2 prototype server. Python standard library only."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import mimetypes
import os
import random
import re
import secrets
import shutil
import sqlite3
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DB_PATH = BASE_DIR / "yyc_demo.db"
SCHEMA_PATH = BASE_DIR / "schema.sql"
HOST = "127.0.0.1"
PORT = 8000
TOKENS: dict[str, int] = {}
TOKEN_LOCK = threading.Lock()

TEAM_DEFS = [
    ("Audit 1", "Audit", "P1"), ("Tax 1", "Tax", "P1"),
    ("Audit 2", "Audit", "P2"), ("Tax 2", "Tax", "P2"),
    ("Audit 11", "Audit", "P3"), ("Tax 11", "Tax", "P3"),
    ("Audit 12", "Audit", "P4"), ("Tax 12", "Tax", "P4"),
]
URGENCY_VALUES = ["On track", "At risk", "Overdue", "On hold"]
AUDIT_STEPS = [
    (1, "S01", "Preparation", "Preparation", "staff", 22, 22, "Preparer completes the preparation work"),
    (2, "S02", "Review", "Review", "reviewer", 10, 32, "Reviewer checks the prepared work"),
    (3, "S03", "Amendments", "Amendments", "staff", 8, 40, "Required amendments are completed"),
    (4, "S04", "Draft to client", "Draft to client", "manager", 5, 45, "Manager checks and records the first draft sent date"),
    (5, "S05", "Client review", "Client review", "staff", 0, 45, "Client feedback is received outside the system"),
    (6, "S06", "Re-review", "Re-review", "reviewer", 0, 45, "Changes after client feedback are reviewed"),
    (7, "S07", "Finalisation", "Finalisation", "staff", 0, 45, "Final audit documents are ready"),
    (8, "S08", "Submission", "Submission", "manager", 0, 45, "Submission to SSM is recorded"),
]
TAX_STEPS = [
    (1, "S01", "Preparation", "Preparation", "staff", 32, 32, "Preparer completes the tax preparation work"),
    (2, "S02", "Review", "Review", "reviewer", 16, 48, "Reviewer checks the tax work"),
    (3, "S03", "Amendments", "Amendments", "staff", 11, 59, "Required amendments are completed"),
    (4, "S04", "Draft to client", "Draft to client", "manager", 6, 65, "Manager checks and records the first draft sent date"),
    (5, "S05", "Client review", "Client review", "staff", 0, 65, "Client feedback is received outside the system"),
    (6, "S06", "Re-review", "Re-review", "reviewer", 0, 65, "Changes after client feedback are reviewed"),
    (7, "S07", "Finalisation", "Finalisation", "staff", 0, 65, "Final tax documents are ready"),
    (8, "S08", "Submission", "Submission", "manager", 0, 65, "Submission to LHDN / IRB is recorded"),
]


def now_iso() -> str:
    return dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def row_dict(row):
    return dict(row) if row is not None else None


def audit(conn, actor_id: int, action: str, entity_type: str, entity_id, old=None, new=None):
    conn.execute(
        "INSERT INTO audit_log(created_at, actor_id, action, entity_type, entity_id, old_value, new_value) VALUES(?,?,?,?,?,?,?)",
        (now_iso(), actor_id, action, entity_type, str(entity_id),
         json.dumps(old, ensure_ascii=False) if old is not None else None,
         json.dumps(new, ensure_ascii=False) if new is not None else None),
    )


def make_steps(conn, template_id: int, job_row_id: int, current_step: int, owner_id: int | None,
               completed_through: int = 0, rng: random.Random | None = None):
    rows = conn.execute(
        "SELECT * FROM workflow_template_steps WHERE template_id=? ORDER BY step_no", (template_id,)
    ).fetchall()
    now = dt.datetime.now().astimezone()
    for step in rows:
        status = "Pending"
        completed_at = None
        completed_by = None
        assigned_to = None
        if step["step_no"] < current_step:
            status = "Completed"
            days_back = rng.randint(1, 25) if rng else 1
            completed_at = (now - dt.timedelta(days=days_back)).replace(microsecond=0).isoformat()
        elif step["step_no"] == current_step:
            status = "In progress" if owner_id else "Pending"
            assigned_to = owner_id
        conn.execute(
            "INSERT INTO job_steps(job_id,template_step_id,step_no,code,name,stage,owner_role,planned_day,status,assigned_to,completed_at,completed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (job_row_id, step["id"], step["step_no"], step["code"], step["name"], step["stage"],
             step["owner_role"], step["planned_day"], status, assigned_to, completed_at, completed_by),
        )


def seed_demo_data(reset: bool = False):
    if reset and DB_PATH.exists():
        backup_path = BASE_DIR / f"yyc_demo_before_reset_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        shutil.copy2(DB_PATH, backup_path)
        DB_PATH.unlink()
    conn = connect_db()
    try:
        schema = SCHEMA_PATH.read_text(encoding="utf-8")
        conn.executescript(schema)
        team_count = conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
        if team_count:
            return
        rng = random.Random(3512026)
        now = dt.datetime.now().astimezone().replace(microsecond=0)
        now_s = now.isoformat()

        # Eight teams share four client portfolios so each audit/tax pair can check status for the same clients.
        for name, service, portfolio in TEAM_DEFS:
            conn.execute("INSERT INTO teams(name,service,portfolio_code) VALUES(?,?,?)", (name, service, portfolio))

        team_map = {r["name"]: dict(r) for r in conn.execute("SELECT * FROM teams")}
        staff_ids = {team: {role: [] for role in ("staff", "reviewer", "manager")} for team, _, _ in TEAM_DEFS}
        first_names = ["Alex", "Avery", "Casey", "Jamie", "Jordan", "Morgan", "Taylor", "Riley", "Cameron", "Drew", "Robin", "Skyler", "Sam", "Lee", "Quinn", "Reese", "Bailey", "Dakota", "Kendall", "Parker"]
        last_names = ["Tan", "Lim", "Lee", "Ng", "Wong", "Ong", "Teo", "Chong", "Goh", "Yap", "Chan", "Lau", "Ho", "Low", "Cheah", "Yeo", "Koh", "Chin", "Foo", "Ling"]
        n = 1
        for team_name, _, _ in TEAM_DEFS:
            team_id = team_map[team_name]["id"]
            for role, qty in (("manager", 1), ("reviewer", 1), ("staff", 12 if n <= 2 else 13)):
                for j in range(qty):
                    name = f"{first_names[(n + j) % len(first_names)]} {last_names[(n * 3 + j) % len(last_names)]}"
                    email = f"demo{n:03d}@example.invalid"
                    conn.execute("INSERT INTO staff(staff_code,name,email,role,team_id,status) VALUES(?,?,?,?,?,'Active')",
                                 (f"ST{n:03d}", name, email, role, team_id))
                    staff_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                    staff_ids[team_name][role].append(staff_id)
                    n += 1
        # Team managers/reviewers/staff so far: 8 * (1+1+12/13) = 112.
        # Three management viewers and three directors bring the fictitious total to 118; fill to 130 with support staff.
        for role, qty, name_prefix in (("management", 3, "Management Viewer"), ("director", 2, "Demo Director")):
            for j in range(1, qty + 1):
                conn.execute("INSERT INTO staff(staff_code,name,email,role,team_id,status) VALUES(?,?,?,?,NULL,'Active')",
                             (f"ST{n:03d}", f"{name_prefix} {j}", f"demo{n:03d}@example.invalid", role))
                n += 1
        while n <= 130:
            conn.execute("INSERT INTO staff(staff_code,name,email,role,team_id,status) VALUES(?,?,?,?,NULL,'Active')",
                         (f"ST{n:03d}", f"Demo Support {n-1}", f"demo{n:03d}@example.invalid", "management"))
            n += 1

        # Two hundred fictional groups and one thousand fictional clients; four portfolios have 250 each.
        group_ids = []
        for g in range(1, 201):
            portfolio = f"P{((g - 1) // 50) + 1}"
            conn.execute("INSERT INTO client_groups(group_code,group_name,portfolio_code) VALUES(?,?,?)",
                         (f"GRP-{g:03d}", f"Demo Group {g:03d}", portfolio))
            group_ids.append(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        client_ids_by_portfolio = {f"P{i}": [] for i in range(1, 5)}
        for c in range(1, 1001):
            portfolio = f"P{((c - 1) // 250) + 1}"
            group_id = group_ids[(c - 1) // 5]
            fye_month = ((c - 1) % 12) + 1
            fye_day = ((c - 1) % 27) + 1
            conn.execute(
                "INSERT INTO clients(client_code,client_name,group_id,portfolio_code,services,fye_month,fye_day,contact_email) VALUES(?,?,?,?,?,?,?,?)",
                (f"CL-{c:04d}", f"Fictional Client {c:04d} Sdn Bhd", group_id, portfolio, "Audit,Tax", fye_month, fye_day, f"contact{c:04d}@example.invalid"),
            )
            client_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            client_ids_by_portfolio[portfolio].append((client_id, group_id, fye_month, fye_day))

        templates = {}
        for service, steps in (("Audit", AUDIT_STEPS), ("Tax", TAX_STEPS)):
            conn.execute("INSERT INTO workflow_templates(service,version,is_active) VALUES(?, 'demo-v1', 1)", (service,))
            tid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            templates[service] = tid
            for step in steps:
                conn.execute(
                    "INSERT INTO workflow_template_steps(template_id,step_no,code,name,stage,owner_role,estimated_days,planned_day,completion_criteria) VALUES(?,?,?,?,?,?,?,?,?)",
                    (tid, *step),
                )

        # Create 2,000 fictitious jobs at mixed stages. Job steps are normalised in a related table.
        job_sequence = {"Audit": 0, "Tax": 0}
        jobs_by_team = {team: [] for team, _, _ in TEAM_DEFS}
        for i in range(1, 2001):
            service = "Audit" if i % 2 else "Tax"
            # Keep each Audit/Tax pair in the same portfolio so paired service-status lookup can be demonstrated.
            portfolio_number = (((i - 1) // 2) % 4) + 1
            portfolio = f"P{portfolio_number}"
            team_name = next(name for name, svc, p in TEAM_DEFS if svc == service and p == portfolio)
            team = team_map[team_name]
            client_id, group_id, fm, fd = rng.choice(client_ids_by_portfolio[portfolio])
            reviewer = staff_ids[team_name]["reviewer"][0]
            manager = staff_ids[team_name]["manager"][0]
            current_step = rng.randint(1, 8)
            template_step_defs = AUDIT_STEPS if service == "Audit" else TAX_STEPS
            step_owner_role = template_step_defs[current_step - 1][4]
            owner = manager if step_owner_role == "manager" else reviewer if step_owner_role == "reviewer" else rng.choice(staff_ids[team_name]["staff"])
            age_days = rng.randint(1, 105)
            ma_date = (now.date() - dt.timedelta(days=age_days)).isoformat()
            fye_year = now.year if fm >= now.month else now.year + 1
            fye_date = dt.date(fye_year, fm, min(fd, 28)).isoformat()
            target_days = 45 if service == "Audit" else 65
            if age_days > target_days + 10:
                urgency = "Overdue"
            elif age_days > target_days * 0.66:
                urgency = "At risk"
            elif i % 53 == 0:
                urgency = "On hold"
            else:
                urgency = "On track"
            # Mostly show jobs already assigned; a small sample illustrates the director queue.
            waiting_team = (i % 97 == 0)
            if waiting_team:
                team_id = None
                manager_id = None
                owner_id = None
                workflow_status = "Awaiting team assignment"
            else:
                team_id = team["id"]
                manager_id = manager
                owner_id = owner
                workflow_status = "In progress" if current_step > 1 else "Preparation"
            job_sequence[service] += 1
            prefix = "A" if service == "Audit" else "T"
            job_id = f"{prefix}-{now.year}-{job_sequence[service]:04d}"
            conn.execute(
                "INSERT INTO jobs(job_id,client_id,group_id,service,team_id,created_by,current_owner_id,reviewer_id,workflow_template_id,current_step_no,fye_date,ma_received_at,draft_number,urgency_status,workflow_status,approval_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (job_id, client_id, group_id, service, team_id, 1, owner_id, reviewer, templates[service], current_step, fye_date, ma_date, 1 if current_step <= 4 else min(4, max(1, current_step - 2)), urgency, workflow_status, "none", now_s, now_s),
            )
            row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            make_steps(conn, templates[service], row_id, current_step, owner_id, rng=rng)
            if owner_id:
                conn.execute("UPDATE job_steps SET assigned_to=? WHERE job_id=? AND step_no=?", (owner_id, row_id, current_step))

        conn.commit()
        # Initial application audit note is fictitious and contains no client data beyond generated IDs.
    finally:
        conn.close()


def get_current_user(handler):
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    with TOKEN_LOCK:
        user_id = TOKENS.get(token)
    if not user_id:
        return None
    conn = connect_db()
    try:
        return row_dict(conn.execute(
            "SELECT s.*, t.name AS team_name, t.service AS team_service, t.portfolio_code AS portfolio_code FROM staff s LEFT JOIN teams t ON t.id=s.team_id WHERE s.id=?", (user_id,)
        ).fetchone())
    finally:
        conn.close()


def require_role(user, allowed):
    return bool(user and user.get("role") in allowed)


def get_demo_users(conn):
    # Keep every team available for role testing, but do not offer all 130 records in the selector.
    rows = conn.execute("SELECT s.*, t.name AS team_name FROM staff s LEFT JOIN teams t ON t.id=s.team_id ORDER BY s.id").fetchall()
    picked = []
    seen = set()
    for row in rows:
        if row["role"] == "director":
            # Both fictitious directors must be selectable because either may allocate a team.
            picked.append(row_dict(row))
        elif row["role"] == "management":
            if row["role"] not in seen:
                picked.append(row_dict(row)); seen.add(row["role"])
        elif row["role"] in ("manager", "reviewer", "staff"):
            key = (row["role"], row["team_id"])
            if key not in seen:
                picked.append(row_dict(row)); seen.add(key)
    return [{"id": u["id"], "name": u["name"], "role": u["role"], "team_id": u["team_id"], "team_name": u["team_name"]} for u in picked]


def portfolio_for_user(user):
    return user.get("portfolio_code") if user.get("role") not in ("management", "director") else None


def access_scope_sql(user, search_mode=False):
    """Returns WHERE fragment and bindings; staff search is portfolio-limited and status-only."""
    role = user["role"]
    if role in ("management", "director"):
        return "1=1", []
    if role == "manager":
        return "j.team_id = ?", [user["team_id"]]
    if role == "reviewer":
        return "j.team_id = ? AND (j.current_owner_id = ? OR j.reviewer_id = ?)", [user["team_id"], user["id"], user["id"]]
    if search_mode:
        return "c.portfolio_code = ?", [user.get("portfolio_code")]
    return "j.team_id = ? AND j.current_owner_id = ?", [user["team_id"], user["id"]]


def job_select_sql():
    return """
        SELECT j.id, j.job_id, j.service, j.team_id, t.name AS team_name, t.portfolio_code AS team_portfolio,
               j.current_owner_id, owner.name AS owner_name, j.reviewer_id, reviewer.name AS reviewer_name,
               j.current_step_no, j.fye_date, j.ma_received_at, j.draft_number, j.urgency_status, j.workflow_status,
               j.approval_status, j.approval_comment, j.delay_reason, j.created_at, j.updated_at,
               c.id AS client_id, c.client_code, c.client_name, c.portfolio_code, c.fye_month, c.fye_day,
               g.group_name, g.group_code, s.name AS current_step_name, s.stage AS current_stage,
               julianday('now') - julianday(j.ma_received_at) AS days_elapsed,
               CASE WHEN j.service='Audit' THEN 45 ELSE 65 END AS target_days
        FROM jobs j
        JOIN clients c ON c.id=j.client_id
        JOIN client_groups g ON g.id=j.group_id
        LEFT JOIN teams t ON t.id=j.team_id
        LEFT JOIN staff owner ON owner.id=j.current_owner_id
        LEFT JOIN staff reviewer ON reviewer.id=j.reviewer_id
        LEFT JOIN job_steps s ON s.job_id=j.id AND s.step_no=j.current_step_no
    """


def get_job(conn, job_pk):
    return conn.execute(job_select_sql() + " WHERE j.id=?", (job_pk,)).fetchone()


def can_see_full_job(user, job):
    if user["role"] in ("management", "director"):
        return True
    if user["role"] == "manager":
        return job["team_id"] == user["team_id"]
    if user["role"] == "reviewer":
        return job["team_id"] == user["team_id"] and (job["current_owner_id"] == user["id"] or job["reviewer_id"] == user["id"])
    return job["team_id"] == user["team_id"] and job["current_owner_id"] == user["id"]


def status_only_allowed(user, job):
    return user["role"] in ("staff", "reviewer") and job["portfolio_code"] == user.get("portfolio_code")


def list_jobs(conn, user, params):
    mode = params.get("mode", "normal")
    search_mode = mode == "search" and user["role"] in ("staff", "reviewer")
    where, binds = access_scope_sql(user, search_mode=search_mode)
    filters = [where]
    args = list(binds)
    q = (params.get("q") or "").strip()
    if search_mode and len(q) < 3:
        return [], 0
    if q:
        if len(q) < 3 and user["role"] in ("staff", "reviewer") and search_mode:
            return [], 0
        filters.append("(lower(c.client_name) LIKE ? OR lower(j.job_id) LIKE ? OR lower(g.group_name) LIKE ? OR lower(g.group_code) LIKE ?)")
        pat = f"%{q.lower()}%"
        args.extend([pat, pat, pat, pat])
    for param, field in (("service", "j.service"), ("stage", "s.stage"), ("status", "j.urgency_status")):
        value = (params.get(param) or "").strip()
        if value and value != "All":
            filters.append(f"{field} = ?")
            args.append(value)
    team_filter = (params.get("team") or "").strip()
    if team_filter and user["role"] in ("management", "director"):
        filters.append("t.name = ?"); args.append(team_filter)
    owner_filter = (params.get("owner") or "").strip()
    if owner_filter:
        if owner_filter.lower() == "unassigned":
            filters.append("owner.id IS NULL")
        else:
            filters.append("lower(owner.name) LIKE ?"); args.append(f"%{owner_filter.lower()}%")
    if params.get("needs_review") == "1":
        filters.append("j.approval_status = 'pending'")
    if params.get("unassigned_team") == "1":
        filters.append("j.team_id IS NULL")
    if params.get("unassigned_owner") == "1":
        filters.append("j.team_id IS NOT NULL AND j.current_owner_id IS NULL")
    sql_where = " AND ".join(f"({part})" for part in filters)
    total = conn.execute(job_select_sql() + f" WHERE {sql_where}", args).fetchone()
    # Query aggregate count separately because the job select has one row per job.
    count = conn.execute("SELECT COUNT(*) FROM jobs j JOIN clients c ON c.id=j.client_id JOIN client_groups g ON g.id=j.group_id LEFT JOIN teams t ON t.id=j.team_id LEFT JOIN staff owner ON owner.id=j.current_owner_id LEFT JOIN job_steps s ON s.job_id=j.id AND s.step_no=j.current_step_no WHERE " + sql_where, args).fetchone()[0]
    limit = max(1, min(int(params.get("limit", 25) or 25), 100))
    offset = max(0, int(params.get("offset", 0) or 0))
    order = "CASE j.urgency_status WHEN 'Overdue' THEN 1 WHEN 'At risk' THEN 2 WHEN 'On hold' THEN 3 ELSE 4 END, j.ma_received_at ASC"
    if params.get("sort") == "newest":
        order = "j.created_at DESC"
    rows = conn.execute(job_select_sql() + f" WHERE {sql_where} ORDER BY {order} LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["days_elapsed"] = max(0, int(item["days_elapsed"] or 0))
        item["status_only"] = bool(search_mode and not can_see_full_job(user, item))
        if item["status_only"]:
            # Cross-service visibility is status-only: do not disclose owner, FYE, timestamps or timeline.
            item = {k: item[k] for k in ("id", "job_id", "service", "team_name", "client_name", "group_name", "current_stage", "urgency_status", "workflow_status", "status_only")}
        result.append(item)
    return result, count


class Handler(BaseHTTPRequestHandler):
    server_version = "YYC-Sprint2/0.1"

    def log_message(self, fmt, *args):
        # Keep console readable during a student demo.
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def send_bytes(self, status, content_type, body, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def body_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > 50_000_000:
            raise ValueError("Request body is too large.")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def user_required(self):
        user = get_current_user(self)
        if not user:
            self.send_json(401, {"error": "Please sign in using a demo account."})
            return None
        return user

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)
        flat = {k: v[-1] for k, v in params.items()}

        if path in ("/", "/index.html"):
            return self.serve_static("index.html")
        if path.startswith("/public/"):
            return self.serve_static(path.removeprefix("/public/"))
        if path == "/api/demo-users":
            conn = connect_db()
            try:
                return self.send_json(200, {"users": get_demo_users(conn), "teams": [dict(r) for r in conn.execute("SELECT id,name,service,portfolio_code FROM teams ORDER BY name")]})
            finally:
                conn.close()
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "database": str(DB_PATH.name)})
        if path == "/api/backup-json":
            user = self.user_required()
            if not user: return
            if user["role"] not in ("management","director"):
                return self.send_json(403,{"error":"Only management or directors can export a JSON backup."})
            conn = connect_db()
            try:
                tables = ("teams","staff","client_groups","clients","workflow_templates","workflow_template_steps","jobs","job_steps","assignment_history","audit_log")
                backup = {"format":"YYC Sprint 2 JSON backup","version":1,"created_at":now_iso(),"tables":{}}
                for table in tables:
                    backup["tables"][table] = [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]
                audit(conn,user["id"],"Database JSON backup exported","backup","database",None,{"tables":len(tables)})
                conn.commit()
                raw = json.dumps(backup,ensure_ascii=False).encode("utf-8")
                return self.send_bytes(200,"application/json; charset=utf-8",raw,f"yyc-sprint2-backup-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
            finally:
                conn.close()
        if path == "/api/backup":
            user = self.user_required()
            if not user: return
            if user["role"] not in ("management", "director"):
                return self.send_json(403, {"error": "Only management or directors can download a database backup."})
            temp = tempfile.NamedTemporaryFile(prefix="yyc-backup-", suffix=".sqlite", delete=False)
            temp.close()
            try:
                source = connect_db(); destination = sqlite3.connect(temp.name)
                try: source.backup(destination)
                finally: destination.close(); source.close()
                body = Path(temp.name).read_bytes()
                return self.send_bytes(200, "application/vnd.sqlite3", body, f"yyc-sprint2-backup-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite")
            finally:
                try: os.unlink(temp.name)
                except OSError: pass
        user = self.user_required()
        if not user: return
        conn = connect_db()
        try:
            if path == "/api/me":
                return self.send_json(200, {"user": {k: user.get(k) for k in ("id","staff_code","name","email","role","team_id","team_name","team_service","portfolio_code")}})
            if path == "/api/bootstrap":
                if user["role"] in ("management", "director"):
                    team_count = conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
                    staff_count = conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0]
                    client_count = conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
                    group_count = conn.execute("SELECT COUNT(*) FROM client_groups").fetchone()[0]
                    job_count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
                else:
                    team_count = 1
                    staff_count = conn.execute("SELECT COUNT(*) FROM staff WHERE team_id=?", (user["team_id"],)).fetchone()[0]
                    client_count = conn.execute("SELECT COUNT(*) FROM clients WHERE portfolio_code=?", (user.get("portfolio_code"),)).fetchone()[0]
                    group_count = conn.execute("SELECT COUNT(*) FROM client_groups WHERE portfolio_code=?", (user.get("portfolio_code"),)).fetchone()[0]
                    if user["role"] == "manager":
                        job_count = conn.execute("SELECT COUNT(*) FROM jobs WHERE team_id=?", (user["team_id"],)).fetchone()[0]
                    else:
                        job_count = conn.execute("SELECT COUNT(*) FROM jobs WHERE current_owner_id=? AND team_id=?", (user["id"], user["team_id"])).fetchone()[0]
                templates = [dict(r) for r in conn.execute("SELECT wt.service,wt.version,COUNT(ws.id) AS steps FROM workflow_templates wt JOIN workflow_template_steps ws ON ws.template_id=wt.id GROUP BY wt.id ORDER BY wt.service")]
                return self.send_json(200, {"user": {k: user.get(k) for k in ("id","staff_code","name","email","role","team_id","team_name","team_service","portfolio_code")},
                    "counts": {"teams":team_count,"staff":staff_count,"clients":client_count,"groups":group_count,"jobs":job_count},
                    "templates": templates, "teams": [dict(r) for r in conn.execute("SELECT id,name,service,portfolio_code FROM teams ORDER BY name")],
                    "workflowNotes": "Provisional demo templates: detailed audit step durations must be confirmed with YYC. First-draft targets use 45 audit days and 65 tax days."})
            if path == "/api/clients":
                q = (flat.get("q") or "").strip().lower()
                params_sql = []
                sql = "SELECT c.id,c.client_code,c.client_name,c.group_id,g.group_name,c.portfolio_code,c.services,c.fye_month,c.fye_day FROM clients c JOIN client_groups g ON g.id=c.group_id WHERE 1=1"
                if user["role"] not in ("management", "director"):
                    sql += " AND c.portfolio_code=?"; params_sql.append(user.get("portfolio_code"))
                if q:
                    sql += " AND (lower(c.client_name) LIKE ? OR lower(c.client_code) LIKE ? OR lower(g.group_name) LIKE ?)"
                    params_sql.extend([f"%{q}%"]*3)
                sql += " ORDER BY c.client_name LIMIT 100"
                return self.send_json(200, {"clients": [dict(r) for r in conn.execute(sql, params_sql)]})
            if path == "/api/jobs":
                rows, count = list_jobs(conn, user, flat)
                return self.send_json(200, {"jobs": rows, "total": count, "limit": int(flat.get("limit", 25) or 25), "offset": int(flat.get("offset", 0) or 0)})
            if path.startswith("/api/jobs/"):
                job_pk = path.split("/")[-1]
                job = get_job(conn, job_pk)
                if not job:
                    return self.send_json(404, {"error": "Job not found."})
                if not can_see_full_job(user, dict(job)):
                    return self.send_json(403, {"error": "This job is not assigned to you. Use Job Search for status-only cross-service visibility."})
                job_data = dict(job)
                job_data["days_elapsed"] = max(0, int(job_data["days_elapsed"] or 0))
                steps = [dict(r) for r in conn.execute("SELECT js.*,s1.name AS completed_by_name,s2.name AS assigned_to_name FROM job_steps js LEFT JOIN staff s1 ON s1.id=js.completed_by LEFT JOIN staff s2 ON s2.id=js.assigned_to WHERE js.job_id=? ORDER BY js.step_no", (job["id"],))]
                audit_rows = [dict(r) for r in conn.execute("SELECT a.*,s.name AS actor_name FROM audit_log a JOIN staff s ON s.id=a.actor_id WHERE a.entity_type='job' AND a.entity_id=? ORDER BY a.id DESC LIMIT 30", (job["job_id"],))]
                assignment_rows = [dict(r) for r in conn.execute("SELECT ah.*,f.name AS from_name,t.name AS to_name,c.name AS changed_by_name FROM assignment_history ah LEFT JOIN staff f ON f.id=ah.from_staff_id LEFT JOIN staff t ON t.id=ah.to_staff_id JOIN staff c ON c.id=ah.changed_by WHERE ah.job_id=? ORDER BY ah.id DESC LIMIT 20", (job["id"],))]
                # Client feedback: show linked status for the paired service, but never expose its owner or timeline.
                linked_service_jobs = [dict(r) for r in conn.execute("""
                    SELECT j.job_id, j.service, t.name AS team_name, s.stage AS current_stage,
                           j.urgency_status, j.workflow_status
                    FROM jobs j
                    LEFT JOIN teams t ON t.id=j.team_id
                    LEFT JOIN job_steps s ON s.job_id=j.id AND s.step_no=j.current_step_no
                    WHERE j.client_id=? AND j.service<>?
                    ORDER BY j.created_at DESC, j.id DESC LIMIT 5
                """, (job["client_id"], job["service"]))]
                can_done = user["role"] in ("staff","reviewer","manager") and job["current_owner_id"] == user["id"] and job["approval_status"] != "pending" and job["team_id"] == user["team_id"]
                can_review = user["role"] == "manager" and job["team_id"] == user["team_id"] and job["approval_status"] == "pending"
                can_assign = user["role"] == "manager" and job["team_id"] == user["team_id"]
                can_team_assign = user["role"] == "director" and job["team_id"] is None
                staff_choices = []
                if can_assign:
                    staff_choices = [dict(r) for r in conn.execute("SELECT id,name,role,status FROM staff WHERE team_id=? AND role IN ('staff','reviewer','manager') AND status='Active' ORDER BY role,name", (job["team_id"],))]
                team_choices = []
                if can_team_assign:
                    portfolio = conn.execute("SELECT portfolio_code FROM clients WHERE id=?", (job["client_id"],)).fetchone()[0]
                    team_choices = [dict(r) for r in conn.execute("SELECT id,name,service FROM teams WHERE service=? AND portfolio_code=? ORDER BY name", (job["service"], portfolio))]
                return self.send_json(200, {"job": job_data, "steps": steps, "audit": audit_rows, "assignments": assignment_rows,
                    "linkedServiceJobs": linked_service_jobs,
                    "permissions": {"can_done": can_done, "can_review": can_review, "can_assign": can_assign, "can_team_assign": can_team_assign,
                                    "can_reassign": user["role"] == "manager" and job["team_id"] == user["team_id"],
                                    "read_only": user["role"] in ("management","director") and not can_team_assign},
                    "staffChoices": staff_choices, "teamChoices": team_choices})
            if path == "/api/stats":
                scope_where, scope_binds = access_scope_sql(user, False)
                base = "FROM jobs j JOIN clients c ON c.id=j.client_id LEFT JOIN teams t ON t.id=j.team_id WHERE " + scope_where
                counts = {"total": conn.execute("SELECT COUNT(*) " + base, scope_binds).fetchone()[0]}
                for status in URGENCY_VALUES:
                    counts[status] = conn.execute("SELECT COUNT(*) " + base + " AND j.urgency_status=?", scope_binds+[status]).fetchone()[0]
                counts["pending_review"] = conn.execute("SELECT COUNT(*) " + base + " AND j.approval_status='pending'", scope_binds).fetchone()[0]
                counts["unassigned_team"] = conn.execute("SELECT COUNT(*) FROM jobs WHERE team_id IS NULL").fetchone()[0] if user["role"] == "director" else 0
                counts["unassigned_owner"] = conn.execute("SELECT COUNT(*) " + base + " AND j.team_id IS NOT NULL AND j.current_owner_id IS NULL", scope_binds).fetchone()[0]
                by_team = []
                if user["role"] in ("management", "director"):
                    by_team = [dict(r) for r in conn.execute("SELECT t.name,t.service,COUNT(j.id) AS jobs,SUM(CASE WHEN j.urgency_status='Overdue' THEN 1 ELSE 0 END) AS overdue,SUM(CASE WHEN j.approval_status='pending' THEN 1 ELSE 0 END) AS pending_review FROM teams t LEFT JOIN jobs j ON j.team_id=t.id GROUP BY t.id ORDER BY t.service,t.name")]
                return self.send_json(200, {"counts": counts, "byTeam": by_team})
            if path == "/api/audit":
                if user["role"] not in ("management","director","manager"):
                    return self.send_json(403, {"error":"Audit log is available to managers and management."})
                if user["role"] == "manager":
                    rows = conn.execute("SELECT a.*,s.name AS actor_name FROM audit_log a JOIN staff s ON s.id=a.actor_id WHERE (a.entity_type='job' AND a.entity_id IN (SELECT job_id FROM jobs WHERE team_id=?)) ORDER BY a.id DESC LIMIT 100", (user["team_id"],)).fetchall()
                else:
                    rows = conn.execute("SELECT a.*,s.name AS actor_name FROM audit_log a JOIN staff s ON s.id=a.actor_id ORDER BY a.id DESC LIMIT 100").fetchall()
                return self.send_json(200, {"audit": [dict(r) for r in rows]})
            if path == "/api/workflows":
                templates = []
                for template in conn.execute("SELECT * FROM workflow_templates ORDER BY service"):
                    item = dict(template)
                    item["steps"] = [dict(s) for s in conn.execute("SELECT step_no,code,name,stage,owner_role,estimated_days,planned_day,completion_criteria FROM workflow_template_steps WHERE template_id=? ORDER BY step_no", (item["id"],))]
                    templates.append(item)
                return self.send_json(200, {"templates": templates})
            if path == "/api/team-staff":
                if user["role"] not in ("manager","management","director"):
                    return self.send_json(403, {"error":"Staff/team directory is not available to this role."})
                if user["role"] == "manager":
                    rows = conn.execute("SELECT s.id,s.name,s.email,s.role,s.status,t.name AS team_name,COUNT(j.id) AS active_jobs FROM staff s JOIN teams t ON t.id=s.team_id LEFT JOIN jobs j ON j.current_owner_id=s.id AND j.workflow_status!='Closed' WHERE s.team_id=? GROUP BY s.id ORDER BY s.role,s.name", (user["team_id"],)).fetchall()
                else:
                    rows = conn.execute("SELECT s.id,s.name,s.email,s.role,s.status,t.name AS team_name,COUNT(j.id) AS active_jobs FROM staff s LEFT JOIN teams t ON t.id=s.team_id LEFT JOIN jobs j ON j.current_owner_id=s.id AND j.workflow_status!='Closed' GROUP BY s.id ORDER BY s.role,s.name").fetchall()
                return self.send_json(200, {"staff": [dict(r) for r in rows]})
            return self.send_json(404, {"error": "Endpoint not found."})
        except (ValueError, sqlite3.Error) as exc:
            return self.send_json(400, {"error": str(exc)})
        finally:
            conn.close()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            data = self.body_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_json(400, {"error": f"Invalid request body: {exc}"})

        if path == "/api/login":
            user_id = data.get("user_id")
            conn = connect_db()
            try:
                user = conn.execute("SELECT s.*,t.name AS team_name,t.service AS team_service,t.portfolio_code FROM staff s LEFT JOIN teams t ON t.id=s.team_id WHERE s.id=?", (user_id,)).fetchone()
                if not user:
                    return self.send_json(400, {"error":"Select a demo account."})
                token = secrets.token_urlsafe(28)
                with TOKEN_LOCK: TOKENS[token] = user["id"]
                return self.send_json(200, {"token":token, "user": {k:user[k] for k in ("id","staff_code","name","email","role","team_id","team_name","team_service","portfolio_code")}})
            finally:
                conn.close()

        user = self.user_required()
        if not user: return
        conn = connect_db()
        try:
            if path == "/api/logout":
                auth = self.headers.get("Authorization", "")
                token = auth[7:].strip() if auth.startswith("Bearer ") else ""
                with TOKEN_LOCK: TOKENS.pop(token, None)
                return self.send_json(200, {"ok":True})

            if path == "/api/jobs":
                if user["role"] not in ("manager","director"):
                    return self.send_json(403, {"error":"Only a manager or director can create a job."})
                client_id = int(data.get("client_id") or 0)
                service = data.get("service")
                fye_date = data.get("fye_date")
                ma_date = data.get("ma_received_at") or dt.date.today().isoformat()
                if service not in ("Audit","Tax"):
                    return self.send_json(400, {"error":"Select Audit or Tax."})
                try:
                    dt.date.fromisoformat(fye_date); dt.date.fromisoformat(ma_date)
                except (ValueError, TypeError):
                    return self.send_json(400, {"error":"Enter valid FYE and MA received dates."})
                client = conn.execute("SELECT c.*,g.group_name FROM clients c JOIN client_groups g ON g.id=c.group_id WHERE c.id=?", (client_id,)).fetchone()
                if not client:
                    return self.send_json(404, {"error":"Client not found."})
                if user["role"] not in ("management","director") and client["portfolio_code"] != user.get("portfolio_code"):
                    return self.send_json(403, {"error":"You cannot create work for this client portfolio."})
                if service not in client["services"].split(","):
                    return self.send_json(400, {"error":"This client is not enabled for the selected service."})
                template = conn.execute("SELECT * FROM workflow_templates WHERE service=? AND is_active=1", (service,)).fetchone()
                if not template:
                    return self.send_json(500, {"error":"No workflow template configured for this service."})
                year = dt.date.fromisoformat(ma_date).year
                prefix = "A" if service == "Audit" else "T"
                seq = conn.execute("SELECT COALESCE(MAX(CAST(substr(job_id,-4) AS INTEGER)),0)+1 FROM jobs WHERE job_id LIKE ?", (f"{prefix}-{year}-%",)).fetchone()[0]
                job_id = f"{prefix}-{year}-{seq:04d}"
                created = now_iso()
                conn.execute("INSERT INTO jobs(job_id,client_id,group_id,service,team_id,created_by,current_owner_id,reviewer_id,workflow_template_id,current_step_no,fye_date,ma_received_at,draft_number,urgency_status,workflow_status,approval_status,created_at,updated_at) VALUES(?,?,?,?,NULL,?,NULL,NULL,?,1,?,?,1,'On track','Awaiting team assignment','none',?,?)",
                             (job_id, client_id, client["group_id"], service, user["id"], template["id"], fye_date, ma_date, created, created))
                job_pk = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                for s in conn.execute("SELECT * FROM workflow_template_steps WHERE template_id=? ORDER BY step_no", (template["id"],)).fetchall():
                    conn.execute("INSERT INTO job_steps(job_id,template_step_id,step_no,code,name,stage,owner_role,planned_day,status,assigned_to) VALUES(?,?,?,?,?,?,?,?,?,NULL)",
                                 (job_pk,s["id"],s["step_no"],s["code"],s["name"],s["stage"],s["owner_role"],s["planned_day"],"Pending"))
                audit(conn,user["id"],"Job created","job",job_id,None,{"client":client["client_name"],"service":service,"fye_date":fye_date,"ma_received_at":ma_date,"workflow_status":"Awaiting team assignment"})
                conn.commit()
                return self.send_json(201,{"ok":True,"job_id":job_id,"message":"Job created. A director must assign its team before the team manager assigns a preparer."})

            match = re.match(r"^/api/jobs/(\d+)/(done|approve|return|assign|reassign|assign-team)$", path)
            if match:
                pk = int(match.group(1)); action = match.group(2)
                job = conn.execute(job_select_sql()+" WHERE j.id=?", (pk,)).fetchone()
                if not job:
                    return self.send_json(404,{"error":"Job not found."})
                jobd = dict(job)
                if action == "done":
                    if user["role"] not in ("staff","reviewer","manager") or jobd["current_owner_id"] != user["id"] or jobd["team_id"] != user["team_id"]:
                        return self.send_json(403,{"error":"Only the assigned person can mark this step done."})
                    if jobd["approval_status"] == "pending":
                        return self.send_json(400,{"error":"This step is already waiting for manager checking."})
                    step = conn.execute("SELECT * FROM job_steps WHERE job_id=? AND step_no=?",(pk,jobd["current_step_no"])).fetchone()
                    if not step:
                        return self.send_json(400,{"error":"Current workflow step not found."})
                    old = {"step_status":step["status"],"workflow_status":jobd["workflow_status"],"owner":jobd["owner_name"]}
                    stamp = now_iso()
                    conn.execute("UPDATE job_steps SET status='Awaiting review',completed_at=?,completed_by=?,completion_note=NULL WHERE id=?",(stamp,user["id"],step["id"]))
                    conn.execute("UPDATE jobs SET approval_status='pending',workflow_status='Needs manager check',approval_comment=NULL,updated_at=? WHERE id=?",(stamp,pk))
                    audit(conn,user["id"],"Step marked done - awaiting manager check","job",jobd["job_id"],old,{"step":step["name"],"completed_by":user["name"],"completed_at":stamp})
                    conn.commit()
                    return self.send_json(200,{"ok":True,"message":"Done saved with your name and timestamp. The job is now waiting for the team manager to check it."})

                if action in ("approve","return"):
                    if user["role"] != "manager" or jobd["team_id"] != user["team_id"]:
                        return self.send_json(403,{"error":"Only this job's team manager can approve or return it."})
                    if jobd["approval_status"] != "pending":
                        return self.send_json(400,{"error":"This job is not waiting for manager checking."})
                    step = conn.execute("SELECT * FROM job_steps WHERE job_id=? AND step_no=?",(pk,jobd["current_step_no"])).fetchone()
                    if action == "return":
                        comment = (data.get("comment") or "").strip()
                        if not comment:
                            return self.send_json(400,{"error":"Enter a short reason before returning the work."})
                        old = {"approval_status":"pending","workflow_status":jobd["workflow_status"]}
                        conn.execute("UPDATE job_steps SET status='Returned',completion_note=? WHERE id=?",(comment,step["id"]))
                        conn.execute("UPDATE jobs SET approval_status='returned',workflow_status='Returned for amendment',approval_comment=?,current_owner_id=?,updated_at=? WHERE id=?",(comment,step["completed_by"],now_iso(),pk))
                        audit(conn,user["id"],"Manager returned work","job",jobd["job_id"],old,{"reason":comment,"returned_to":step["completed_by"]})
                        conn.commit()
                        return self.send_json(200,{"ok":True,"message":"Work returned to the preparer with the manager's reason."})
                    old = {"approval_status":"pending","workflow_status":jobd["workflow_status"],"current_step_no":jobd["current_step_no"]}
                    conn.execute("UPDATE job_steps SET status='Completed' WHERE id=?",(step["id"],))
                    next_step = conn.execute("SELECT * FROM job_steps WHERE job_id=? AND step_no=?",(pk,jobd["current_step_no"]+1)).fetchone()
                    stamp = now_iso()
                    if jobd["current_step_no"] == 4 and not jobd["first_draft_sent_at"]:
                        conn.execute("UPDATE jobs SET first_draft_sent_at=? WHERE id=?",(stamp,pk))
                    if next_step:
                        team_id = jobd["team_id"]
                        role = next_step["owner_role"]
                        next_owner = conn.execute("SELECT id FROM staff WHERE team_id=? AND role=? AND status='Active' ORDER BY id LIMIT 1",(team_id,role)).fetchone()
                        # If a role has no matching person, fall back to an active preparer in this team.
                        if not next_owner:
                            next_owner = conn.execute("SELECT id FROM staff WHERE team_id=? AND role='staff' AND status='Active' ORDER BY id LIMIT 1",(team_id,)).fetchone()
                        owner_id = next_owner["id"] if next_owner else None
                        conn.execute("UPDATE job_steps SET status='In progress',assigned_to=? WHERE id=?",(owner_id,next_step["id"]))
                        conn.execute("UPDATE jobs SET current_step_no=?,current_owner_id=?,approval_status='none',approval_comment=NULL,workflow_status=?,updated_at=? WHERE id=?",(next_step["step_no"],owner_id,next_step["name"],stamp,pk))
                        conn.execute("INSERT INTO assignment_history(job_id,from_staff_id,to_staff_id,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?)",(pk,step["completed_by"],owner_id,"Next owner from workflow template",user["id"],stamp))
                        new = {"approved_step":step["name"],"next_step":next_step["name"],"next_owner_id":owner_id}
                    else:
                        conn.execute("UPDATE jobs SET workflow_status='Closed',approval_status='none',current_owner_id=NULL,updated_at=? WHERE id=?",(stamp,pk))
                        new = {"approved_step":step["name"],"workflow_status":"Closed"}
                    audit(conn,user["id"],"Manager approved work","job",jobd["job_id"],old,new)
                    conn.commit()
                    return self.send_json(200,{"ok":True,"message":"Manager check approved. The job moved to the next template step."})

                if action in ("assign","reassign"):
                    if user["role"] != "manager" or jobd["team_id"] != user["team_id"]:
                        return self.send_json(403,{"error":"Only this job's team manager can assign or reassign staff."})
                    if action == "assign" and jobd["current_owner_id"] is not None:
                        return self.send_json(400,{"error":"This job already has an owner. Use reassign and provide a reason."})
                    if action == "reassign" and jobd["current_owner_id"] is None:
                        return self.send_json(400,{"error":"This job has no owner yet. Use assign for the initial assignment."})
                    target_id = int(data.get("staff_id") or 0)
                    target = conn.execute("SELECT * FROM staff WHERE id=? AND team_id=? AND status='Active' AND role IN ('staff','reviewer','manager')",(target_id,user["team_id"])).fetchone()
                    if not target:
                        return self.send_json(400,{"error":"Select an active staff member from your team."})
                    supplied_reason = str(data.get("reason") or "").strip()
                    if action == "reassign" and not supplied_reason:
                        return self.send_json(400,{"error":"A reason is required for reassignment."})
                    reason = supplied_reason or "Initial preparer assignment"
                    if action == "reassign" and target_id == jobd["current_owner_id"]:
                        return self.send_json(400,{"error":"Choose a different staff member for reassignment."})
                    previous = jobd["current_owner_id"]
                    old = {"owner_id":previous,"owner_name":jobd["owner_name"]}
                    stamp = now_iso()
                    conn.execute("UPDATE jobs SET current_owner_id=?,workflow_status=CASE WHEN workflow_status='Awaiting team assignment' THEN 'Preparation' ELSE workflow_status END,updated_at=? WHERE id=?",(target_id,stamp,pk))
                    conn.execute("UPDATE job_steps SET assigned_to=? WHERE job_id=? AND step_no=?",(target_id,pk,jobd["current_step_no"]))
                    conn.execute("INSERT INTO assignment_history(job_id,from_staff_id,to_staff_id,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?)",(pk,previous,target_id,reason,user["id"],stamp))
                    audit(conn,user["id"],"Staff assigned" if action=="assign" else "Job reassigned","job",jobd["job_id"],old,{"owner_id":target_id,"owner_name":target["name"],"reason":reason})
                    conn.commit()
                    return self.send_json(200,{"ok":True,"message":f"Job assigned to {target['name']}." if action=="assign" else f"Job reassigned to {target['name']} with history recorded."})

                if action == "assign-team":
                    if user["role"] != "director":
                        return self.send_json(403,{"error":"Only a director can manually assign a job to a team."})
                    if jobd["team_id"] is not None:
                        return self.send_json(400,{"error":"This job already has a team."})
                    team_id = int(data.get("team_id") or 0)
                    team = conn.execute("SELECT * FROM teams WHERE id=? AND service=?",(team_id,jobd["service"])).fetchone()
                    client = conn.execute("SELECT portfolio_code FROM clients WHERE id=?",(jobd["client_id"],)).fetchone()
                    if not team or team["portfolio_code"] != client["portfolio_code"]:
                        return self.send_json(400,{"error":"Choose an Audit/Tax team that matches this client's portfolio."})
                    manager = conn.execute("SELECT id FROM staff WHERE team_id=? AND role='manager' AND status='Active' ORDER BY id LIMIT 1",(team_id,)).fetchone()
                    stamp = now_iso()
                    conn.execute("UPDATE jobs SET team_id=?,workflow_status='Awaiting preparer assignment',updated_at=? WHERE id=?",(team_id,stamp,pk))
                    audit(conn,user["id"],"Director assigned team","job",jobd["job_id"],{"team_id":None},{"team_id":team_id,"team_name":team["name"],"manager_id":manager["id"] if manager else None})
                    conn.commit()
                    return self.send_json(200,{"ok":True,"message":f"Assigned to {team['name']}. Its manager can now assign a preparer."})

            if path == "/api/restore":
                if user["role"] != "director":
                    return self.send_json(403,{"error":"Only a director can restore the demo database."})
                # Restore accepts JSON export files only; a SQLite backup can be reopened manually using the documented procedure.
                backup = data.get("backup")
                if not isinstance(backup, dict) or not isinstance(backup.get("tables"), dict):
                    return self.send_json(400,{"error":"Invalid JSON backup. Choose a YYC JSON export file."})
                required = {"teams","staff","client_groups","clients","workflow_templates","workflow_template_steps","jobs","job_steps","assignment_history","audit_log"}
                if not required.issubset(backup["tables"].keys()):
                    return self.send_json(400,{"error":"The backup is missing one or more required tables."})
                # Keep restore explicit and safer by refusing to replace schema or insert arbitrary SQL.
                temp = BASE_DIR / "yyc_restore_validate.db"
                if temp.exists(): temp.unlink()
                temp_conn = sqlite3.connect(temp); temp_conn.row_factory=sqlite3.Row
                try:
                    temp_conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
                    for table in ("teams","staff","client_groups","clients","workflow_templates","workflow_template_steps","jobs","job_steps","assignment_history","audit_log"):
                        rows = backup["tables"].get(table, [])
                        if not isinstance(rows,list): raise ValueError(f"Table '{table}' must be a list.")
                        for record in rows:
                            if not isinstance(record,dict): raise ValueError(f"Invalid row in '{table}'.")
                            cols = [r[1] for r in temp_conn.execute(f"PRAGMA table_info({table})")]
                            clean = {k:v for k,v in record.items() if k in cols}
                            if not clean: continue
                            col_sql = ",".join('"'+k+'"' for k in clean)
                            marks = ",".join("?" for _ in clean)
                            temp_conn.execute(f"INSERT INTO {table}({col_sql}) VALUES({marks})", list(clean.values()))
                    temp_conn.commit()
                    check = temp_conn.execute("PRAGMA integrity_check").fetchone()[0]
                    if check != "ok": raise ValueError("Backup database integrity check failed.")
                except Exception as exc:
                    temp_conn.close()
                    if temp.exists(): temp.unlink()
                    return self.send_json(400,{"error":f"Backup not restored: {exc}"})
                temp_conn.close()
                # Replace via SQLite backup API to keep file handling consistent with open connections.
                live = connect_db(); restored = sqlite3.connect(temp)
                try: restored.backup(live); live.commit()
                finally: restored.close(); live.close()
                if temp.exists(): temp.unlink()
                with TOKEN_LOCK: TOKENS.clear()
                return self.send_json(200,{"ok":True,"message":"JSON backup restored. Sign in again to continue."})

            if path == "/api/backup-json":
                if user["role"] not in ("management","director"):
                    return self.send_json(403,{"error":"Only management or directors can export a backup."})
                tables = ("teams","staff","client_groups","clients","workflow_templates","workflow_template_steps","jobs","job_steps","assignment_history","audit_log")
                backup = {"format":"YYC Sprint 2 JSON backup","version":1,"created_at":now_iso(),"tables":{}}
                for table in tables:
                    backup["tables"][table] = [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]
                audit(conn,user["id"],"Database JSON backup exported","backup","database",None,{"tables":len(tables)})
                conn.commit()
                raw = json.dumps(backup,ensure_ascii=False).encode("utf-8")
                return self.send_bytes(200,"application/json; charset=utf-8",raw,f"yyc-sprint2-backup-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.json")

            if path == "/api/clear-notice":
                return self.send_json(200,{"ok":True})
            return self.send_json(404,{"error":"Endpoint not found."})
        except (ValueError, sqlite3.Error, KeyError) as exc:
            conn.rollback()
            return self.send_json(400,{"error":str(exc)})
        finally:
            conn.close()

    def serve_static(self, relative):
        target = (PUBLIC_DIR / relative).resolve()
        if PUBLIC_DIR.resolve() not in target.parents and target != (PUBLIC_DIR / "index.html").resolve():
            return self.send_json(403,{"error":"Path is not allowed."})
        if not target.exists() or not target.is_file():
            return self.send_json(404,{"error":"File not found."})
        content_type, _ = mimetypes.guess_type(str(target))
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (content_type or "application/octet-stream") + ("; charset=utf-8" if content_type in ("text/html","text/css","application/javascript","text/javascript") else ""))
        self.send_header("Content-Length",str(len(body)))
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers(); self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Run the YYC Sprint 2 demo app")
    parser.add_argument("--reset-demo-data", action="store_true", help="Back up current DB and rebuild 1,000 fictional clients and 2,000 fictional jobs")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    seed_demo_data(reset=args.reset_demo_data)
    print("\nYYC Job Control — Sprint 2 prototype")
    print(f"Local URL: http://{args.host}:{args.port}")
    print(f"SQLite database: {DB_PATH}")
    print("Demo only: sign-in roles are selectable. Do not enter real client or staff data.\n")
    server = ThreadingHTTPServer((args.host,args.port),Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
