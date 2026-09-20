/**
 * Content source interface for the ingestion pipeline.
 * Implementations fetch raw items (articles, social posts) to be extracted as Area Signals.
 */

export interface RawItem {
  sourceId: string;      // Stable dedupe key, e.g. the article URL
  text: string;          // Headline + body, or post text
  occurredAt: Date;      // When it was published
  url?: string;          // Optional: external URL
  /** Public-facing publisher/article title, separate from the extracted text. */
  title?: string;
  /** A public preview asset advertised by the publisher. */
  media?: { url: string; kind: "image" | "video" };
}

export interface ContentSource {
  /**
   * Fetch recent raw items.
   * Returns all available items; the pipeline handles deduplication by sourceId.
   * Duplicate sourceId values are allowed in raw output.
   */
  fetchRecent(): Promise<RawItem[]>;
}
