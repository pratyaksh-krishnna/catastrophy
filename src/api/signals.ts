import { sql } from "drizzle-orm";
import { db } from "../db/client";

/**
 * The deliberately narrow shape exposed to unauthenticated callers. A Signal
 * attaches to a cell, never to a Building — this carries no Building identity
 * and no post text, only what the cell reports and how much of it there is.
 */
export interface PublicSignalCell {
  geohash: string;
  precision: number;
  signalCount: number;
  /** Null when narrateCellSummary() has not yet run for this cell. */
  summary: string | null;
  /** Recent public publisher records for the cell. Never raw signal text. */
  sources: PublicSignalSource[];
}

export interface PublicSignalSource {
  title: string;
  /** Null for seeded demonstration material and invalid external URLs. */
  url: string | null;
  media: { kind: "image" | "video"; url: string; previewUrl?: string; embedUrl?: string } | null;
}

const MAX_SOURCES_PER_CELL = 8;

/**
 * Aggregates Area Signals by cell (count per geohash) and left-joins the prose
 * from cell_summaries. Source provenance is a deliberately narrow public DTO:
 * title, validated article URL, and optional safe preview metadata. It never
 * selects raw `text` or anything derived from a Building or resident upload.
 *
 * Deliberately does not apply the Building heat map's k-suppression
 * (src/domain/cells.ts): that algorithm exists to hide sparse Buildings behind
 * a minimum count, and Signals carry no Building identity to hide. Applying it
 * here would conflate two unrelated privacy layers.
 */
export async function publicSignals(): Promise<PublicSignalCell[]> {
  const rows = await db.execute(sql`
    SELECT
      a.geohash AS geohash,
      a.precision AS precision,
      COUNT(*)::int AS signal_count,
      cs.summary AS summary
    FROM area_signals a
    LEFT JOIN cell_summaries cs ON cs.geohash = a.geohash
    GROUP BY a.geohash, a.precision, cs.summary
  `);

  // Source IDs before migration were article URLs. Read them only as a legacy
  // fallback, validate them below, and never expose opaque IDs.
  const sourceRows = await db.execute(sql`
    SELECT geohash, source_url, source_id, source_title, media_url, media_kind
    FROM (
      SELECT
        geohash, source_url, source_id, source_title, media_url, media_kind,
        row_number() OVER (PARTITION BY geohash ORDER BY occurred_at DESC, created_at DESC) AS rank
      FROM area_signals
    ) ranked
    WHERE rank <= ${MAX_SOURCES_PER_CELL}
    ORDER BY geohash, rank
  `);
  const sourcesByCell = new Map<string, PublicSignalSource[]>();
  for (const row of sourceRows.rows) {
    const source = publicSource({
      sourceUrl: nullableString(row.source_url) ?? nullableString(row.source_id),
      sourceTitle: nullableString(row.source_title),
      mediaUrl: nullableString(row.media_url),
      mediaKind: nullableString(row.media_kind),
    });
    if (!source) continue;
    const geohash = row.geohash as string;
    const sources = sourcesByCell.get(geohash) ?? [];
    sources.push(source);
    sourcesByCell.set(geohash, sources);
  }

  return rows.rows.map((row) => ({
    geohash: row.geohash as string,
    precision: Number(row.precision),
    signalCount: Number(row.signal_count),
    summary: (row.summary as string | null) ?? null,
    sources: sourcesByCell.get(row.geohash as string) ?? [],
  }));
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function publicSource(input: {
  sourceUrl: string | null;
  sourceTitle: string | null;
  mediaUrl: string | null;
  mediaKind: string | null;
}): PublicSignalSource | null {
  const sourceUrl = safeHttpUrl(input.sourceUrl);
  if (!sourceUrl) return null;

  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (host === "news.example.com") {
    return { title: "Demo source", url: null, media: null };
  }

  return {
    title: publicTitle(input.sourceTitle, host),
    url: sourceUrl,
    media: publicMedia(sourceUrl, input.mediaUrl, input.mediaKind),
  };
}

function publicTitle(title: string | null, host: string): string {
  // Bound untrusted publisher input before it crosses the public boundary.
  const clean = title?.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 160) : host.replace(/^www\./, "");
}

function publicMedia(sourceUrl: string, mediaUrl: string | null, kind: string | null): PublicSignalSource["media"] {
  if (kind !== "image" && kind !== "video") return null;
  const safeMediaUrl = safeHttpsUrl(mediaUrl);
  if (!safeMediaUrl) return null;

  if (kind === "video") {
    const videoId = youTubeVideoId(safeMediaUrl);
    return videoId
      ? {
          kind,
          url: safeMediaUrl,
          previewUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          // Only YouTube uses an embed; all other videos remain outbound links.
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
        }
      : { kind, url: safeMediaUrl };
  }
  // Images are passive HTTPS assets and use no-referrer rendering in the
  // popup. Video embeds are intentionally limited to the trusted host above.
  return { kind, url: safeMediaUrl };
}

function safeHttpUrl(value: string | null): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "" && isPublicHostname(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1") return false;
  if (/^127\./.test(host) || /^0\./.test(host) || /^169\.254\./.test(host) || /^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  const match = /^172\.(\d+)\./.exec(host);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
  // IPv6 loopback, unspecified, unique-local and link-local ranges.
  return !/^(?:fc|fd|fe8|fe9|fea|feb)/i.test(host);
}

function safeHttpsUrl(value: string | null): string | null {
  const url = safeHttpUrl(value);
  return url?.startsWith("https://") ? url : null;
}

function youTubeVideoId(urlString: string): string | undefined {
  const url = new URL(urlString);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const videoId = host === "youtu.be" ? url.pathname.slice(1) : host === "youtube.com" ? url.searchParams.get("v") : null;
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : undefined;
}
