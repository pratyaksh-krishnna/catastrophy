import type { ContentSource, RawItem } from "./source";

const SEARCH_ENDPOINT = "https://api.firecrawl.dev/v2/search";

/** Fixed queries: the pipeline discovers pages, it does not follow a site list. */
export const FIRECRAWL_QUERIES = [
  "Delhi building collapse structural safety",
  "Delhi illegal construction unsafe building residents",
  "Delhi building cracks seepage structural damage",
];

export const RESULTS_PER_QUERY = 10;

interface SearchResult {
  url?: unknown;
  title?: unknown;
  description?: unknown;
  date?: unknown;
  image?: unknown;
  imageUrl?: unknown;
  video?: unknown;
  videoUrl?: unknown;
}

/**
 * Live discovery through Firecrawl search. Results are not filtered by domain:
 * relevance is the Extractor's judgement and the locality enum drops the rest.
 */
export function firecrawlSource(options?: { queries?: string[]; limit?: number }): ContentSource {
  const queries = options?.queries ?? FIRECRAWL_QUERIES;
  const limit = options?.limit ?? RESULTS_PER_QUERY;

  return {
    async fetchRecent(): Promise<RawItem[]> {
      const key = process.env.FIRECRAWL_API_KEY;
      if (!key) throw new Error("FIRECRAWL_API_KEY is not set");

      // One item per url: the same story surfaces under several queries, and the
      // pipeline's dedupe only covers urls already stored from an earlier run.
      const items = new Map<string, RawItem>();
      for (const query of queries) {
        for (const result of await search(query, limit, key)) {
          const item = toRawItem(result);
          if (item && !items.has(item.sourceId)) items.set(item.sourceId, item);
        }
      }
      return [...items.values()];
    },
  };
}

async function search(query: string, limit: number, key: string): Promise<SearchResult[]> {
  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });

  if (!response.ok) {
    throw new Error(`firecrawl search failed with ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as { data?: { web?: unknown } };
  return Array.isArray(body.data?.web) ? (body.data.web as SearchResult[]) : [];
}

function toRawItem(result: SearchResult): RawItem | null {
  const url = typeof result.url === "string" ? result.url.trim() : "";
  const title = typeof result.title === "string" ? result.title.trim() : "";
  const description = typeof result.description === "string" ? result.description.trim() : "";
  const text = [title, description].filter(Boolean).join("\n\n");
  if (!url || !text) return null;

  const media = publicMedia(result);
  return {
    sourceId: url,
    url,
    text,
    occurredAt: publishedAt(result.date),
    ...(title ? { title } : {}),
    ...(media ? { media } : {}),
  };
}

/** Firecrawl search fields vary by provider; preserve a single public asset when present. */
function publicMedia(result: SearchResult): RawItem["media"] {
  const video = stringField(result.videoUrl) ?? stringField(result.video);
  if (video) return { kind: "video", url: video };
  const image = stringField(result.imageUrl) ?? stringField(result.image);
  return image ? { kind: "image", url: image } : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Search results are not reliably dated; discovery time is the honest fallback. */
function publishedAt(value: unknown): Date {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
