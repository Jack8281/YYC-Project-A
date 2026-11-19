# YYC-Project-A

YYC Corporate Division

Automate Job Control Log for Audit & Tax
Project brief and requirements

Prepared for
INTI project team: Wong Chye Yi (Leader), Chan Zhi Ying, Pua Yao Quan, Kio Xiao Jie, Koh Boon Heok
Supervisor
Dr. Robina
YYC contacts
Mr. Chew Wai Hoor, Mr. Kim Yap
1
Background
YYC Corporate Division has around 130 staff: 60 audit, 60 tax and 10 admin.
We serve around 1,000 clients in about 200 groups.
We use Microsoft 365: SharePoint for files and Outlook for email.
Work is split into 8 teams, each with a fixed client portfolio of about 250–300 clients.

Audit
Team 1, 2, 11, 12
Tax
Team 1, 2, 11, 12
2
Problem statement
Job progress is tracked in large Excel control logs that around 100 preparers update manually.
During peak season, updates are late or missed, so managers can't see the real status of jobs.
It's hard to spot delayed jobs early, know who is holding a job, or balance workload across staff.
3
Objective
Build a system that replaces the manual Excel control log, giving real-time visibility of every audit and tax job from receipt of Management Accounts (MA) until submission, with minimal manual effort from staff.

4
Scope
In scope
Job tracking for both audit and tax workflows
Assignment, reassignment and routing of jobs
Progress monitoring against targets, with alerts
Dashboards for staff, managers and management
Integration with SharePoint and Outlook
Out of scope
Client communication (stays in Outlook and WhatsApp)
Preparing the actual accounts or tax computations
Replacing SharePoint as the document repository
5
Users and roles
Preparer	Works on the job and updates progress
Reviewer / Supervisor	Reviews drafts, returns them for amendment or approves them
Manager / Senior Manager / Associate Director	Receives new jobs, assigns preparers, monitors the team and reassigns work; maintains clients, teams, staff and settings
Management (COO / Directors)	Overall view across all 8 teams
6
Workflow overview
A job starts when the MA email is received, then moves through these main stages:

Preparation
Review
Amendments
Draft to client
Client review
Re-review
Finalisation
Submission
Submission goes to SSM for audit and LHDN for tax.
A job may have 18–20 steps and multiple handoffs.
Complex clients may need up to 4 drafts.
Tax also has secondary compliance deadlines based on the client's financial year end (FYE).
The detailed step list, owners and estimated days per step will be shared separately. The tax workflow matrix is attached; the audit workflow will follow.

7
Functional requirements
7.1 Job intake
Create a job automatically, or with one click, when the MA email is received.
Each job has a unique Job ID, client, group, service (audit or tax), FYE and team.
Route new jobs to the correct team manager based on the client portfolio.
7.2 Assignment and ownership
Every active job must always be assigned to one named person.
The manager confirms or changes the preparer.
Jobs can be reassigned (for example when staff are on leave, have resigned or are overloaded), with the history kept.
7.3 Progress tracking
Staff update each step with minimal effort, for example a one-click "Done" with an automatic timestamp.
Optional: read standardised email subject codes (for example Job ID plus step code) to update status automatically.
Keep a full audit trail of who did what, and when.
7.4 Targets and alerts
Service targets are measured from MA received to first draft sent to client.

45 days
Audit
MA received to first draft
65 days
Tax
MA received to first draft
Each step has an estimated duration, so the system can flag jobs that are behind schedule early (for example, not progressed by day 30).
Alert the job owner first, then escalate to the manager if not resolved.
Track secondary tax compliance deadlines by FYE.
7.5 Delay management
Record a delay reason when a job is late or on hold, such as client not responding, waiting for documents, workload or a technical issue.
Report on delay reasons to find common bottlenecks.
7.6 Dashboards and reports
Personal view: my jobs, due soon and overdue.
Manager view: team jobs by stage, overdue list and workload per staff member.
Management view: all teams, percentage of jobs within 45 or 65 days, and ageing analysis.
Export to Excel.
8
Non-functional requirements
Works within Microsoft 365 (SharePoint and Outlook; Power Platform or Teams may be considered).
Role-based access: staff see their own team's jobs, and management sees all teams.
Supports around 1,000 clients and 130 users, including peak-season load.
Simple and fast to use; updating a step should take seconds.
Client data is kept confidential and handled in line with PDPA.
Easy for YYC to maintain after handover, with documentation provided.
9
Deliverables
Workflow mapping for audit and tax (steps, owners, estimated days, handoffs, completion criteria)
Proposed project timeline and milestones, to be decided by the team
Proposed system design and UI/UX mockups
Working prototype or system
Test plan and results
User guide and technical documentation
Progress presentation every 3 weeks
10
Success criteria
The Excel control log is no longer needed for daily tracking.
The status of any job is visible in real time.
Late jobs are flagged before they miss the 45- or 65-day target.
Managers can see workload and reassign work easily.
Please raise any questions in the project WhatsApp group. Thank you.

## Local interface preview

The project opens on the existing role-specific pages; no separate dashboard
page is used. On `localhost`, sign in with the actual Firebase Authentication
email and password. Role and team are read from that account's Firestore
`users/{Authentication UID}` profile. Email verification is skipped locally
only; an unverified testing account must have the boolean
`allowUnverifiedTesting: true` field in its profile, and the Firestore rules
must be deployed. Deployed sign-ins still require a verified email.

The role pages read actual Firestore user, client, and job records subject to
the role-specific rules. The local pages are read-only: workflow actions,
assignment, routing, and client/job forms are disabled because they require
the callable Functions backend. Deploying Firestore rules alone is supported
on the Spark plan; deploying Cloud Functions requires Blaze.

For an unverified test account, add boolean `allowUnverifiedTesting: true`
only to its `users/{Authentication UID}` test profile, then deploy just the
Firestore rules:

```powershell
firebase deploy --project login-details-dea33 --only firestore:rules
```

This rules-only deployment does not require the Blaze plan. Do not deploy
Functions unless you are ready to enable billing and turn on write actions.

Start the local server from the project folder:

```powershell
python -m http.server 8000
```

Open [http://localhost:8000/login.html](http://localhost:8000/login.html).

## Optional Firebase-backed deployment

The existing role-specific pages (`worker-page.html`, `manager-page.html`,
`director-page.html`, and `management-page.html`) are the application entry
points. Login routes each user to their role page; they are not sent to a
separate dashboard page. Clients and jobs are stored in Cloud Firestore.
Role-sensitive changes are performed by Firebase callable Cloud Functions;
Firestore rules protect reads and prevent direct client writes. The web app
configuration is in `firebase-config.js`.

### Deploy rules and backend

1. In Firebase Console, enable **Authentication → Sign-in method →
   Email/Password** and create the default Firestore database.
2. Install Node.js 22 and the Firebase CLI. Sign in with an account that
   administers this Firebase project, and select the project from the workspace:

   ```powershell
   Set-Location .\functions
   npm install
   Set-Location ..
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,functions
   ```

   Select project `login-details-dea33`. Deploying Cloud Functions requires a
   Firebase project with billing enabled.
3. In **Authentication → Users**, create each staff account. In Firestore,
   create `users/{Authentication UID}` with string fields `email`,
   `displayName`, `role`, `service`, and `team`. Use `worker` or `manager` for
   `role`, `Tax` or `Audit` for `service`, and one of `Tax 1`, `Tax 2`,
   `Tax 11`, `Tax 12`, `Audit 1`, `Audit 2`, `Audit 11`, `Audit 12` for `team`.
   Directors need `role: "director"`; management users can use
   `role: "management"`. Always set the profile email to the Authentication
   account email. Create and maintain role profiles through trusted admin
   tooling, not the public app.
4. Sign in as a director. Use **Add a client to a team portfolio** to register
   clients, up to 250 for each team. The server checks the cap transactionally.
   Then use **Create and route a job** to choose a client, service, team, FYE,
   and MA-received date. The service and team must match.

### Access and job workflow

- Workers can read only jobs whose `assignedUid` is their own account. They can
  advance the workflow one step at a time. Completing **Submission** sends the
  job to the assigned team's manager for review; workers cannot approve or
  reassign jobs.
- Managers and directors can view all jobs and search/filter by assigned worker
  name, team, service, and status. Managers can assign or reassign jobs only
  within their own team, and approve or return their team's jobs awaiting review.
- Directors and management can view all jobs, search by worker/team, create
  clients/jobs, and manually route a job to a team. Directors do not choose a
  worker; that team's manager does.
- The default service targets are 65 days for Tax and 45 for Audit. Status is
  calculated from the MA-received date; pending manager review and completed
  states are shown separately.
- Tax and Audit jobs are labeled and filterable. Workers can only read their
  own assigned jobs; managers/directors have the broader oversight access
  requested. Staff can only be assigned to jobs in their own team and service.
  The UI filters are not the security
  boundary: `firestore.rules` and callable functions enforce access and writes.

Every job action is recorded in its Firestore `events` subcollection. The
250-client cap applies when adding clients through the director page;
do not create or move client documents manually in Firestore. The system starts
with no seeded client or job records. Deployed users must have verified email
addresses. For localhost testing only, an administrator can add the boolean
field `allowUnverifiedTesting: true` to a test account's
`users/{Authentication UID}` profile in Firebase Console. This lets that
account sign in locally without a verification email; callable job changes
also require a localhost origin. Firestore rules cannot distinguish localhost
from another browser origin, so this test profile can still read data permitted
by its role. Use only a designated test account and remove the flag after
testing.
The client directory is team-scoped for managers. As selected, managers and
directors have broader job-register visibility; manager assignment and review
actions remain limited to the manager's own team.
