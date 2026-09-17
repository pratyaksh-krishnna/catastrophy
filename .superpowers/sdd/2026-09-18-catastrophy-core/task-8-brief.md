### Task 8: Bedrock Converse adapter

**Files:**
- Create: `src/agents/bedrock.ts`
- Test: `src/agents/bedrock.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ToolSpec`, `converseForTool<T>({ system, prompt, tool })`, `modelId()`

- [ ] **Step 1: Write the failing test**

Create `src/agents/bedrock.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { modelId } from "./bedrock.js";

describe("bedrock adapter", () => {
  beforeEach(() => { delete process.env.MODEL; });

  it("reads the model from env", () => {
    process.env.MODEL = "anthropic.claude-opus-5";
    expect(modelId()).toBe("anthropic.claude-opus-5");
  });

  it("refuses to guess a model when env is unset", () => {
    expect(() => modelId()).toThrow(/MODEL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/bedrock.test.ts`
Expected: FAIL — cannot resolve `./bedrock.js`

- [ ] **Step 3: Write the implementation**

```bash
npm i @aws-sdk/client-bedrock-runtime
```

Create `src/agents/bedrock.ts`:

```typescript
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

export function modelId(): string {
  const m = process.env.MODEL;
  if (!m) throw new Error("MODEL is not set — the model id is never hardcoded");
  return m;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Enum members here are what actually enforce a closed set. */
  inputSchema: Record<string, unknown>;
}

/**
 * Runs one Converse turn that must answer by calling `tool`, and returns the
 * tool input. Converse is provider-neutral, so the closed Hazard catalogue is
 * enforced by the schema enum plus toolChoice rather than by prompt wording.
 */
export async function converseForTool<T>(args: {
  system: string;
  prompt: string;
  tool: ToolSpec;
}): Promise<T> {
  const res = await client.send(
    new ConverseCommand({
      modelId: modelId(),
      system: [{ text: args.system }],
      messages: [{ role: "user", content: [{ text: args.prompt }] }],
      toolConfig: {
        tools: [{ toolSpec: { name: args.tool.name, description: args.tool.description, inputSchema: { json: args.tool.inputSchema } } }],
        toolChoice: { tool: { name: args.tool.name } },
      },
      additionalModelRequestFields: { thinking: { type: "adaptive" } },
    }),
  );

  const block = res.output?.message?.content?.find((c) => c.toolUse);
  if (!block?.toolUse?.input) throw new Error(`model did not call ${args.tool.name}`);
  return block.toolUse.input as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/bedrock.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents package.json
git commit -m "feat: bedrock converse adapter with model from env"
```

---

