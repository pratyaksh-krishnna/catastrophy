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

import { converseForTool, modelId, TOOL_CALL_ATTEMPTS, type ToolSpec } from "./bedrock.js";

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

  it.each([
    ["global.anthropic.claude-sonnet-4-6", { thinking: { type: "adaptive" } }],
    ["anthropic.claude-opus-5", { thinking: { type: "adaptive" } }],
    ["openai.gpt-oss-120b-1:0", undefined],
  ])("sends adaptive thinking only to Anthropic models (%s)", async (model, expected) => {
    process.env.MODEL = model;
    sdk.send.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ toolUse: { name: tool.name, toolUseId: "tool-1", input: { value: "ok" } } }],
        },
      },
    });

    await converseForTool({ system: "system", prompt: "prompt", tool });

    const command = sdk.send.mock.calls[0]![0] as {
      input: { additionalModelRequestFields?: unknown };
    };
    expect(command.input.additionalModelRequestFields).toEqual(expected);
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

  it("retries when the model answers without calling the tool", async () => {
    process.env.MODEL = "test-model";
    sdk.send.mockResolvedValueOnce({
      output: { message: { content: [{ text: "prose instead of a tool call" }] } },
    });
    sdk.send.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ toolUse: { name: tool.name, toolUseId: "tool-1", input: { value: "ok" } } }],
        },
      },
    });

    await expect(
      converseForTool<{ value: string }>({ system: "system", prompt: "prompt", tool }),
    ).resolves.toEqual({ value: "ok" });
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt limit", async () => {
    process.env.MODEL = "test-model";
    sdk.send.mockResolvedValue({
      output: { message: { content: [{ text: "prose every time" }] } },
    });

    await expect(
      converseForTool({ system: "system", prompt: "prompt", tool }),
    ).rejects.toThrow(/did not call record_result/);
    expect(sdk.send).toHaveBeenCalledTimes(TOOL_CALL_ATTEMPTS);
  });

  it("does not retry a transport failure", async () => {
    process.env.MODEL = "test-model";
    sdk.send.mockRejectedValueOnce(new Error("ThrottlingException"));

    await expect(
      converseForTool({ system: "system", prompt: "prompt", tool }),
    ).rejects.toThrow(/ThrottlingException/);
    expect(sdk.send).toHaveBeenCalledTimes(1);
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
