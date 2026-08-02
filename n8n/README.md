# Scheduled workflows

Two jobs run on a schedule. Both call the API's machine routes, which are gated
by `ADMIN_TOKEN`.

| Workflow | Schedule | Calls | What it does |
|---|---|---|---|
| `workflow-monitor.json` | Daily 06:00 | `POST /monitor` | Finds newly published data-protection acts and ingests them |
| `workflow-digest.json` | Monday 08:00 | `POST /digest` | Builds the weekly summary and emails everyone who opted in |

Neither ships active. Import, add credentials, point at your host, then enable.

## Setup

**1. Create the admin credential.** In n8n: **Credentials -> New -> Header
Auth**, named exactly `Dlifios admin token`.

| Field | Value |
|---|---|
| Name | `Authorization` |
| Value | `Bearer <your ADMIN_TOKEN>` |

The token lives in the credential store, not in these files, which is why they
are safe to commit.

**2. Import both workflows.** **Workflows -> Import from File**.

**3. Replace the host.** Each HTTP node has
`https://REPLACE-WITH-YOUR-API-HOST` in its URL. Point it at your deployment.
n8n cannot reach `localhost`, so this has to be a real reachable host.

**4. Connect Gmail** on the digest workflow's send node. Requires a Gmail OAuth2
credential.

**5. Test before enabling.** Run each once with **Execute Workflow**.

- `/monitor` returns `{ found, ingested, skipped }`. Zero found is normal; the
  EU does not publish data-protection acts most weeks.
- `/digest` returns `{ subject, body, recipients }`. With nobody opted in,
  `recipients` is empty and the Gmail node runs zero times, which is correct.

**6. Activate** with the toggle.

## Notes

Both send an empty JSON body, so each endpoint applies its own default window of
seven days. The monitor's overlap is deliberate: ingestion is idempotent, so an
act already in the corpus is skipped rather than duplicated, and a missed run
costs nothing.

The digest reads its recipient list fresh on every run, so an unsubscribe or a
deleted account takes effect on the next send with no list to keep in sync.

`/ask` is deliberately not a workflow. Someone is waiting on that response, so
it belongs in the request path, not a scheduled job.
