import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const configuredRegion = process.env.AWS_REGION;
const client = new BedrockRuntimeClient(configuredRegion ? { region: configuredRegion } : {});

export function modelId(): string {
  const configured = process.env.MODEL;
  if (!configured) throw new Error("MODEL is not set — the model id is never hardcoded");
  return configured;
}

/** Adaptive thinking is an Anthropic field; other Bedrock providers reject it. */
function isAnthropic(model: string): boolean {
  return /(^|\.)anthropic\./.test(model);
}

export type JsonDocument =
  | null
  | boolean
  | number
  | string
  | JsonDocument[]
  | { [key: string]: JsonDocument };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema; enum members here enforce closed domain sets at runtime. */
  inputSchema: { [key: string]: JsonDocument };
}

/**
 * Not every model honours a forced toolChoice on every turn; some answer in
 * prose instead. One retry costs a second call and saves the whole turn.
 */
export const TOOL_CALL_ATTEMPTS = 3;

/**
 * Runs one Converse turn that must answer through the requested tool and
 * returns that tool's input document.
 */
export async function converseForTool<T>(args: {
  system: string;
  prompt: string;
  tool: ToolSpec;
}): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < TOOL_CALL_ATTEMPTS; attempt += 1) {
    try {
      return await converseOnce<T>(args);
    } catch (error) {
      // Only a skipped tool call is worth repeating. Transport, throttling and
      // validation failures are the caller's to handle.
      if (!(error instanceof SkippedToolCallError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Raised when the model answered without calling the forced tool. */
class SkippedToolCallError extends Error {}

async function converseOnce<T>(args: {
  system: string;
  prompt: string;
  tool: ToolSpec;
}): Promise<T> {
  const model = modelId();
  const response = await client.send(
    new ConverseCommand({
      modelId: model,
      system: [{ text: args.system }],
      messages: [{ role: "user", content: [{ text: args.prompt }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: args.tool.name,
              description: args.tool.description,
              inputSchema: { json: args.tool.inputSchema },
            },
          },
        ],
        toolChoice: { tool: { name: args.tool.name } },
      },
      additionalModelRequestFields: isAnthropic(model)
        ? { thinking: { type: "adaptive" } }
        : undefined,
    }),
  );

  const block = response.output?.message?.content?.find(
    (content) => content.toolUse?.name === args.tool.name,
  );
  if (!block?.toolUse?.input) {
    throw new SkippedToolCallError(`model did not call ${args.tool.name}`);
  }

  return block.toolUse.input as T;
}
