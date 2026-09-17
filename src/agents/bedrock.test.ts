import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  send: vi.fn(async (_command: unknown): Promise<unknown> => ({})),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = sdk.send;
  },
  ConverseCommand: class {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import { converseForTool, modelId, type ToolSpec } from "./bedrock.js";

const tool: ToolSpec = {
  name: "record_result",
  description: "Return a structured result",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

describe("bedrock adapter", () => {
  beforeEach(() => {
    delete process.env.MODEL;
    sdk.send.mockReset();
  });

  it("reads the model from env", () => {
    process.env.MODEL = "anthropic.claude-opus-5";
    expect(modelId()).toBe("anthropic.claude-opus-5");
  });

  it("refuses to guess a model when env is unset", () => {
    expect(() => modelId()).toThrow(/MODEL/);
  });

  it("refuses an empty model id", () => {
    process.env.MODEL = "";
    expect(() => modelId()).toThrow(/MODEL/);
  });

  it("forces the requested tool and returns its input", async () => {
    process.env.MODEL = "test-model";
    sdk.send.mockResolvedValueOnce({
      output: {
        message: {
          content: [
            {
              toolUse: {
                name: tool.name,
                toolUseId: "tool-1",
                input: { value: "ok" },
              },
            },
          ],
        },
      },
    });

    await expect(
      converseForTool<{ value: string }>({ system: "system", prompt: "prompt", tool }),
    ).resolves.toEqual({ value: "ok" });

    const command = sdk.send.mock.calls[0]![0] as {
      input: {
        modelId: string;
        toolConfig: {
          tools: Array<{ toolSpec: { name: string; inputSchema: { json: unknown } } }>;
          toolChoice: { tool: { name: string } };
        };
      };
    };
    expect(command.input.modelId).toBe("test-model");
    expect(command.input.toolConfig.tools[0]!.toolSpec).toMatchObject({
      name: tool.name,
      inputSchema: { json: tool.inputSchema },
    });
    expect(command.input.toolConfig.toolChoice).toEqual({ tool: { name: tool.name } });
  });

  it("rejects a tool call with a different name", async () => {
    process.env.MODEL = "test-model";
    sdk.send.mockResolvedValueOnce({
      output: {
        message: {
          content: [
            {
              toolUse: {
                name: "unexpected_tool",
                toolUseId: "tool-1",
                input: { value: "not accepted" },
              },
            },
          ],
        },
      },
    });

    await expect(
      converseForTool({ system: "system", prompt: "prompt", tool }),
    ).rejects.toThrow(/did not call record_result/);
  });

  it("rejects a response without tool input", async () => {
    process.env.MODEL = "test-model";
    sdk.send.mockResolvedValueOnce({
      output: { message: { content: [{ text: "plain text is not accepted" }] } },
    });

    await expect(
      converseForTool({ system: "system", prompt: "prompt", tool }),
    ).rejects.toThrow(/did not call record_result/);
  });
});
