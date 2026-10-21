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
