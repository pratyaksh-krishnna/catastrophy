import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const configuredRegion = process.env.AWS_REGION;
const client = new BedrockRuntimeClient(configuredRegion ? { region: configuredRegion } : {});

export function modelId(): string {
  const configured = process.env.MODEL;
  if (!configured) throw new Error("MODEL is not set — the model id is never hardcoded");
  return configured;
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
 * Runs one Converse turn that must answer through the requested tool and
 * returns that tool's input document.
 */
export async function converseForTool<T>(args: {
  system: string;
  prompt: string;
  tool: ToolSpec;
}): Promise<T> {
  const response = await client.send(
    new ConverseCommand({
      modelId: modelId(),
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
      additionalModelRequestFields: { thinking: { type: "adaptive" } },
    }),
  );

  const block = response.output?.message?.content?.find(
    (content) => content.toolUse?.name === args.tool.name,
  );
  if (!block?.toolUse?.input) {
    throw new Error(`model did not call ${args.tool.name}`);
  }

  return block.toolUse.input as T;
}
