# Task 5 Report: Database schema and PostGIS migration

## What was created

- `.env.example` — verbatim from the brief (DATABASE_URL, DATABASE_URL_TEST at 127.0.0.1:55432, MODEL, AWS_REGION, S3_BUCKET, SES_FROM, ESCALATION_INBOX).
- `drizzle/0000_init.sql` — verbatim from the brief: `postgis`/`pgcrypto` extensions and the 11 tables (`societies`, `reporters`, `office_bearers`, `buildings`, `evidence`, `hazards`, `evidence_hazards`, `assessments`, `escalations`, `resolution_claims`, `area_signals`) with the specified indexes (GIST on `buildings.location`, btree on `evidence.building_id`, `hazards.building_id`, `escalations.building_id`, `area_signals.geohash`) and the `UNIQUE (building_id, type_id)` constraint on `hazards`. Applied with:
  `PGPASSWORD=catastrophy psql -h 127.0.0.1 -p 55432 -U postgres -d catastrophy -f drizzle/0000_init.sql` — all `CREATE TABLE`/`CREATE INDEX` succeeded (postgis extension was already present in the container from a prior setup step; pgcrypto and every table/index were created fresh).
- `drizzle.config.ts` — not specified verbatim in the brief; added a standard Drizzle Kit config (`dialect: "postgresql"`, `schema: "./src/db/schema.ts"`, `out: "./drizzle"`, `dbCredentials.url` from `DATABASE_URL`) since the brief lists it as a file to create but gives no contents. Not exercised by tests; included for completeness/future `drizzle-kit` use.
- `src/db/client.ts` — verbatim from the brief.
- `src/db/schema.ts` — verbatim from the brief (all 11 `pgTable` definitions plus the `point` custom type for `geography(Point, 4326)`).
- `src/db/schema.test.ts` — the brief's three tests, with one deviation (see "Decisions not specified by the brief" below).
- `vitest.setup.ts` (new) and an edit to `vitest.config.ts` — see "Env-loading gap" below.

## Env-loading gap — how it was solved

Vitest doesn't read `.env` automatically, and `src/db/client.ts` needs `process.env.DATABASE_URL_TEST`. I:
1. Installed `dotenv` as a **devDependency** (test-only concern, not a runtime dependency of `src/`).
2. Added `vitest.setup.ts`:
   ```ts
   import { config } from "dotenv";
   config({ quiet: true });
   ```
3. Wired it into `vitest.config.ts` via `test.setupFiles: ["./vitest.setup.ts"]`.

This runs before every test file. The four pre-existing domain test files (`hazard-catalogue.test.ts`, `confidence.test.ts`, `score.test.ts`, `cells.test.ts`) don't read `process.env` at all, so loading `.env` is a harmless no-op for them — confirmed by all 27 of their tests still passing.

## Drizzle typed insert vs. raw SQL

The brief's `db.insert(buildings).values({ ..., location: sql\`ST_SetSRID(...)::geography\` })` **worked as written** — Drizzle's typed insert accepted the raw `sql` fragment for the `geography` column without complaint. I did not need the Task-6-style `db.execute(sql\`INSERT ...\`)` fallback described in the controller ruling. `src/db/schema.ts` was kept exactly as specified.

## Decisions not specified by the brief

1. **`drizzle.config.ts` contents** — brief lists the file but gives no code; I wrote a minimal standard config (see above).
2. **TypeScript strict/`noUncheckedIndexedAccess` vs. the brief's verbatim test code**: with `noUncheckedIndexedAccess` on (a repo-wide constraint, not something I could relax), `r.rows[0].v`, destructured `row`/`b` from `.returning()`, and `back.rows[0].lat` all type as possibly-`undefined`, so `npx tsc --noEmit` failed on the brief's literal test text. I added non-null assertions (`!`) at exactly those four access points (`r.rows[0]!.v`, `row!.id` ×2, `back.rows[0]!.lat`, `b!.id` ×2) — no behavioral change, all three assertions from the brief are unchanged in substance and still run against the real database. This was necessary to satisfy the "tsc must print nothing" verification requirement without weakening `tsconfig.json`.
3. Added `config({ quiet: true })` (dotenv v17 option) purely to suppress dotenv's promotional stdout banner during test runs; functionally identical to plain `config()`.

## Verification

### 1. `npx tsc --noEmit`
```
$ npx tsc --noEmit
(no output, exit 0)
```

### 2. `npx vitest run`
```
 RUN  v5.0.1 /Users/basantnarayansingh/projects/catastrophy

 ✓ src/domain/confidence.test.ts > computeConfidence > is zero with no evidence 1ms
 ✓ src/domain/confidence.test.ts > computeConfidence > caps a single reporter no matter how much they submit 0ms
 ✓ src/domain/confidence.test.ts > computeConfidence > rises with independent reporters 0ms
 ✓ src/domain/confidence.test.ts > computeConfidence > weights an official record above a social post 0ms
 ✓ src/domain/confidence.test.ts > computeConfidence > rewards corroboration across source classes over repetition within one 0ms
 ✓ src/domain/confidence.test.ts > computeConfidence > decays with age 0ms
 ✓ src/domain/confidence.test.ts > computeConfidence > penalises a device fix that disagrees with EXIF 0ms
 ✓ src/domain/confidence.test.ts > computeConfidence > never exceeds 1 0ms
 ✓ src/domain/hazard-catalogue.test.ts > hazard catalogue > is closed and non-empty 1ms
 ✓ src/domain/hazard-catalogue.test.ts > hazard catalogue > gives every type a severity in 1..5 and an authority 1ms
 ✓ src/domain/hazard-catalogue.test.ts > hazard catalogue > carries the `other` escape hatch at the lowest severity 0ms
 ✓ src/domain/hazard-catalogue.test.ts > hazard catalogue > routes unauthorised construction to DDA 0ms
 ✓ src/domain/hazard-catalogue.test.ts > hazard catalogue > exposes severity by id 0ms
 ✓ src/domain/score.test.ts > score > is zero with no open hazards 1ms
 ✓ src/domain/score.test.ts > score > ranks a credible severe hazard above a widely-reported trivial one — ADR-0001 0ms
 ✓ src/domain/score.test.ts > score > scales risk by confidence 0ms
 ✓ src/domain/score.test.ts > score > bands a quiet building as monitor 0ms
 ✓ src/domain/score.test.ts > score > never reaches critical without a severity-5 hazard, however many minor ones pile up 1ms
 ✓ src/domain/score.test.ts > score > reaches critical on a confident severity-5 hazard 0ms
 ✓ src/domain/score.test.ts > score > caps escalated behind a severity-4 hazard 0ms
 ✓ src/domain/score.test.ts > score > stays within 0..1 0ms
 ✓ src/domain/cells.test.ts > suppressCells > renders nothing for a lone reported building 2ms
 ✓ src/domain/cells.test.ts > suppressCells > renders nothing below the k threshold 1ms
 ✓ src/domain/cells.test.ts > suppressCells > renders a cell once k distinct buildings fall inside it 0ms
 ✓ src/domain/cells.test.ts > suppressCells > merges sparse points upward into a coarser cell rather than dropping them 0ms
 ✓ src/domain/cells.test.ts > suppressCells > counts each building once however many times it appears 0ms
 ✓ src/domain/cells.test.ts > suppressCells > gives intensity in 0..1 and never leaks a raw count through it 0ms
 ✓ src/db/schema.test.ts > schema > has postgis available 127ms
 ✓ src/db/schema.test.ts > schema > stores and reads a building's point 46ms
 ✓ src/db/schema.test.ts > schema > refuses a second hazard of the same type on one building 9ms

 Test Files  5 passed (5)
      Tests  30 passed (30)
```

27 pre-existing domain tests + 3 new schema tests = 30 total, all passing.

## Commit

`61d11f6` — "feat: postgis schema for buildings, evidence, hazards, assessments and escalations", on branch `feat/catastrophy-core`.

Files: `.env.example`, `drizzle.config.ts`, `drizzle/0000_init.sql`, `src/db/client.ts`, `src/db/schema.ts`, `src/db/schema.test.ts`, `vitest.setup.ts`, plus edits to `package.json`, `package-lock.json` (drizzle-orm, pg, drizzle-kit, @types/pg, dotenv), and `vitest.config.ts` (setupFiles). `docker-compose.yml` was already committed in a prior task and needed no change.

Severity is not computed or written anywhere in this task — hazards table only stores `type_id`; severity remains sourced from the Task 1 catalogue at read time (not touched by this task's code).
