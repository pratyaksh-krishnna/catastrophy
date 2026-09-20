import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRECRAWL_QUERIES, firecrawlSource, RESULTS_PER_QUERY } from "./firecrawl-source";

function searchResponse(results: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data: { web: results } }) };
}

describe("firecrawl source", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("refuses to run without an api key", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(firecrawlSource().fetchRecent()).rejects.toThrow(/FIRECRAWL_API_KEY/);
  });

  it("maps a search result onto a RawItem", async () => {
    const fetchMock = vi.fn(async () =>
      searchResponse([
        {
          url: "https://example.test/collapse",
          title: "Building collapses in Laxmi Nagar",
          description: "Residents reported cracks before the collapse.",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const items = await firecrawlSource({ queries: ["one query"] }).fetchRecent();

    expect(items).toHaveLength(1);
    expect(items[0]!.sourceId).toBe("https://example.test/collapse");
    expect(items[0]!.url).toBe("https://example.test/collapse");
    expect(items[0]!.text).toContain("Building collapses in Laxmi Nagar");
    expect(items[0]!.text).toContain("Residents reported cracks");
    expect(items[0]!.occurredAt).toBeInstanceOf(Date);
  });

  it("sends the key and the per-query limit to the search endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => searchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await firecrawlSource({ queries: ["delhi building"], limit: 4 }).fetchRecent();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v2/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fc-test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "delhi building", limit: 4 });
  });

  it("queries every configured query by default", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => searchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await firecrawlSource().fetchRecent();

    expect(fetchMock).toHaveBeenCalledTimes(FIRECRAWL_QUERIES.length);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.limit).toBe(RESULTS_PER_QUERY);
  });

  it("uses a published date when the result carries one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        searchResponse([
          {
            url: "https://example.test/dated",
            title: "Dated report",
            description: "Body",
            date: "2026-04-05T10:00:00.000Z",
          },
        ]),
      ),
    );

    const [item] = await firecrawlSource({ queries: ["q"] }).fetchRecent();

    expect(item!.occurredAt.toISOString()).toBe("2026-04-05T10:00:00.000Z");
  });

  it("preserves publisher title and public image or video metadata when supplied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([
        {
          url: "https://example.test/video",
          title: "Published clip",
          description: "Body",
          videoUrl: "https://www.youtube.com/watch?v=VomC2wEvLiA",
        },
        {
          url: "https://example.test/photo",
          title: "Photo story",
          description: "Body",
          imageUrl: "https://cdn.example.test/photo.jpg",
        },
      ])),
    );

    const items = await firecrawlSource({ queries: ["q"] }).fetchRecent();
    expect(items[0]).toMatchObject({
      title: "Published clip",
      media: { kind: "video", url: "https://www.youtube.com/watch?v=VomC2wEvLiA" },
    });
    expect(items[1]).toMatchObject({
      media: { kind: "image", url: "https://cdn.example.test/photo.jpg" },
    });
  });

  it("drops results that carry no url or no text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        searchResponse([
          { title: "No url here", description: "Body" },
          { url: "https://example.test/empty", title: "   ", description: "" },
          { url: "https://example.test/good", title: "Kept", description: "Body" },
        ]),
      ),
    );

    const items = await firecrawlSource({ queries: ["q"] }).fetchRecent();

    expect(items.map((item) => item.sourceId)).toEqual(["https://example.test/good"]);
  });

  it("returns one item when two queries surface the same url", async () => {
    const result = {
      url: "https://example.test/same",
      title: "Same story",
      description: "Body",
    };
    vi.stubGlobal("fetch", vi.fn(async () => searchResponse([result])));

    const items = await firecrawlSource({ queries: ["first", "second"] }).fetchRecent();

    expect(items).toHaveLength(1);
  });

  it("throws when the api rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 402, text: async () => "payment required" })),
    );

    await expect(firecrawlSource({ queries: ["q"] }).fetchRecent()).rejects.toThrow(/402/);
  });
});
