# Sprint 2 manual test checklist

Use fictitious data only. Test the cases below with different demo accounts. The local prototype database should be disposable.

## Setup and data foundation

- [ ] Start the app with `python server.py` and open `http://127.0.0.1:8000`.
- [ ] Sign in using the Staff / Audit 1 demo account.
- [ ] Open Database & Backup as management/director and confirm the demo shows 8 teams, 130 staff, 200 groups, 1,000 clients and 2,000 jobs.
- [ ] Open Workflow Templates and check that Audit and Tax have separate 8-step templates and 45/65-day first-draft target statements.
- [ ] Check the data notice and confirm no real names or real email addresses are present.

## Staff / preparer

- [ ] Open My Jobs and confirm every row is assigned to the signed-in staff member.
- [ ] Open one assigned job; verify client/group, service, team, FYE, owner, MA received date, elapsed days and timeline.
- [ ] Press Done on the current step. Confirm the step shows Awaiting review and the manager's queue count increases.
- [ ] Try opening a different person's job by editing the URL to `/api/jobs/<id>` in the browser or by making a request. The API should return 403.
- [ ] Search by at least three characters of a client name or Job ID. Confirm status-only cross-service results do not open into full detail.
- [ ] Open an assigned job for a client who also has a paired Audit/Tax job. Confirm Job Detail shows only the linked job ID, service, team, stage and status — not its owner or timeline.
- [ ] Confirm the search scope stays within the paired team portfolio.

## Manager

- [ ] Open Team Board and confirm it shows only the signed-in manager's team.
- [ ] Open Needs Manager Check, inspect a pending item and Approve it. Confirm the current step completes and the next step/owner comes from the workflow template.
- [ ] Repeat with Return for amendment and enter a reason. Confirm the comment and return action are recorded.
- [ ] Assign a person to a team job with no owner.
- [ ] Reassign an active job to a different active person in the same team; select a reason and confirm Assignment History records from/to/reason/actor/time.
- [ ] Attempt an API reassign as staff; confirm it is rejected.

## Director and management

- [ ] As a director, open Intake Queue and open an unassigned job.
- [ ] Assign a team matching the job service and client portfolio. Confirm the queue item is now in the selected team's manager view.
- [ ] As director, try to reassign an owned job. It should not be offered in the UI and the API should reject it.
- [ ] As management, confirm every team is visible, but no Done/assignment/approval control is offered.
- [ ] Download a JSON backup and a SQLite backup as management/director.
- [ ] As director, restore a known JSON backup only after downloading a current backup first; confirm you need to sign in again.

## Browser and API checks

- [ ] Resize the browser to a narrow phone-like width; navigation and tables remain usable through horizontal table scrolling.
- [ ] Confirm status chips display both text and colour.
- [ ] Confirm current assigned person and only manager/director permissions are enforced by API, not just UI controls.
- [ ] Review `sprint2/yyc_demo.db` using SQLite viewer if desired. Linked foreign keys should connect clients/groups, jobs/job steps, staff and workflow templates.

## Notes / known limits

This is a local prototype with selectable demo identities. It is not approved for real client data. The 45/65 day targets are represented, but the complete PB-053 status calculation and alert rules remain Sprint 3 work. Workflow step-day allocations are provisional until YYC confirms the detailed workflow matrix.
