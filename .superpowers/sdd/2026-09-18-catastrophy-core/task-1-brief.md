### Task 1: Project scaffold and the Hazard catalogue

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `docker-compose.yml`
- Create: `src/domain/hazard-catalogue.ts`
- Test: `src/domain/hazard-catalogue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `HazardTypeId`, `Severity`, `AuthorityId`, `HazardType`, `HAZARD_CATALOGUE`, `HAZARD_TYPE_IDS`, `severityOf(id)`

- [ ] **Step 1: Scaffold the project**

```bash
npm init -y
npm pkg set type=module
npm i -D typescript vitest @types/node
npm i ngeohash
npx tsc --init --strict --module esnext --moduleResolution bundler --target es2022
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Create `docker-compose.yml` (used from Task 5 onward):

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_PASSWORD: catastrophy
      POSTGRES_DB: catastrophy
    ports: ["5432:5432"]
```

- [ ] **Step 2: Write the failing test**

Create `src/domain/hazard-catalogue.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { HAZARD_CATALOGUE, HAZARD_TYPE_IDS, severityOf } from "./hazard-catalogue.js";

describe("hazard catalogue", () => {
  it("is closed and non-empty", () => {
    expect(HAZARD_TYPE_IDS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(HAZARD_TYPE_IDS).size).toBe(HAZARD_TYPE_IDS.length);
  });

  it("gives every type a severity in 1..5 and an authority", () => {
    for (const id of HAZARD_TYPE_IDS) {
      const t = HAZARD_CATALOGUE[id];
      expect(t.severity).toBeGreaterThanOrEqual(1);
      expect(t.severity).toBeLessThanOrEqual(5);
      expect(["mcd", "dda", "ddma"]).toContain(t.authority);
    }
  });

  it("carries the `other` escape hatch at the lowest severity", () => {
    expect(HAZARD_CATALOGUE.other.severity).toBe(1);
  });

  it("routes unauthorised construction to DDA", () => {
    expect(HAZARD_CATALOGUE.unauthorised_storey.authority).toBe("dda");
  });

  it("exposes severity by id", () => {
    expect(severityOf("load_bearing_crack")).toBe(5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/domain/hazard-catalogue.test.ts`
Expected: FAIL — cannot resolve `./hazard-catalogue.js`

- [ ] **Step 4: Write the catalogue**

Create `src/domain/hazard-catalogue.ts`:

```typescript
export type Severity = 1 | 2 | 3 | 4 | 5;
export type AuthorityId = "mcd" | "dda" | "ddma";

export interface HazardType {
  readonly id: HazardTypeId;
  readonly label: string;
  /** Harm if real. Grounded in UBBL 2016. Never computed — see ADR-0001. */
  readonly severity: Severity;
  readonly authority: AuthorityId;
  readonly byelawRef: string | null;
}

const RAW = {
  load_bearing_crack:        ["Cracking in a load-bearing wall", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  foundation_settlement:     ["Foundation settlement or tilt", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  column_failure:            ["Column spalling or failure", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  illegal_basement_excavation: ["Unauthorised basement excavation", 5, "dda", "UBBL 2016 cl. 3.3"],
  slab_deflection:           ["Visible slab deflection", 4, "mcd",  "UBBL 2016 cl. 1.6"],
  unauthorised_storey:       ["Unauthorised additional storey", 4, "dda",  "UBBL 2016 cl. 3.3"],
  cantilever_overload:       ["Overloaded cantilever projection", 4, "dda",  "UBBL 2016 cl. 3.8"],
  rebar_corrosion:           ["Exposed or corroding reinforcement", 4, "mcd",  "UBBL 2016 cl. 1.6"],
  adjacent_excavation:       ["Excavation undermining an adjacent plot", 4, "dda", "UBBL 2016 cl. 3.3"],
  balcony_detachment:        ["Balcony separating from the structure", 4, "mcd",  null],
  facade_detachment:         ["Facade or cladding detaching", 4, "mcd",  null],
  fire_egress_blocked:       ["Blocked or absent means of egress", 4, "mcd",  "UBBL 2016 cl. 4.0"],
  water_seepage_structural:  ["Seepage reaching structural members", 3, "mcd",  null],
  staircase_damage:          ["Damaged or unsupported staircase", 3, "mcd",  null],
  boundary_wall_lean:        ["Leaning boundary or parapet wall", 3, "mcd",  null],
  electrical_hazard:         ["Exposed or overloaded electrical work", 3, "mcd",  null],
  lift_shaft_damage:         ["Lift shaft structural damage", 3, "mcd",  null],
  roof_damage:               ["Roof structural damage", 3, "mcd",  null],
  gas_pipeline_proximity:    ["Gas line routed unsafely", 3, "mcd",  null],
  overloaded_water_tank:     ["Overloaded rooftop water tank", 3, "mcd",  null],
  sewage_undermining:        ["Sewage or drainage undermining foundations", 3, "mcd", null],
  drainage_failure:          ["Drainage failure causing standing water", 2, "mcd",  null],
  plaster_spalling:          ["Plaster spalling without exposed rebar", 2, "mcd",  null],
  seismic_retrofit_absent:   ["No seismic retrofit on a pre-code structure", 2, "mcd", "UBBL 2016 cl. 1.6"],
  other:                     ["Uncategorised — pending review", 1, "mcd",  null],
} as const satisfies Record<string, readonly [string, Severity, AuthorityId, string | null]>;

export type HazardTypeId = keyof typeof RAW;

export const HAZARD_CATALOGUE: Record<HazardTypeId, HazardType> = Object.fromEntries(
  Object.entries(RAW).map(([id, [label, severity, authority, byelawRef]]) => [
    id,
    { id: id as HazardTypeId, label, severity, authority, byelawRef },
  ]),
) as Record<HazardTypeId, HazardType>;

export const HAZARD_TYPE_IDS = Object.keys(RAW) as HazardTypeId[];

export function severityOf(id: HazardTypeId): Severity {
  return HAZARD_CATALOGUE[id].severity;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/domain/hazard-catalogue.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git init && git add -A
git commit -m "feat: scaffold project and add closed hazard catalogue"
```

---

