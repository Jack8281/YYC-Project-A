# YYC Job Control — Sprint 2 implementation

This folder adds a consistent Sprint 2 working prototype next to (not over) the original Sprint 1 HTML prototype. The project currently uses plain HTML/CSS/JavaScript plus a small Python standard-library server and SQLite database. There are no third-party Python packages to install.

## Run in VS Code on Windows

1. Open the `YYC-Project-A-Sprint2` folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Run:

   ```powershell
   cd sprint2
   python server.py
   ```

4. Open `http://127.0.0.1:8000` in Chrome or Edge.
5. Choose any fictitious demo account from the sign-in list. Switch accounts by signing out.
6. Stop the server with `Ctrl+C` in the VS Code terminal.

Python 3.10 or newer is required. `yyc_demo.db` is created beside `server.py` on first run.

To recreate the full fictitious test dataset, first stop the app, then run:

```powershell
python server.py --reset-demo-data
```

The command saves a timestamped copy of the previous database before rebuilding it. Do not use real YYC client or staff data in this prototype.

## Included in the seeded demo dataset

- 8 teams: Audit 1, Audit 2, Audit 11, Audit 12, Tax 1, Tax 2, Tax 11 and Tax 12.
- 130 fictitious staff records with staff, reviewer, manager, management and director roles.
- 200 fictional groups, 1,000 fictional clients and 2,000 fictional jobs at mixed workflow stages.
- Separate audit and tax workflow templates, with 8 steps each.
- Related `JobSteps` rows for every generated job, plus assignment history and an append-only-by-UI audit log.
- Four client portfolios (`P1`–`P4`) shared between paired audit and tax teams. This is a demo interpretation of the brief's statement that each audit/tax pair can serve the same portfolio. The precise portfolio mapping must be confirmed with YYC.
- Reserved `example.invalid` email addresses only. Client names are all explicitly fictional.

## Role rules implemented

- **Staff / preparer:** My Jobs lists only records currently assigned to that user. Staff can mark their current step Done; the server verifies the current owner. Job Search is restricted to that user's client portfolio. For work assigned to another person or the paired service team, the search response exposes status-only information and the detail endpoint rejects access.
- **Reviewer / supervisor:** The demo can be signed in as a reviewer. Reviewer visibility is limited to assigned/review work in the reviewer's own team.
- **Team manager:** Can see the manager's own team, create a job, assign an owner and reassign an existing job with a reason. Can approve or return work waiting for a manager check. A returned work item keeps the comment and returns to its recorded preparer.
- **Management:** Can see all teams and jobs in a read-only view, inspect audit history and export a database backup.
- **Director:** Can see all teams, create a job and manually allocate an unassigned job to a service-compatible team in the correct client portfolio. The manager then assigns the staff owner. A director cannot reassign an already assigned job; reassignment is manager-only.

These rules are checked in the Python API, not just by hiding buttons. However, the login screen deliberately lets a user select a demo role without real authentication, so this is **not production security**. Replace demo sign-in with approved Microsoft 365 identity/SSO and enforce the final role map before any real data is used.

## Sprint 2 work mapped to the backlog

| Backlog item | Included prototype implementation |
|---|---|
| PB-010 / PB-011 | Local isolated development environment and a single code folder suitable for committing to GitHub. Microsoft 365/Power Platform licensing still needs YYC's confirmation. |
| PB-012 | Related Groups and Clients tables, team portfolio filtering and fictitious contact email fields. |
| PB-013 | Teams and Staff tables with role and Active / On leave / Resigned status. |
| PB-014 | Separate Audit and Tax workflow templates. New jobs copy template steps into `job_steps`. |
| PB-015 | Jobs and Job Steps relational tables plus indexed team, status, owner, service and client columns. |
| PB-016 | Seed/reset generator for 8 teams, 130 staff, 1,000 clients in 200 groups and 2,000 fictitious jobs. |
| PB-019 / PB-020 | Short create-job form and immutable service/year/sequence Job IDs. Client feedback changes automatic team routing: newly created work waits in the director's Intake Queue. |
| PB-040 | My Jobs, assigned-owner filtering, urgency-first order and count cards. |
| PB-041 | Job Detail, service/team/client/FYE/MA date/day count, timeline, planned day, completion date and completion actor, plus read-only status for the same client’s linked Audit or Tax job. |
| PB-042 | One-click Done with server timestamp/name audit fields; job waits for manager checking before progressing. |
| PB-044 | Related audit log for job creation, Done, manager approval/return, team allocation and assignment/reassignment. UI is read-only. |
| PB-054 | Text status chips with consistent colours: On track, At risk, Overdue and On hold. |
| PB-087 | API scope rules for assigned staff, own-team manager/reviewer, and all-team management/director; cross-service staff search is status-only and portfolio-limited. |
| PB-089 | Fictional seed data and visible data-handling warnings; no real data or public AI integration. |

## Client feedback represented in the prototype

1. **Audit and tax separate:** jobs have one service and one team; each service has a distinct workflow template.
2. **Cross-service status visibility:** staff can search status within the paired portfolio, but cannot open another person's/other-team job detail.
3. **Client portfolio boundary:** staff/manager client search is filtered to their portfolio; manager job views are team-scoped.
4. **Assigned jobs only:** My Jobs filters by the signed-in user's current owner ID.
5. **Job lookup:** filters include client/Job ID/group, service, stage, status and team/owner where permitted.
6. **Manager check:** Done places the step in Needs Manager Check; manager can approve or return with a required reason.
7. **Manager-only reassignment:** the server checks the role and team, requires a reason and writes assignment history.
8. **Manual director allocation:** newly created jobs are unassigned until a director chooses a team; manager subsequently assigns a person.
9. **Role visibility:** staff see assigned jobs; managers see their team; management/directors see all teams, while management's screen remains read-only.
10. **Linked data and backup:** SQLite relational tables are used; management/directors can download JSON data backup or a SQLite file; director can restore a validated JSON backup.

## Important boundaries — do not call these finished production features

- The supplied brief says detailed tax steps and the audit step list will be confirmed/shared separately. The 8 main stages come from the brief, but step-day allocations in this demo are provisional. They sum to 45 days for audit and 65 for tax through the first-draft step only. Confirm the detailed template with YYC before claiming the estimates are approved.
- PB-053 automatic status calculation and daily variance/alert rules are Sprint 3 scope. This prototype displays generated urgency status labels; it does not yet calculate the final agreed status rules.
- PB-045-style manager review was brought forward in a minimal form because it was explicitly requested in the Sprint 1 client feedback. It is a simple approval gate, not the full four-draft review/amendment logic.
- Outlook intake, notifications, real M365 SSO, SharePoint integration, Excel export, production Dataverse/SQL hosting, public-facing deployment, PDPA approval, and production backup scheduling are not implemented here.
- `yyc_demo.db` is a local, single-developer prototype database. The database files and JSON backups may contain generated but still substantial demo data; keep them in the project folder and do not commit backup files unnecessarily.

## Main files

- `server.py` — HTTP server, API, role checks, database initialisation and demo-data generator.
- `schema.sql` — relational schema and indexes.
- `public/index.html` — app shell and modals.
- `public/app.css` — responsive visual design using a navy/blue palette consistent with the Sprint 1 concept.
- `public/app.js` — navigation, tables, role views, job detail, search and interactions.

## Recommended Git checkpoint

After reviewing the files and confirming the demo runs, from the project root:

```powershell
git status
git add sprint2
git commit -m "Implement Sprint 2 job control prototype"
``` Do not commit `sprint2/yyc_demo.db`, backup `.db` files, or any real confidential data unless your supervisor/team explicitly wants demo database files versioned. The `.gitignore` suggestion below can help.
