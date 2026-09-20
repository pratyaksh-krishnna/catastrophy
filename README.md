# Catastrophy

Catastrophy is a Delhi building-safety demo. A Reporter pins a Building and submits Evidence. Bedrock classifies it into a closed Hazard Type catalogue; Inngest generates an Assessment. Approved residents and Office-bearers can see the Assessment. An approved Office-bearer can send an Escalation to the responsible authority. The public map exposes only k-suppressed heat cells.

The [specification](docs/SPEC.md), [vocabulary](CONTEXT.md), and [architecture decisions](docs/adr/) define the intended behavior. The [core plan](docs/superpowers/plans/2026-09-18-catastrophy-core.md) defines the implemented demo scope. The [code review and work register](docs/CODE_REVIEW_2026-09-18.md) tracks findings and next steps across contributors. External ingestion and Area Signal feeds are deferred in that plan.

## Local setup

Requires Node 20+, Docker with PostGIS, AWS credentials for Bedrock/SES, and an Inngest account or local dev server. Production photo uploads also require S3.

```sh
npm ci
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run db:migrate:test
npm run dev
```

In a second terminal, run `npm run dev:inngest` before submitting Evidence. The app's
`INNGEST_DEV=1` setting sends assessment events to this local server on port 8288;
without it, Evidence is saved but Assessment generation remains pending in the outbox.

Replace the placeholder values in `.env`, especially `MODEL`, `REPORTER_SESSION_SECRET` (at least 32 random characters), `SES_FROM`, and the three authority email addresses. `MODEL` must be a Bedrock Converse model enabled in the selected AWS region. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` for a deployed Inngest app, with `/api/inngest` as its serve URL. A local Inngest dev server must target that route while the Next.js app is running. During `next dev`, photo originals and EXIF-free derivatives are kept privately under the ignored `.local-media/` directory, so local test submissions do not need S3. Production photo uploads require a real `S3_BUCKET`. Bedrock and Inngest are still needed for the full Assessment flow.

The migration script applies `drizzle/*.sql` in order and checks their checksums. If a database already has the original `0000_init.sql` schema but no migration ledger, verify that schema first, then run `BASELINE_EXISTING_SCHEMA=1 npm run db:migrate` once. Fresh Docker databases do not need this setting.

```sh
npm run typecheck
npm test
npm run build
```

The integration tests use the separate `DATABASE_URL_TEST` PostGIS database. Run `npm run db:migrate:test` before `npm test`. Tests write records to that database.

## Manual approvals and authority responses

A Reporter receives a private Evidence receipt at `/evidence/<id>`. Filing Evidence alone never grants access to a Building Assessment. A reviewer must verify residence or Office-bearer standing outside the app before running a privileged command with `DATABASE_URL` set:

```sh
node scripts/admin.mjs resident <evidence-id>
node scripts/admin.mjs society <evidence-id> "Society name"
node scripts/admin.mjs assign-society <evidence-id> <existing-society-id>
node scripts/admin.mjs office <evidence-id>
```

The `society` command assigns the Building referenced by that Evidence to a new Society; `assign-society` uses an existing Society. Run one of them before `office` for a Building without a Society. The Reporter can then refresh their Evidence receipt to open the private Assessment. The `Escalate to authorities` action appears only for an approved Office-bearer when the Alert Level is `escalated` or `critical`.

Authority replies and hand-filed complaint tickets are entered by a reviewer:

```sh
node scripts/admin.mjs ticket <escalation-id> <ticket-number>
node scripts/admin.mjs ack <escalation-id>
```

The private Assessment shows the latest status per authority. Escalation ids are stored in the `escalations` table. In development, `ESCALATION_INBOX` can collect all generated complaint emails if authority-specific addresses are not configured. Production requires `MCD_ESCALATION_EMAIL`, `DDA_ESCALATION_EMAIL`, and `DDMA_ESCALATION_EMAIL`.

## Privacy and demo limits

- Public routes expose no Building addresses, coordinates, Hazard details, Scores, or heat-cell Building counts.
- A signed, HTTP-only cookie identifies a pseudonymous Reporter. The Evidence-status route only returns that Reporter's receipt and processing state. Approved access is stored separately in the database.
- This demo has no durable email or identity verification for Reporters. Clearing a cookie creates a new Reporter identity, so independence-based Confidence can be gamed. Add verified identity and rate limiting before public deployment.
- Device geolocation is supplied by the browser and can be spoofed. It corroborates a user-placed pin and EXIF metadata; it is not proof of residence.
- Authority acknowledgement and ticket entry are manual because the documented government systems expose no API. No automatic municipal submission is performed.
