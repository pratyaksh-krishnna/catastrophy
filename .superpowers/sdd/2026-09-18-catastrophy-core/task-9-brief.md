### Task 9: Classifier

**Files:**
- Create: `src/agents/classifier.ts`
- Test: `src/agents/classifier.test.ts`

**Interfaces:**
- Consumes: `HAZARD_TYPE_IDS` (Task 1), `converseForTool` (Task 8)
- Produces: `ClassificationResult`, `classifierTool()`, `classifyEvidence({ note, sourceClass })`

- [ ] **Step 1: Write the failing test**

Create `src/agents/classifier.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HAZARD_TYPE_IDS } from "../domain/hazard-catalogue.js";
import { classifierTool, classifyEvidence } from "./classifier.js";

vi.mock("./bedrock.js", () => ({
  converseForTool: vi.fn(async () => ({ hazardTypeIds: ["load_bearing_crack"], rationale: "diagonal crack" })),
  modelId: () => "test-model",
}));

describe("classifier", () => {
  it("constrains the model to the closed catalogue via a schema enum", () => {
    const tool = classifierTool();
    const schema = tool.inputSchema as any;
    const members: string[] = schema.properties.hazardTypeIds.items.enum;
    expect(members.sort()).toEqual([...HAZARD_TYPE_IDS].sort());
  });

  it("requires the hazard list and forbids extra properties", () => {
    const schema = classifierTool().inputSchema as any;
    expect(schema.required).toContain("hazardTypeIds");
    expect(schema.additionalProperties).toBe(false);
  });

  it("returns the classified hazard types", async () => {
    const r = await classifyEvidence({ note: "long diagonal crack on the stair wall", sourceClass: "resident_photo" });
    expect(r.hazardTypeIds).toEqual(["load_bearing_crack"]);
  });

  it("drops anything outside the catalogue the model somehow returns", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      hazardTypeIds: ["load_bearing_crack", "wall_is_wobbly"],
      rationale: "x",
    } as never);
    const r = await classifyEvidence({ note: "x", sourceClass: "resident_photo" });
    expect(r.hazardTypeIds).toEqual(["load_bearing_crack"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/classifier.test.ts`
Expected: FAIL — cannot resolve `./classifier.js`

- [ ] **Step 3: Write the implementation**

Create `src/agents/classifier.ts`:

```typescript
import { HAZARD_CATALOGUE, HAZARD_TYPE_IDS, type HazardTypeId } from "../domain/hazard-catalogue.js";
import type { SourceClass } from "../domain/confidence.js";
import { converseForTool, type ToolSpec } from "./bedrock.js";

export interface ClassificationResult {
  hazardTypeIds: HazardTypeId[];
  rationale: string;
}

const SYSTEM = `You classify evidence about building safety in Delhi into a fixed catalogue of hazard types.
Choose only types genuinely supported by the evidence. Choose "other" when nothing fits — never force a match.
Never assess how severe a hazard is; severity is fixed by the catalogue and is not yours to judge.`;

export function classifierTool(): ToolSpec {
  const catalogue = HAZARD_TYPE_IDS.map((id) => `${id}: ${HAZARD_CATALOGUE[id].label}`).join("\n");
  return {
    name: "record_hazards",
    description: `Record which hazard types this evidence supports.\n\nCatalogue:\n${catalogue}`,
    inputSchema: {
      type: "object",
      properties: {
        hazardTypeIds: {
          type: "array",
          items: { type: "string", enum: [...HAZARD_TYPE_IDS] },
          description: "Hazard types this evidence supports. Empty if none.",
        },
        rationale: { type: "string", description: "One sentence on what in the evidence supports this." },
      },
      required: ["hazardTypeIds", "rationale"],
      additionalProperties: false,
    },
  };
}

export async function classifyEvidence(input: {
  note: string;
  sourceClass: SourceClass;
}): Promise<ClassificationResult> {
  const raw = await converseForTool<ClassificationResult>({
    system: SYSTEM,
    prompt: `Source class: ${input.sourceClass}\n\nEvidence:\n${input.note}`,
    tool: classifierTool(),
  });

  // Belt and braces: the enum constrains the model, this constrains the data.
  const valid = new Set<string>(HAZARD_TYPE_IDS);
  return {
    hazardTypeIds: (raw.hazardTypeIds ?? []).filter((id): id is HazardTypeId => valid.has(id)),
    rationale: raw.rationale ?? "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/classifier.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/classifier.ts src/agents/classifier.test.ts
git commit -m "feat: enum-enforced classifier over the closed hazard catalogue"
```

---
