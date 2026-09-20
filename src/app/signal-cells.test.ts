import { describe, it, expect } from "vitest";
import ngeohash from "ngeohash";
import {
  signalFeatureCollection,
  buildSignalPopupHtml,
  SIGNAL_SUMMARY_PLACEHOLDER,
  type PublicSignalCell,
} from "./signal-cells.js";

describe("signalFeatureCollection", () => {
  it("returns an empty FeatureCollection for an empty cell list", () => {
    const result = signalFeatureCollection([]);
    expect(result).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("converts a cell into a closed-ring polygon matching its geohash bbox", () => {
    const cell: PublicSignalCell = {
      geohash: "ttnfv2j",
      precision: 7,
      signalCount: 3,
      summary: "Residents report waterlogging near the market.",
      sources: [],
    };
    const result = signalFeatureCollection([cell]);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);

    const feature = result.features[0]!;
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Polygon");

    const ring = feature.geometry.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);

    const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(cell.geohash);
    expect(ring).toEqual([
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ]);

    for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThanOrEqual(minLon);
      expect(lon).toBeLessThanOrEqual(maxLon);
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
    }
  });

  it("carries signalCount and summary through to feature properties, and nothing else", () => {
    const cell: PublicSignalCell = {
      geohash: "ttnfv2j",
      precision: 7,
      signalCount: 5,
      summary: "A summary.",
      sources: [],
    };
    const result = signalFeatureCollection([cell]);
    expect(result.features[0]!.properties).toEqual({ signalCount: 5, summary: "A summary.", sources: [] });
  });

  it("carries a null summary through unchanged (placeholder is a display concern)", () => {
    const cell: PublicSignalCell = {
      geohash: "ttnfv2j",
      precision: 7,
      signalCount: 1,
      summary: null,
      sources: [],
    };
    const result = signalFeatureCollection([cell]);
    expect(result.features[0]!.properties).toEqual({ signalCount: 1, summary: null, sources: [] });
  });

  it("handles multiple cells independently", () => {
    const cells: PublicSignalCell[] = [
      { geohash: "ttnfv2j", precision: 7, signalCount: 2, summary: "First.", sources: [] },
      { geohash: "ttnfv31", precision: 7, signalCount: 4, summary: null, sources: [] },
    ];
    const result = signalFeatureCollection(cells);
    expect(result.features).toHaveLength(2);
    expect(result.features.map((f) => f.properties.signalCount)).toEqual([2, 4]);
  });
});

describe("buildSignalPopupHtml", () => {
  it("renders the summary and a pluralised report count", () => {
    const html = buildSignalPopupHtml({ signalCount: 3, summary: "Reports of a cracked wall." });
    expect(html).toContain("Reports of a cracked wall.");
    expect(html).toContain("3 reports");
  });

  it("uses singular phrasing for a single report", () => {
    const html = buildSignalPopupHtml({ signalCount: 1, summary: "One report only." });
    expect(html).toContain("1 report");
    expect(html).not.toContain("1 reports");
  });

  it("falls back to the placeholder text when summary is null", () => {
    const html = buildSignalPopupHtml({ signalCount: 2, summary: null });
    expect(html).toContain(SIGNAL_SUMMARY_PLACEHOLDER);
  });

  it("falls back to the placeholder text when summary is blank", () => {
    const html = buildSignalPopupHtml({ signalCount: 2, summary: "   " });
    expect(html).toContain(SIGNAL_SUMMARY_PLACEHOLDER);
  });

  it("escapes HTML in the summary to avoid injecting markup from scraped content", () => {
    const html = buildSignalPopupHtml({ signalCount: 1, summary: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never renders anything beyond the summary and the count", () => {
    const html = buildSignalPopupHtml({ signalCount: 4, summary: "Just the summary." });
    // Only the two expected fragments should appear as text content.
    expect(html).toBe(
      '<div class="signal-popup">' +
        '<p class="signal-popup-summary">Just the summary.</p>' +
        '<p class="signal-popup-count">4 reports</p>' +
        "</div>",
    );
  });

  it("renders an escaped source card with an image preview", () => {
    const html = buildSignalPopupHtml({
      signalCount: 1,
      summary: "One report.",
      sources: [{
        title: "Publisher <unsafe>",
        url: "https://news.example.test/story",
        media: { kind: "image", url: "https://news.example.test/preview.jpg" },
      }],
    });
    expect(html).toContain("Sources");
    expect(html).toContain("Publisher &lt;unsafe&gt;");
    expect(html).toContain('src="https://news.example.test/preview.jpg"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("shows video as an outbound card and rejects unsafe URLs in popup HTML", () => {
    const html = buildSignalPopupHtml({
      signalCount: 1,
      summary: "One report.",
      sources: [{
        title: "Clip",
        url: "javascript:alert(1)",
        media: { kind: "video", url: "https://youtube.com/watch?v=abc", previewUrl: "javascript:alert(2)" },
      }],
    });
    expect(html).toContain("Video");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<iframe");
  });

  it("keeps a playable YouTube frame outside its publisher link", () => {
    const html = buildSignalPopupHtml({
      signalCount: 1,
      summary: "One report.",
      sources: [{
        title: "Clip",
        url: "https://www.youtube.com/watch?v=VomC2wEvLiA",
        media: {
          kind: "video",
          url: "https://www.youtube.com/watch?v=VomC2wEvLiA",
          embedUrl: "https://www.youtube-nocookie.com/embed/VomC2wEvLiA?rel=0",
        },
      }],
    });
    expect(html).toContain('<iframe class="signal-popup-video"');
    expect(html).toContain('class="signal-popup-source-link"');
    expect(html).not.toMatch(/<a[^>]*>[^]*<iframe/);
  });
});
