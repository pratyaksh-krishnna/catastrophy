import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => vi.fn());
const functionConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("./inngest.js", () => ({
  inngest: {
    send: sent,
    createFunction: (config: Record<string, unknown>, handler: unknown) => {
      functionConfigs.push(config);
      return handler;
    },
  },
}));

import { isUrgent, requestRegeneration } from "./regenerate.js";

describe("assessment regeneration triggers", () => {
  beforeEach(() => {
    sent.mockReset();
    sent.mockResolvedValue(undefined);
  });

  it("treats a Severity-5 Hazard as urgent", () => {
    expect(isUrgent(["load_bearing_crack"])).toBe(true);
  });

  it("does not treat only minor Hazards as urgent", () => {
    expect(isUrgent(["plaster_spalling", "drainage_failure"])).toBe(false);
  });

  it("is urgent when any Hazard in a batch is Severity 5", () => {
    expect(isUrgent(["plaster_spalling", "foundation_settlement"])).toBe(true);
  });

  it("bypasses the debounce event for urgent Evidence", async () => {
    await requestRegeneration({ buildingId: "b1", hazardTypeIds: ["column_failure"] });
    expect(sent).toHaveBeenCalledWith({
      name: "assessment/regenerate.urgent",
      data: { buildingId: "b1" },
    });
  });

  it("uses the debounced event for ordinary Evidence", async () => {
    await requestRegeneration({ buildingId: "b1", hazardTypeIds: ["plaster_spalling"] });
    expect(sent).toHaveBeenCalledWith({
      name: "assessment/regenerate",
      data: { buildingId: "b1" },
    });
  });

  it("bounds how long continuous ordinary Evidence can extend the debounce", () => {
    const config = functionConfigs.find((candidate) => candidate.id === "regenerate-assessment");
    expect(config?.debounce).toEqual({
      period: "30s",
      key: "event.data.buildingId",
      timeout: "5m",
    });
  });

  it("registers a one-minute retry for durable pending dispatches", () => {
    const config = functionConfigs.find((candidate) => candidate.id === "retry-pending-assessment-regenerations");
    expect(config?.triggers).toEqual([{ cron: "*/1 * * * *" }]);
  });
});
