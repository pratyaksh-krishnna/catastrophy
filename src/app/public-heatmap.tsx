"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import ngeohash from "ngeohash";

interface PublicCell {
  geohash: string;
  precision: number;
  intensity: number;
}

interface HeatmapResponse {
  cells?: PublicCell[];
  error?: string;
}

function featureCollection(cells: PublicCell[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => {
      const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(cell.geohash);
      return {
        type: "Feature" as const,
        properties: { intensity: cell.intensity, precision: cell.precision },
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

export function PublicHeatmap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    if (!container.current) return;

    const map = new maplibregl.Map({
      container: container.current,
      // Keep the style document local so the map still initializes when a
      // third-party style host is unavailable. Raster tiles can fail softly;
      // the privacy cells and the warm fallback canvas continue to render.
      style: {
        version: 8,
        sources: {
          openstreetmap: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          { id: "paper", type: "background", paint: { "background-color": "#d8ddd1" } },
          {
            id: "openstreetmap",
            type: "raster",
            source: "openstreetmap",
            paint: { "raster-opacity": 0.72, "raster-saturation": -0.72 },
          },
        ],
      },
      center: [77.2167, 28.6315],
      zoom: 10.2,
      minZoom: 8,
      maxZoom: 15,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    let abortController: AbortController | undefined;

    async function loadCells() {
      abortController?.abort();
      abortController = new AbortController();
      const bounds = map.getBounds();
      const query = new URLSearchParams({
        minLat: String(bounds.getSouth()),
        minLon: String(bounds.getWest()),
        maxLat: String(bounds.getNorth()),
        maxLon: String(bounds.getEast()),
        precision: "7",
      });

      try {
        const response = await fetch(`/api/heatmap?${query}`, {
          signal: abortController.signal,
          headers: { Accept: "application/json" },
        });
        const body = await response.json() as HeatmapResponse;
        if (!response.ok) throw new Error(body.error ?? "Heatmap unavailable");
        const cells = body.cells ?? [];
        const data = featureCollection(cells);
        const source = map.getSource("public-heat") as GeoJSONSource | undefined;

        if (source) {
          source.setData(data);
        } else {
          map.addSource("public-heat", { type: "geojson", data });
          map.addLayer({
            id: "public-heat-halo",
            type: "fill",
            source: "public-heat",
            paint: {
              "fill-color": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, "#f8cb7b", 0.45, "#eb7159", 1, "#802a3a",
              ],
              "fill-opacity": 0.2,
              "fill-outline-color": "rgba(255,255,255,0.48)",
            },
          });
          map.addLayer({
            id: "public-heat-core",
            type: "fill",
            source: "public-heat",
            paint: {
              "fill-color": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, "#f5bd61", 0.45, "#d94b46", 1, "#5c172c",
              ],
              "fill-opacity": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, 0.38, 1, 0.78,
              ],
              "fill-outline-color": "rgba(255,255,255,0.7)",
            },
          });
        }
        setState(cells.length === 0 ? "empty" : "ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      }
    }

    map.once("load", loadCells);
    map.on("moveend", loadCells);

    return () => {
      abortController?.abort();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="map-stage" aria-label="Privacy-preserving map of Delhi building-safety signals">
      <div ref={container} className="map-canvas" />
      <div className="map-scrim" aria-hidden="true" />
      <div className="map-label map-label--top">
        <span className={`live-dot live-dot--${state}`} aria-hidden="true" />
        {state === "loading" && "Reading the city"}
        {state === "ready" && "Live Building heat"}
        {state === "empty" && "No publishable signal here"}
        {state === "error" && "Map signal unavailable"}
      </div>
      <div className="map-privacy-note">
        <span className="privacy-mark" aria-hidden="true">⌁</span>
        <span><strong>Heat, never pins.</strong> Sparse areas are hidden automatically.</span>
      </div>
      <div className="map-legend" aria-label="Heat intensity legend">
        <span>Lower signal</span>
        <i aria-hidden="true" />
        <span>Higher signal</span>
      </div>
    </div>
  );
}
