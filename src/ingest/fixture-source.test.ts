import { describe, expect, it } from "vitest";
import { fixtureSource } from "./fixture-source.js";
import type { RawItem } from "./source.js";

describe("fixtureSource", () => {
  it("loads all 14 fixtures from the default JSON file", async () => {
    const source = fixtureSource();
    const items = await source.fetchRecent();
    expect(items).toHaveLength(14);
  });

  it("returns items with non-empty sourceId and text", async () => {
    const source = fixtureSource();
    const items = await source.fetchRecent();

    for (const item of items) {
      expect(item.sourceId).toBeTruthy();
      expect(typeof item.sourceId).toBe("string");
      expect(item.sourceId.length).toBeGreaterThan(0);

      expect(item.text).toBeTruthy();
      expect(typeof item.text).toBe("string");
      expect(item.text.length).toBeGreaterThan(0);
    }
  });

  it("returns items with occurredAt as a Date instance", async () => {
    const source = fixtureSource();
    const items = await source.fetchRecent();

    for (const item of items) {
      expect(item.occurredAt).toBeInstanceOf(Date);
      expect(isNaN(item.occurredAt.getTime())).toBe(false);
    }
  });

  it("returns injected items unchanged when provided", async () => {
    const injected: RawItem[] = [
      {
        sourceId: "test-1",
        text: "Test article one",
        occurredAt: new Date("2026-01-15"),
      },
      {
        sourceId: "test-2",
        text: "Test article two",
        occurredAt: new Date("2026-02-20"),
        url: "https://example.com",
      },
    ];

    const source = fixtureSource(injected);
    const items = await source.fetchRecent();

    expect(items).toEqual(injected);
    expect(items).toHaveLength(2);
  });

  it("includes a duplicate sourceId in the output", async () => {
    const source = fixtureSource();
    const items = await source.fetchRecent();
    const sourceIds = items.map((item) => item.sourceId);

    const duplicateId = sourceIds.find(
      (id, index) => sourceIds.indexOf(id) !== index,
    );
    expect(duplicateId).toBeDefined();
  });

  it("includes entries covering the expected mix of cases", async () => {
    const source = fixtureSource();
    const items = await source.fetchRecent();

    // Count different cases
    const specificLocalities = items.filter((item) =>
      /Laxmi Nagar|Karol Bagh|Shahdara|Seelampur|Chandni Chowk/.test(
        item.text,
      ),
    );
    const districtOnly = items.filter((item) =>
      /East Delhi|South Delhi/.test(item.text),
    );
    const noDelhi = items.filter(
      (item) =>
        !/Delhi|Laxmi Nagar|Karol Bagh|Shahdara|Seelampur|Chandni Chowk|East Delhi|South Delhi/.test(
          item.text,
        ),
    );
    const irrelevant = items.filter(
      (item) =>
        /traffic jam|cricket/.test(item.text.toLowerCase()) &&
        !/building|collapse|crack|floor|water|lean|hazard|safety|structure/.test(
          item.text.toLowerCase(),
        ),
    );

    // Verify counts match the requirements
    expect(specificLocalities.length).toBeGreaterThanOrEqual(5);
    expect(districtOnly).toHaveLength(2);
    expect(noDelhi.length).toBeGreaterThanOrEqual(2);
    expect(irrelevant).toHaveLength(2);
  });

  it("converts ISO date strings from JSON into Date instances", async () => {
    const source = fixtureSource();
    const items = await source.fetchRecent();

    for (const item of items) {
      expect(item.occurredAt).toBeInstanceOf(Date);
      expect(typeof item.occurredAt.getTime).toBe("function");
    }
  });
});
