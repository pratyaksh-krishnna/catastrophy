"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import ngeohash from "ngeohash";
import {
  buildSignalPopupHtml,
  type PublicSignalCell,
  type SignalCellProperties,
} from "./signal-cells";

interface PublicCell {
  geohash: string;
  precision: number;
  intensity: number;
}

interface HeatmapResponse {
  cells?: PublicCell[];
  error?: string;
}

interface SignalsResponse {
  cells?: PublicSignalCell[];
  error?: string;
}

const SIGNAL_HALO_LAYER_ID = "public-signals-halo";
const SIGNAL_CORE_LAYER_ID = "public-signals-core";
const HEATMAP_LAYER_ID = "public-heatmap-density";
const HEATMAP_HALO_LAYER_ID = "public-heatmap-cell-halo";

function cellCenter(geohash: string) {
  const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(geohash);
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2] as [number, number];
}

function featureCollection(cells: PublicCell[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => {
      return {
        type: "Feature" as const,
        properties: { intensity: cell.intensity, precision: cell.precision },
        geometry: {
          type: "Point" as const,
          coordinates: cellCenter(cell.geohash),
        },
      };
    }),
  };
}

function signalFeatureCollection(cells: PublicSignalCell[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => ({
      type: "Feature" as const,
      properties: {
        signalCount: cell.signalCount,
        summary: cell.summary,
        // Keep the public source cards attached to the privacy cell feature so
        // clicking the marker can render them without any coordinate detail.
        sources: cell.sources,
      },
      geometry: { type: "Point" as const, coordinates: cellCenter(cell.geohash) },
    })),
  };
}

export function PublicHeatmap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dockRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [signalsVisible, setSignalsVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // The signal cell being read. It is held here rather than in a map popup so
  // the account stays in one place at the edge of the map, clear of the cell
  // it describes and large enough to read.
  const [activeSignal, setActiveSignal] = useState<SignalCellProperties | null>(null);
  const signalsVisibleRef = useRef(signalsVisible);
  const expandedRef = useRef(expanded);

  // Kept in refs so the mount effect below (which only runs once) can read
  // the latest values at the moment the signal layers and map handlers are
  // first created, without needing map setup to depend on them.
  signalsVisibleRef.current = signalsVisible;
  expandedRef.current = expanded;

  // Applies toggle changes to already-created layers. Reading the Building
  // heat layer is untouched by this — it has no visibility toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = signalsVisible ? "visible" : "none";
    for (const layerId of [SIGNAL_HALO_LAYER_ID, SIGNAL_CORE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visibility);
      }
    }
    if (!signalsVisible) {
      setActiveSignal(null);
    }
  }, [signalsVisible]);

  // Full screen is a CSS state rather than the Fullscreen API, so the map keeps
  // its own overlays and the page underneath keeps its scroll position. The
  // body class lets the shell drop the bezel tilt: a transformed ancestor would
  // otherwise become the containing block for the fixed map stage.
  useEffect(() => {
    if (!expanded) return;
    document.body.classList.add("map-expanded");
    expandRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.classList.remove("map-expanded");
    };
  }, [expanded]);

  // A signal opened by clicking the map takes focus, so the panel can be read
  // and its source links reached from the keyboard.
  useEffect(() => {
    if (activeSignal) dockRef.current?.focus({ preventScroll: true });
  }, [activeSignal]);

  // Escape closes the reading panel first, then leaves full screen.
  useEffect(() => {
    if (!expanded && !activeSignal) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (activeSignal) setActiveSignal(null);
      else setExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, activeSignal]);

  useEffect(() => {
    if (!container.current) return;

    // Next bundles MapLibre's module URL into a chunk, so its default worker
    // URL points at a non-existent chunk path. Serve the matching worker as a
    // public asset so GeoJSON sources can be indexed and rendered.
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
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
          { id: "paper", type: "background", paint: { "background-color": "#111a19" } },
          {
            id: "openstreetmap",
            type: "raster",
            source: "openstreetmap",
            paint: {
              "raster-opacity": 0.56,
              "raster-saturation": -0.92,
              "raster-brightness-min": 0.12,
              "raster-brightness-max": 0.68,
            },
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

    // Clicking the map surface opens the full-screen view. Dragging the map
    // never reaches here — MapLibre withholds `click` once the pointer moves
    // past its drag tolerance — and a click that lands on a signal marker
    // belongs to the reading panel instead.
    map.on("click", (event) => {
      if (expandedRef.current) return;
      const signalLayers = map.getLayer(SIGNAL_CORE_LAYER_ID) ? [SIGNAL_CORE_LAYER_ID] : [];
      if (signalLayers.length > 0 &&
        map.queryRenderedFeatures(event.point, { layers: signalLayers }).length > 0) {
        return;
      }
      setExpanded(true);
    });

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
          // Register the source before its first payload. This lets the style
          // attach the source cache and layers before the worker receives the
          // GeoJSON, which is more reliable during the map's initial load.
          map.addSource("public-heat", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: HEATMAP_LAYER_ID,
            type: "heatmap",
            source: "public-heat",
            paint: {
              "heatmap-weight": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, 0.45, 1, 1,
              ],
              "heatmap-intensity": [
                "interpolate", ["linear"], ["zoom"],
                8, 0.72, 10, 0.95, 12, 1.15, 15, 1.3,
              ],
              "heatmap-radius": [
                "interpolate", ["linear"], ["zoom"],
                8, 36, 10, 46, 12, 60, 15, 82,
              ],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(0,0,0,0)",
                0.12, "rgba(31,133,104,0.34)",
                0.32, "#5faf70",
                0.52, "#d5bf4b",
                0.72, "#dc8740",
                0.9, "#cf4f42",
                1, "#8f2938",
              ],
              "heatmap-opacity": 0.72,
            },
          });
          // The density field communicates neighbourhood scale. A single,
          // diffuse bloom gives sparse privacy cells form while keeping
          // attention on the reporting area, never a centre-point location.
          map.addLayer({
            id: HEATMAP_HALO_LAYER_ID,
            type: "circle",
            source: "public-heat",
            paint: {
              "circle-color": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, "#318a70", 0.48, "#d4b54b", 0.76, "#d86d3f", 1, "#9d3040",
              ],
              "circle-radius": [
                "*",
                ["interpolate", ["linear"], ["zoom"], 8, 22, 10, 29, 12, 38, 15, 56],
                ["interpolate", ["linear"], ["get", "intensity"], 0, 0.75, 1, 1.15],
              ],
              "circle-opacity": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, 0.08, 0.55, 0.18, 1, 0.3,
              ],
              "circle-blur": 0.85,
            },
          });
          (map.getSource("public-heat") as GeoJSONSource).setData(data);
          map.triggerRepaint();
        }
        setState(cells.length === 0 ? "empty" : "ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      }
    }

    map.once("load", loadCells);
    map.on("moveend", loadCells);

    // Area Signals: a second, independently-fetched layer. A failure here
    // must never blank the Building heat layer above (and vice versa), so
    // this has its own abort controller, its own try/catch, and never
    // touches `state`, `abortController`, `public-heat`, or the layers
    // added by loadCells().
    let signalsAbortController: AbortController | undefined;

    async function loadSignalCells() {
      signalsAbortController?.abort();
      signalsAbortController = new AbortController();

      try {
        const response = await fetch("/api/signals", {
          signal: signalsAbortController.signal,
          headers: { Accept: "application/json" },
        });
        const body = await response.json() as SignalsResponse;
        if (!response.ok) throw new Error(body.error ?? "Signals unavailable");
        const cells = body.cells ?? [];
        const data = signalFeatureCollection(cells);
        const source = map.getSource("public-signals") as GeoJSONSource | undefined;

        if (source) {
          source.setData(data);
        } else {
          map.addSource("public-signals", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          const initialVisibility = signalsVisibleRef.current ? "visible" : "none";
          // Signals use a cool ring and a small core so unverified media/social
          // reports remain visually distinct from the resident heat layer.
          map.addLayer({
            id: SIGNAL_HALO_LAYER_ID,
            type: "circle",
            source: "public-signals",
            layout: { visibility: initialVisibility },
            paint: {
              "circle-color": "#6289c4",
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                8, 26, 12, 39, 15, 52,
              ],
              "circle-opacity": 0.28,
              "circle-blur": 0.78,
            },
          });
          map.addLayer({
            id: SIGNAL_CORE_LAYER_ID,
            type: "circle",
            source: "public-signals",
            layout: { visibility: initialVisibility },
            paint: {
              "circle-color": "#5279b1",
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                8, 7, 12, 11, 15, 16,
              ],
              "circle-opacity": 0.72,
              "circle-stroke-color": "rgba(235,243,255,0.88)",
              "circle-stroke-width": [
                "interpolate", ["linear"], ["zoom"],
                8, 0.7, 12, 1, 15, 1.35,
              ],
            },
          });

          map.on("click", SIGNAL_CORE_LAYER_ID, (event) => {
            const feature = event.features?.[0];
            if (!feature) return;
            const properties = (feature.properties ?? {}) as {
              signalCount?: number;
              summary?: string | null;
              sources?: unknown;
            };
            let sources: unknown[] = [];
            if (Array.isArray(properties.sources)) {
              sources = properties.sources;
            } else if (typeof properties.sources === "string") {
              try {
                const parsed: unknown = JSON.parse(properties.sources);
                if (Array.isArray(parsed)) sources = parsed;
              } catch {
                // MapLibre serializes arrays in feature properties. A malformed
                // value should simply leave the popup without source cards.
              }
            }
            setActiveSignal({
              signalCount: Number(properties.signalCount ?? 0),
              summary: properties.summary ?? null,
              sources,
            } as SignalCellProperties);
          });
          map.on("mouseenter", SIGNAL_CORE_LAYER_ID, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", SIGNAL_CORE_LAYER_ID, () => {
            map.getCanvas().style.cursor = "";
          });
          (map.getSource("public-signals") as GeoJSONSource).setData(data);
          map.triggerRepaint();
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Signals are best-effort: the Building heat layer keeps working.
        console.error("Signals layer unavailable", error);
      }
    }

    map.once("load", loadSignalCells);

    return () => {
      abortController?.abort();
      signalsAbortController?.abort();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const stageClass = [
    "map-stage",
    expanded ? "map-stage--expanded" : "",
    activeSignal ? "map-stage--reading" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={stageClass} aria-label="Privacy-preserving map of Delhi building-safety signals">
      <div ref={container} className="map-canvas" />
      <div className="map-scrim" aria-hidden="true" />
      <div className="map-topbar">
        <div className="map-label map-label--top">
          <span className={`live-dot live-dot--${state}`} aria-hidden="true" />
          {state === "loading" && "Reading the city"}
          {state === "ready" && "Live Building heat"}
          {state === "empty" && "No publishable signal here"}
          {state === "error" && "Map signal unavailable"}
        </div>
        <button
          ref={expandRef}
          className="map-expand"
          type="button"
          aria-pressed={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {expanded
              ? <path d="M10 4v6H4M14 20v-6h6M10 10 4 4M14 14l6 6" />
              : <path d="M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6" />}
          </svg>
          {expanded ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      <div className="map-privacy-note">
        <span className="privacy-mark" aria-hidden="true">⌁</span>
        <span><strong>Heat, never pins.</strong> Sparse areas are hidden automatically.</span>
      </div>
      <aside className="map-layer-panel" aria-label="Map data layers">
        <div className="map-layer-heading">
          <span>Reading the map</span>
          <span className="map-layer-live"><i aria-hidden="true" /> Live</span>
        </div>
        <div className="map-layer-item">
          <i className="map-swatch map-swatch--heat" aria-hidden="true" />
          <span><strong>Resident evidence</strong><small>Verified reports, grouped by area</small></span>
        </div>
        <div className="map-layer-item">
          <i className="map-swatch map-swatch--signal" aria-hidden="true" />
          <span><strong>Area signals</strong><small>Media and social reports</small></span>
        </div>
        <button
          className="map-layer-toggle"
          type="button"
          aria-pressed={signalsVisible}
          onClick={() => setSignalsVisible((visible) => !visible)}
        >
          <span className={`map-toggle-track${signalsVisible ? " map-toggle-track--active" : ""}`} aria-hidden="true"><i /></span>
          <span>{signalsVisible ? "Area signals shown" : "Area signals hidden"}</span>
        </button>
      </aside>
      {activeSignal && (
        <aside ref={dockRef} className="signal-dock" tabIndex={-1} aria-label="Area signal detail">
          <header className="signal-dock-head">
            <span className="signal-dock-kicker">Area signal</span>
            <button
              className="signal-dock-close"
              type="button"
              onClick={() => setActiveSignal(null)}
              aria-label="Close area signal"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </header>
          {/* buildSignalPopupHtml() escapes every value it renders: this is the
              same summary, count and source markup the map popup carried, docked
              at the edge of the map where it can be read in full. */}
          <div
            className="signal-dock-body"
            dangerouslySetInnerHTML={{ __html: buildSignalPopupHtml(activeSignal) }}
          />
        </aside>
      )}
      <div className="map-intensity" aria-label="Heat intensity legend">
        <span>Lower</span>
        <i aria-hidden="true" />
        <span>Higher</span>
      </div>
    </div>
  );
}
