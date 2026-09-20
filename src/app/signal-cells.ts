import ngeohash from "ngeohash";

/**
 * The shape returned by GET /api/signals (src/api/signals.ts). Kept in sync
 * with `PublicSignalCell` there — deliberately narrow: a Signal attaches to a
 * cell, never to a Building, so this carries only a count and a summary.
 */
export interface PublicSignalCell {
  geohash: string;
  precision: number;
  signalCount: number;
  /** Null when narrateCellSummary() has not yet run for this cell. */
  summary: string | null;
  sources: PublicSignalSource[];
}

export interface PublicSignalSource {
  title: string;
  url: string | null;
  media: { kind: "image" | "video"; url: string; previewUrl?: string; embedUrl?: string } | null;
}

export const SIGNAL_SUMMARY_PLACEHOLDER = "Summary not generated yet.";

export interface SignalCellProperties {
  signalCount: number;
  summary: string | null;
  sources: PublicSignalSource[];
}

export interface SignalFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: SignalCellProperties;
    geometry: {
      type: "Polygon";
      coordinates: number[][][];
    };
  }>;
}

/**
 * Converts Area Signal cells into a GeoJSON FeatureCollection of closed-ring
 * polygons, one per cell — the same geohash-bbox approach the Building heat
 * layer uses (see `featureCollection()` in public-heatmap.tsx), kept as a
 * separate, unit-testable module rather than touching that layer.
 *
 * Properties carry a small, scrubbed list of public source records alongside
 * counts and summaries. They never contain raw posts or resident data.
 */
export function signalFeatureCollection(cells: PublicSignalCell[]): SignalFeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => {
      const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(cell.geohash);
      return {
        type: "Feature" as const,
          properties: { signalCount: cell.signalCount, summary: cell.summary, sources: cell.sources },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[
            [minLon, minLat],
            [maxLon, minLat],
            [maxLon, maxLat],
            [minLon, maxLat],
            [minLon, minLat],
          ]],
        },
      };
    }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds the popup body shown when a signal cell is clicked. Renders only
 * the summary (or a neutral placeholder when one hasn't been generated yet)
 * and the signal count — never anything else about the cell.
 */
export function buildSignalPopupHtml(cell: {
  signalCount: number;
  summary: string | null;
  sources?: PublicSignalSource[];
}): string {
  const summaryText =
    cell.summary && cell.summary.trim().length > 0 ? cell.summary : SIGNAL_SUMMARY_PLACEHOLDER;
  const countLabel = cell.signalCount === 1 ? "1 report" : `${cell.signalCount} reports`;
  return (
    `<div class="signal-popup">` +
    `<p class="signal-popup-summary">${escapeHtml(summaryText)}</p>` +
    `<p class="signal-popup-count">${escapeHtml(countLabel)}</p>` +
    sourceCards(cell.sources ?? []) +
    `</div>`
  );
}

function sourceCards(sources: PublicSignalSource[]): string {
  if (sources.length === 0) return "";
  return `<section class="signal-popup-sources" aria-label="Media and social sources">` +
    `<p class="signal-popup-sources-label">Sources</p>` +
    sources.map(sourceCard).join("") +
    `</section>`;
}

function sourceCard(source: PublicSignalSource): string {
  const title = escapeHtml(source.title);
  const href = source.url ? safePopupUrl(source.url) : null;
  const media = source.media;
  const preview = media?.previewUrl ? safePopupUrl(media.previewUrl) : null;
  const image = media?.kind === "image" ? safePopupUrl(media.url) : null;
  const thumbnail = preview ?? image;
  const embed = media?.kind === "video" && media.embedUrl ? safeYoutubeEmbedUrl(media.embedUrl) : null;
  const mediaHtml = embed
    ? `<iframe class="signal-popup-video" src="${escapeHtml(embed)}" title="${title} video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
    : thumbnail
    ? `<img class="signal-popup-media" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : media?.kind === "video"
      ? `<span class="signal-popup-video-mark" aria-hidden="true">▶</span>`
      : `<span class="signal-popup-source-mark" aria-hidden="true">↗</span>`;
  const detail = media?.kind === "video" ? "Video" : source.url ? "Article" : "Demo";
  const content = `${mediaHtml}<span class="signal-popup-source-copy"><span class="signal-popup-source-title">${title}</span><span class="signal-popup-source-kind">${detail}</span></span>`;
  // A playable frame must not be nested inside the article link: clicks in
  // the player should control playback, not navigate to the publisher page.
  if (embed) {
    const copy = `<span class="signal-popup-source-copy"><span class="signal-popup-source-title">${title}</span><span class="signal-popup-source-kind">${detail}</span></span>`;
    const link = href
      ? `<a class="signal-popup-source-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${copy}</a>`
      : copy;
    return `<div class="signal-popup-source signal-popup-source--video">${mediaHtml}${link}</div>`;
  }
  return href
    ? `<a class="signal-popup-source" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${content}</a>`
    : `<div class="signal-popup-source signal-popup-source--demo">${content}</div>`;
}

function safeYoutubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.youtube-nocookie.com" &&
      /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Defense in depth: API URLs are validated, popup HTML validates again. */
function safePopupUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
