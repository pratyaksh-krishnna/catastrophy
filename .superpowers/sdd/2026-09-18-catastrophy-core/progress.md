# SDD ledger — plan: docs/superpowers/plans/2026-09-18-catastrophy-core.md

Spec: docs/SPEC.md (reachable). Glossary: CONTEXT.md. Decisions: docs/adr/0001..0003.
Branch: feat/catastrophy-core. Base commit: 967a9f9.

## Model assignment
- Haiku 4.5 implementers: Tasks 1, 2, 3, 4, 8 (plan carries complete code; transcription + test)
- Sonnet 5 implementers: Tasks 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16 (DB, integration, UI)
- Reviewers: Haiku for pure-function diffs, Sonnet for integration diffs
- Final whole-branch review: Opus (most capable, per Model Selection)
- Controller (Opus) runs tests itself between tasks; never fixes code in-session

## Pre-flight conflict scan

| # | Scope | Produces → Consumes | Finding |
|---|---|---|---|
| P1 | T1 → T3,T9,T10,T12,T15 | `HazardTypeId`, `severityOf`, `HAZARD_CATALOGUE` | consistent |
| P2 | T2 → T5,T7,T10,T15 | `SourceClass`, `GeoAgreement`, `EvidenceRef`, `computeConfidence` | consistent |
| P3 | T3 → T10,T12,T14 | `OpenHazard`, `AlertLevel`, `rankHazards`, `buildingScore`, `alertLevel` | consistent |
| P4 | T4 → T14 | `suppressCells`, `ReportedPoint`, `RenderedCell` | consistent; T14 narrows to `PublicCell`, dropping `buildingCount` as ADR-0002 requires |
| P5 | T5 → T6,T10,T13,T14,T15,T16 | `db`, `pool`, tables | consistent |
| P6 | T8 → T9,T10 | `converseForTool`, `ToolSpec`, `modelId` | consistent |
| P7 | T10 → T12,T13,T16 | `AssessmentRecord`, `getAssessment`, `buildAssessment` | consistent |
| P8 | T5 vs T6 | both write `drizzle/0000_init.sql` | T6 appends `pg_trgm` to T5's file. Legitimate but ordering-sensitive. |
| P9 | T1 vs T16 | `tsconfig.json` from `tsc --init` has no `jsx` setting; T16 adds `.tsx` | CONFLICT — T16 cannot compile as written |
| P10 | T4, T16 | `import ngeohash from "ngeohash"` under `"type": "module"` | RISK — ngeohash is CJS; default interop may fail |
| P11 | T5 self | `db.insert(buildings).values({location: sql\`...\`})` against a Drizzle `customType` | RISK — typed insert may reject raw SQL for geography |
| P12 | T14 vs T16 | T14 creates `src/app/api/heatmap/route.ts`; Next.js not installed until T16 | Inert file, not imported by T14's tests. No action. |
| P13 | each task self | tests specified vs code specified | consistent across all 16 |

### Rulings
- Ruling (P9): Task 16's implementer must add `"jsx": "preserve"`, `"lib": ["dom","es2022"]`, and `"moduleResolution": "bundler"` to tsconfig as part of its own work. — Why: the plan's Task 1 scaffold predates the React dependency; this is a plan defect, not an implementation choice. — Cost if wrong: Task 16 fails to compile and needs one extra fix round.
- Ruling (P10): if the default import of `ngeohash` fails at runtime, implementers use `import * as ngeohash from "ngeohash"` and keep the same call sites. — Why: interop shape is an environment fact, not a design decision. — Cost if wrong: none; both forms expose the same API.
- Ruling (P11): if Drizzle's typed insert rejects the geography column, use `db.execute(sql\`INSERT ...\`)` as Task 6 already does, and keep `schema.ts` as the type surface only. — Why: the plan already proves the raw-SQL path works for spatial writes. — Cost if wrong: `schema.ts` is documentation rather than a write API; reads still work.
- Ruling (P8): Task 6 appends to the migration and re-applies rather than adding a second migration file. — Why: no deployed database exists; a single init migration is simpler to re-run. — Cost if wrong: trivial re-split later.

## Progress
- Ruling (batching): Tasks 1-4 dispatched as ONE Haiku batch and reviewed as one unit. — Why: all four are the same shape (transcribe complete given code + given tests, make them pass, commit), pure functions with no I/O, and the controller was asked to minimise orchestrator spend. — Cost if wrong: a fix round covers four modules instead of one.
- Tasks 1-4: dispatched (haiku, batch) at BASE 967a9f9. Briefs task-1..4-brief.md. Report -> task-1-4-report.md.
- Env: Docker Desktop started; postgis/postgis:16-3.4 pulled and ready; psql on PATH. Task 5 unblocked.
- Tasks 1-4: implementer returned DONE (commits c111f41, e8c863a, 8ce31ee, f97313e; 27 tests).
- Tasks 1-4: CONTROLLER VERIFICATION — `npx vitest run` 4 files / 27 tests PASS (report confirmed). `npx tsc --noEmit` FAILS with 7 errors (report's "strict TypeScript satisfied" claim was untested):
    * TS7016 src/domain/cells.ts:1 — `ngeohash` ships no type declarations; the import is an implicit `any`, so strict mode is not actually satisfied.
    * TS2532 x6 — cells.test.ts:25,38,44,49,50 and score.test.ts:15, indexed access possibly undefined.
- Tasks 1-4: SECURITY (background commit scan) — docker-compose.yml `ports: ["5432:5432"]` binds Postgres to all interfaces, not loopback.
- Ruling (typecheck gate): `npx tsc --noEmit` is added to the controller's per-task verification for every remaining task, alongside the test run. — Why: the implementer asserted a Global Constraint it never checked, and the test suite does not catch type errors; without this gate the same claim goes unverified 12 more times. — Cost if wrong: a few seconds per task.
- Ruling (postgres binding): the fix is `127.0.0.1:5432:5432`, not removal of the published port — Task 5 onward runs tests against the container from the host, so the port must stay published, just not to the world. The literal dev password stays: it guards a loopback-only throwaway container and rotating it buys nothing. — Cost if wrong: none for a local dev database; if this compose file is ever reused for a shared host, the password becomes load-bearing and must move to an env file.
- Tasks 1-4: dispatched task reviewer (sonnet) on review-967a9f9..f97313e.diff.
- Tasks 1-4: REVIEW — Spec COMPLIANCE (X): all four briefs' interfaces present and matching verbatim, but Global Constraint "TypeScript strict mode on" violated (tsc fails). TASK QUALITY: not approved.
    Critical: project fails `tsc --noEmit` under its own strict config; report claimed the constraint was met without running the typechecker.
    Important: docker-compose.yml:7 all-interface postgres binding (plan-mandated text, copied verbatim, never flagged).
    Important (pattern): implementer treated brief example code as verified ground truth; report claims were restatements of the brief rather than measured outcomes.
    Reviewer confirmed the domain logic and test quality are sound: severity is a literal (hazard-catalogue.ts:104-129); REPORTER_CAP applied per reporter before noisy-OR (confidence.ts:154); alertLevel gates each band behind a max-severity floor (score.ts:108-116); k-suppression drops rather than coarsens below k (cells.ts:141-145). Anti-gaming rules are asserted with real differential tests, not tautologies.
- Tasks 1-4: controller resolved the reviewer's one "cannot verify from diff" item — `RenderedCell.buildingCount` has no type-level public/private split. NOT a gap: Task 14 narrows `RenderedCell` to `PublicCell` and drops the field, and its test asserts `not.toHaveProperty("buildingCount")`. `suppressCells` needs the count internally to apply the k threshold. No action; re-check when Task 14 lands.
- Task 1-4: minor (deferred): package.json test script still `echo "Error: no test specified" && exit 1`; `npm test` fails although `npx vitest run` passes.
- Task 1-4: minor (deferred): score.test.ts has no positive test proving `escalated` is reached with a genuine severity-4 hazard and sufficient score; only negative/boundary cases cover that band.
- Tasks 1-4: fix round 1/5 dispatched to original implementer (2 findings: strict typecheck, loopback binding).
- Tasks 1-4: fix round 1/5 (2 addressed, 0 open; commit f87f983). CONTROLLER VERIFIED: `tsc --noEmit` clean; 4 files/27 tests pass; docker-compose bound to 127.0.0.1; tsconfig NOT weakened (no diff); TS2532s fixed with `!` plus added length guards, so assertions are stronger, not looser.
- Ruling (postgres host port): Catastrophy's dev database moved to 127.0.0.1:55432. — Why: another of the user's projects (`rag_postgres`, pgvector:pg17) is running and holds 0.0.0.0:5432. Stopping another project's database is a side effect outside this worktree and not mine to take; changing our own host port costs nothing. Applied to docker-compose.yml, the plan, .env.example in the plan, and a gitignored .env; task-5 brief regenerated. Commit f46b8e8. — Cost if wrong: anyone expecting 5432 must read .env; the container port is unchanged.
- Env: PostgreSQL 16.4 + PostGIS running, loopback-only at 127.0.0.1:55432, verified by psql from the host. `.env` created (gitignored) with DATABASE_URL and DATABASE_URL_TEST.
- Gap found in plan (carried into Task 5 dispatch): the plan never says how Vitest loads .env, but src/db/client.ts reads process.env.DATABASE_URL_TEST. Task 5's implementer owns solving it without breaking the four domain test files that need no database.
- Tasks 1-4: scoped re-review dispatched (haiku) on review-f97313e..f87f983.diff, with an explicit anti-cheat check (tsconfig not weakened, no `any`/ts-ignore, no assertion meaning changed).
- Task 5: dispatched (sonnet) at BASE f46b8e8. Brief task-5-brief.md. Report -> task-5-report.md.
- Tasks 1-4: re-review verdict — finding 1 (strict typecheck) ADDRESSED via @types/ngeohash + non-null assertions/length guards; finding 2 (postgres binding) ADDRESSED. Anti-cheat check passed: tsconfig untouched, strict and noUncheckedIndexedAccess still true, no `any`/ts-ignore, no assertion meaning changed. New breakage: none.
- Task 1: complete (commits 967a9f9..f87f983, review clean after 1 fix round, 2 minors deferred)
- Task 2: complete (commits 967a9f9..f87f983, review clean after 1 fix round)
- Task 3: complete (commits 967a9f9..f87f983, review clean after 1 fix round, 1 minor deferred)
- Task 4: complete (commits 967a9f9..f87f983, review clean after 1 fix round, 1 minor deferred)
- Plan defect found by controller while idle (prevents a fix round at Task 14): Task 14 creates `src/app/api/heatmap/route.ts` and Task 15 creates `src/app/api/evidence/route.ts`, both importing `next/server` — but the plan does not install Next.js until Task 16. The standing `tsc --noEmit` gate would fail at Task 14 with an unresolved module.
- Ruling (next.js install moves earlier): Task 14's implementer installs `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom` and applies the P9 tsconfig change (`jsx: preserve`, `lib: ["dom","es2022"]`) as part of its own work, instead of Task 16. — Why: Task 14 is the first task that creates a file importing from `next/server`, so that is where the dependency actually begins; deferring it to Task 16 makes two intervening tasks untypecheckable. — Cost if wrong: Task 14's diff carries a dependency bump that reads as unrelated to heatmaps; Task 16's brief then installs nothing and only adds pages.
- Task 5: implementer returned DONE (commit 61d11f6). CONTROLLER VERIFIED: `tsc --noEmit` clean; 5 files/30 tests pass; `.env` NOT tracked by git; all 11 tables live in the database (area_signals, assessments, buildings, escalations, evidence, evidence_hazards, hazards, office_bearers, reporters, resolution_claims, societies); extensions postgis + pgcrypto present. pg_trgm intentionally absent — Task 6 installs it.
- Task 5: implementer notes — Drizzle's typed insert DID accept the raw sql`` geography fragment, so ruling P11's fallback was not needed and schema.ts stands as briefed. Brief's verbatim test failed noUncheckedIndexedAccess; 4 non-null assertions added, no assertion semantics changed. drizzle.config.ts was unspecified in the brief; minimal config written, unused by tests.
- Task 5: review dispatched (sonnet) on review-f46b8e8..61d11f6.diff, with domain invariants to check in the DDL (one assessment per building, immutable escalation snapshot, unique hazard per building+type, area_signals structurally unable to reference a building, spatial index present).
- Task 6: dispatched (sonnet) at BASE 61d11f6. Brief task-6-brief.md. Report -> task-6-report.md. Carried the corrected psql command (port 55432, explicit password) since the brief's `$DATABASE_URL` is unset in a fresh shell.
