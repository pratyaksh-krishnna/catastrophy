### Task 11: Debounced regeneration with a severity bypass

**Files:**
- Create: `src/pipeline/inngest.ts`, `src/pipeline/regenerate.ts`
- Test: `src/pipeline/regenerate.test.ts`

**Interfaces:**
- Consumes: `severityOf` (Task 1), `buildAssessment`/`replaceAssessment` (Task 10)
- Produces: `inngest`, `REGENERATE_DEBOUNCE`, `isUrgent(typeIds)`, `regenerateAssessment` (Inngest function), `requestRegeneration({ buildingId, hazardTypeIds })`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/regenerate.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { isUrgent, requestRegeneration } from "./regenerate.js";

const sent: Array<{ name: string; data: unknown }> = [];
vi.mock("./inngest.js", () => ({
  inngest: {
    send: vi.fn(async (e: { name: string; data: unknown }) => { sent.push(e); }),
    createFunction: (_c: unknown, _t: unknown, h: unknown) => h,
  },
}));

describe("regeneration triggers", () => {
  it("treats a severity-5 hazard as urgent", () => {
    expect(isUrgent(["load_bearing_crack"])).toBe(true);
  });

  it("does not treat minor hazards as urgent", () => {
    expect(isUrgent(["plaster_spalling", "drainage_failure"])).toBe(false);
  });

  it("is urgent if any one hazard in the batch is severity 5", () => {
    expect(isUrgent(["plaster_spalling", "foundation_settlement"])).toBe(true);
  });

  it("routes urgent evidence to the immediate event, bypassing the debounce", async () => {
    sent.length = 0;
    await requestRegeneration({ buildingId: "b1", hazardTypeIds: ["column_failure"] });
    expect(sent[0].name).toBe("assessment/regenerate.urgent");
  });

  it("routes ordinary evidence to the debounced event", async () => {
    sent.length = 0;
    await requestRegeneration({ buildingId: "b1", hazardTypeIds: ["plaster_spalling"] });
    expect(sent[0].name).toBe("assessment/regenerate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/regenerate.test.ts`
Expected: FAIL — cannot resolve `./regenerate.js`

- [ ] **Step 3: Write the implementation**

```bash
npm i inngest
```

Create `src/pipeline/inngest.ts`:

```typescript
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "catastrophy" });
```

Create `src/pipeline/regenerate.ts`:

```typescript
import { severityOf, type HazardTypeId } from "../domain/hazard-catalogue.js";
import { buildAssessment, replaceAssessment } from "../db/assessments.js";
import { inngest } from "./inngest.js";

/**
 * Ordinary evidence coalesces, so a burst of reports costs one regeneration.
 * A photo of a building about to come down must not wait for that window.
 */
export const REGENERATE_DEBOUNCE = "30s";
const URGENT_SEVERITY = 5;

export function isUrgent(hazardTypeIds: HazardTypeId[]): boolean {
  return hazardTypeIds.some((id) => severityOf(id) >= URGENT_SEVERITY);
}

export async function requestRegeneration(input: {
  buildingId: string;
  hazardTypeIds: HazardTypeId[];
}): Promise<void> {
  await inngest.send({
    name: isUrgent(input.hazardTypeIds) ? "assessment/regenerate.urgent" : "assessment/regenerate",
    data: { buildingId: input.buildingId },
  });
}

async function run({ event }: { event: { data: { buildingId: string } } }) {
  const record = await buildAssessment(event.data.buildingId, new Date());
  await replaceAssessment(record);
  return { buildingId: record.buildingId, alertLevel: record.alertLevel };
}

export const regenerateAssessment = inngest.createFunction(
  { id: "regenerate-assessment", debounce: { period: REGENERATE_DEBOUNCE, key: "event.data.buildingId" } },
  { event: "assessment/regenerate" },
  run,
);

export const regenerateAssessmentUrgent = inngest.createFunction(
  { id: "regenerate-assessment-urgent" },
  { event: "assessment/regenerate.urgent" },
  run,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/regenerate.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline package.json
git commit -m "feat: debounced assessment regeneration with severity-5 bypass"
```

---

