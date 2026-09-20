# Catastrophy

Catastrophy is a Delhi building-safety demo. A Reporter pins a Building and submits Evidence. Bedrock classifies the observation into a fixed Hazard catalogue, and Inngest regenerates a Building Assessment with an Alert Level and a resident-facing summary. An Assessment does **not** automatically notify an authority. The public map shows privacy-suppressed Building heat cells and separate area-level news and civic Signals.

The [specification](docs/SPEC.md), [vocabulary](CONTEXT.md), and [architecture decisions](docs/adr/) describe the product rules. The [core plan](docs/superpowers/plans/2026-09-18-catastrophy-core.md) records the initial implementation plan; the [code review](docs/CODE_REVIEW_2026-09-18.md) tracks remaining work.

## Pages and access

| Page | Who can open it | What it shows |
| --- | --- | --- |
| `/` | Anyone | Suppressed Building heat cells and area-level Signal summaries. No exact location or address from private Building records. |
| `/report` | Anyone | Form to pin a Delhi Building and submit an observation, with an optional photo. Submission requires browser location access. |
| `/evidence/<evidence-id>` | The Reporter who submitted that Evidence, in the same browser session | Private receipt and `processing` or `assessed` status. It does not reveal the Assessment before access is approved. |
| `/building/<building-id>` | Approved residents and approved Society Office-bearers | Current Alert Level, summary, Hazards, support level, and any recorded authority response. |

There is no approval page yet. A reviewer verifies residence or Office-bearer standing outside the app and uses the [manual approval commands](#manual-approvals-and-real-authority-emails). Filing Evidence does not grant access to a Building Assessment. Only an approved Office-bearer can use the real **Escalate to authorities** action, and only when an `escalated` or `critical` Assessment needs escalation.

## Local setup

Use Node 20+, Docker with PostGIS, and AWS credentials with access to the configured Bedrock Converse model. SES configuration is needed only for real authority emails. Production photo uploads need S3.

```sh
npm ci
cp .env.example .env
docker compose up -d
npm run db:migrate
```

Set `REPORTER_SESSION_SECRET` in `.env` to at least 32 random characters. Configure `AWS_REGION`, `MODEL`, and Bedrock credentials before submitting Evidence. The model must be enabled in that AWS region. The `SES_FROM` and authority addresses in `.env.example` are placeholders; replace them before testing real delivery.

Start the app, then start the local Inngest runner in a **second terminal**:

```sh
npm run dev
```

```sh
npm run dev:inngest
```

The app runs at `http://localhost:3000`, its Inngest endpoint is `/api/inngest`, and the local Inngest UI runs at `http://localhost:8288`. With `INNGEST_DEV=1`, the app sends Assessment events to that local runner. If the runner is down, Evidence can still be saved, but the Assessment remains pending in the durable outbox. Start the runner and revisit the Evidence receipt to trigger a retry; the runner also retries pending requests on a schedule. For a deployed Inngest app, unset `INNGEST_DEV`, configure `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, and serve `/api/inngest`.

During `npm run dev`, uploaded photo originals and EXIF-free derivatives are stored privately in the ignored `.local-media/` directory. Text-only Evidence needs no S3. Production photo uploads require a real `S3_BUCKET`. The report form still requests the browser's device location and requires the Building pin to be inside the Delhi map area. Local development skips the 150 m proximity confirmation so a Reporter outside Delhi can test the flow; test and production environments retain that check.

The migration script applies `drizzle/*.sql` in order and checks their checksums. If a database already has the original `0000_init.sql` schema but no migration ledger, verify that schema first, then run `BASELINE_EXISTING_SCHEMA=1 npm run db:migrate` once. Fresh Docker databases do not need this setting.

If a receipt remains `processing`, check that both `http://localhost:3000/api/inngest` and `http://localhost:8288/health` respond, then inspect the run in the local Inngest UI. A working app endpoint alone does not mean the runner is running. If `/building/<building-id>` returns 404 for the Reporter, verify that their browser still has the submission cookie and that the correct Evidence receipt was approved.

## Demo walkthrough

1. Start the app and Inngest runner. Open `/report`, enter an address beginning with `DEMO ONLY`, pin a Building in Delhi, describe specific visible damage, and submit. The browser must be allowed to provide its device location.
2. Open the private `/evidence/<evidence-id>` receipt. The classifier runs during submission; Inngest then generates the Assessment. Refresh or wait for the receipt to change to **assessed**.
3. After checking that this is your demo Reporter, run `node scripts/admin.mjs resident <evidence-id>`. Refresh the receipt and choose **View Building Assessment**.
4. If the demo Building's Alert Level is `escalated` or `critical`, the approved Reporter's receipt also shows an **Authority email preview** assembled from the current Assessment. The **Send demo email** button changes only the page state. It makes no network request, sends no email, and creates no Escalation record. Refresh to reset it for another recording.

The demo preview is available only on approved Evidence receipts for Buildings whose address starts with `DEMO ONLY` and whose Alert Level is `escalated` or `critical`. It is separate from the real Office-bearer escalation action on the Building page. For a reproducible example, describe a diagonal crack in a load-bearing wall, damaged stair landing, and exposed reinforcement. Model classifications and prose may vary.

## Manual approvals and real authority emails

A reviewer must verify the person's standing before using these privileged commands with `DATABASE_URL` set:

```sh
node scripts/admin.mjs resident <evidence-id>
node scripts/admin.mjs society <evidence-id> "Society name"
node scripts/admin.mjs assign-society <evidence-id> <existing-society-id>
node scripts/admin.mjs office <evidence-id>
```

`resident` grants access to one Building's Assessment. To approve an Office-bearer, first assign that Building to a new or existing Society, then run `office`. An approved Office-bearer sees **Escalate to authorities** on the Building page when the current Assessment qualifies. Clicking it sends a complaint email through SES to the configured authority inboxes and records an Assessment snapshot in `escalations`. Severity-5 Hazards also route to MCD and DDMA. This action sends a real email; it is not the demo button.

Real delivery requires a working `SES_FROM` and the relevant `MCD_ESCALATION_EMAIL`, `DDA_ESCALATION_EMAIL`, or `DDMA_ESCALATION_EMAIL`. In development, `ESCALATION_INBOX` is a fallback only when the authority-specific variable is unset. The `.env.example` values ending in `.invalid` cannot be used for delivery. Sending an email does not create a government complaint ticket automatically.

Authority replies and hand-filed ticket numbers are entered by a reviewer:

```sh
node scripts/admin.mjs ticket <escalation-id> <ticket-number>
node scripts/admin.mjs ack <escalation-id>
```

The private Building Assessment shows the latest recorded status per authority. Delivery and acknowledgement are separate: an `escalated` Alert Level alone means no email has been sent.

## Area Signals and the public map

The Building heat layer suppresses sparse cells and exposes no exact Building location, address, Score, or private Evidence. The separate Signals layer shows area-level counts, generated summaries, and limited public source links; it does not reveal raw post text or link a Signal to a Building.

Inngest runs `ingest-area-signals` every six hours, and it can be triggered manually from the local Inngest UI. `INGEST_SOURCE=fixtures` replays the committed sample feed by default. Set `INGEST_SOURCE=firecrawl` and `FIRECRAWL_API_KEY` to use live discovery instead. Both sources deduplicate by source ID; Bedrock extracts Signal topics and generates cell summaries.

## Verification and limits

```sh
npm run db:migrate:test
npm run typecheck
npm test
npm run build
```

Integration tests use the separate `DATABASE_URL_TEST` PostGIS database and write test records there.

- A signed, HTTP-only cookie identifies a pseudonymous Reporter. Clearing it creates another identity; this demo has no verified Reporter identity or rate limiting.
- Device geolocation can be spoofed and does not prove residence. Residence and Office-bearer access require manual review.
- Reporters receive no automatic email with Assessment results. The receipt shows processing status; approved people open the private Building page for the full result.
- Real SES delivery has no durable email outbox yet. Authority ticket and acknowledgement updates are manual. See the [code review](docs/CODE_REVIEW_2026-09-18.md) for follow-up work.
