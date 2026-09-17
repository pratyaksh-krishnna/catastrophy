# Task 1-4 Completion Report

## Task 1: Project Scaffold and Hazard Catalogue
**Status:** PASS

**Created Files:**
- `package.json` - npm configuration with `"type": "module"` and dependencies (typescript, vitest, @types/node, ngeohash)
- `tsconfig.json` - TypeScript configuration with strict=true, module=esnext, moduleResolution=bundler, target=es2022
- `vitest.config.ts` - Vitest test runner configuration
- `docker-compose.yml` - PostgreSQL/PostGIS database definition (not started, not needed for tasks 1-4)
- `src/domain/hazard-catalogue.ts` - Hazard type definitions and closed catalogue of 25+ hazard types
- `src/domain/hazard-catalogue.test.ts` - 5 tests for the hazard catalogue

**Test Command:** `npx vitest run src/domain/hazard-catalogue.test.ts`
**Test Result:** 5 passed
**Commit SHA:** c111f41 (feat: scaffold project and add closed hazard catalogue)

**Implementation Notes:**
- Hazard catalogue is closed and immutable with 25 hazard types
- Each type has severity (1-5), authority (mcd/dda/ddma), label, and bylaw reference
- Severity is never computed—it's a literal in the catalogue per ADR-0001
- severityOf() function provides type-safe severity lookup

---

## Task 2: Confidence
**Status:** PASS

**Created Files:**
- `src/domain/confidence.ts` - Confidence calculation from independent evidence
- `src/domain/confidence.test.ts` - 8 tests for confidence computation

**Test Command:** `npx vitest run src/domain/confidence.test.ts`
**Test Result:** 8 passed
**Commit SHA:** e8c863a (feat: confidence from independent reporters, source class, corroboration and recency)

**Implementation Notes:**
- Confidence aggregates evidence from multiple reporters using noisy-OR logic
- Single reporter is capped at REPORTER_CAP (0.5) to prevent volume-based inflation
- Evidence weighted by source class (official_record 0.9 → social_post 0.2)
- Geo agreement factor applied (agree 1.1 → disagree 0.5)
- Evidence age decays with 180-day half-life
- Corroboration across source classes adds CROSS_CLASS_BONUS (0.15)
- Final confidence capped at 1.0

---

## Task 3: Score Aggregation and Alert Level
**Status:** PASS

**Created Files:**
- `src/domain/score.ts` - Building risk score and alert level calculation
- `src/domain/score.test.ts` - 8 tests for score and alert banding

**Test Command:** `npx vitest run src/domain/score.test.ts`
**Test Result:** 8 passed
**Commit SHA:** 8ce31ee (feat: score aggregation and severity-gated alert level banding)

**Implementation Notes:**
- hazardRisk() = (severity / 5) × confidence, normalised to 0-1
- buildingScore() aggregates hazards using noisy-OR (diminishing returns, never reaching 1)
- rankHazards() sorts hazards by descending risk
- alertLevel() bands the score into 4 levels: monitor/act/escalated/critical
- Alert level is severity-gated: 40 minor hazards cannot escalate to critical without a severity-5 hazard
- Score is internal and never returned from APIs (per ADR-0001)

---

## Task 4: Cells and K-Suppression
**Status:** PASS

**Created Files:**
- `src/domain/cells.ts` - Geohash cell aggregation with k-suppression privacy
- `src/domain/cells.test.ts` - 6 tests for cell rendering

**Test Command:** `npx vitest run src/domain/cells.test.ts`
**Test Result:** 6 passed
**Commit SHA:** f97313e (feat: geohash cells with k-suppression merge-upward per ADR-0002)

**Implementation Notes:**
- suppressCells() buckets reported points into geohash cells at requested precision
- K_SUPPRESSION = 5: cells render only when ≥k distinct buildings fall inside
- Sparse cells merge upward to coarser precision levels (down to MIN_PRECISION=4)
- Deduplication by buildingId ensures each building counted once
- intensity calculated via noisy-OR of member scores, normalized to 0-1
- No buildingCount leaked in public API responses (server-side only per ADR-0002)
- ngeohash library imported successfully with standard ES default import

---

## Overall Summary

| Metric | Value |
|--------|-------|
| Test Files | 4 passed |
| Total Tests | 27 passed |
| All Commits | c111f41, e8c863a, 8ce31ee, f97313e |
| TypeScript Strict | Enabled |
| ES Modules | Enabled (type: "module") |

All four tasks completed successfully. All 27 tests pass. Project follows strict TypeScript mode, uses ES module imports with `.js` extensions, and adheres to all specified constraints (severity literals, score internality, ngeohash compatibility).

---

## Fix Round 1 of 5

**Findings Addressed:**

**FINDING 1 (Critical): TypeScript Strict Mode Failures**
- Issue: `ngeohash` module had no type declarations, causing implicit `any` errors in strict mode
- Fix: Installed `@types/ngeohash` package (npm i -D @types/ngeohash)
- Issue: Tests with `noUncheckedIndexedAccess: true` required array safety checks before indexing
- Fix: Added null-safety assertions in cells.test.ts (lines 25, 38, 44, 49-50) and score.test.ts (line 15)
  - Where prior length checks existed, added `!` non-null assertion operator
  - Where no prior check existed, added explicit `.length > 0` assertion first
  - All test assertions maintained their original meaning

**FINDING 2 (Important): Docker Compose Security**
- Issue: `docker-compose.yml` ports binding: `["5432:5432"]` exposed on all interfaces
- Fix: Changed to `["127.0.0.1:5432:5432"]` for loopback-only binding (development safety)

**Verification Commands and Output:**

1. `npx tsc --noEmit`
```
(no output — compilation successful)
```

2. `npx vitest run`
```
Test Files  4 passed (4)
     Tests  27 passed (27)
```

**Fix Commit:**
- SHA: f87f983
- Message: fix: satisfy strict typecheck and bind postgres to loopback
- Changes: 5 files modified
  - src/domain/cells.test.ts: 4 array-indexing safety fixes
  - src/domain/score.test.ts: 1 array-indexing safety fix
  - docker-compose.yml: 1 security fix
  - package.json: @types/ngeohash added
  - package-lock.json: updated

**Status:** Both findings fixed, all 27 tests passing, strict TypeScript compilation clean
