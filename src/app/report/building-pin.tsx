"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";

type Point = { lat: number; lon: number };

export function BuildingPin({ value, onChange }: { value: Point | null; onChange: (point: Point) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [locationError, setLocationError] = useState("");

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
        layers: [
          { id: "paper", type: "background", paint: { "background-color": "#d8ddd1" } },
          { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.82 } },
        ],
      },
      center: [77.2167, 28.6315],
      zoom: 10,
      maxBounds: [[76.8, 28.4], [77.4, 28.9]],
      minZoom: 8,
      maxZoom: 18,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.on("click", (event) => onChange({ lat: event.lngLat.lat, lon: event.lngLat.lng }));
    return () => { markerRef.current?.remove(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!value || !mapRef.current) return;
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#c64c43" })
      .setLngLat([value.lon, value.lat])
      .addTo(mapRef.current);
  }, [value]);

  function useCurrentLocation() {
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lon: position.coords.longitude };
        if (point.lat < 28.4 || point.lat > 28.9 || point.lon < 76.8 || point.lon > 77.4) {
          setLocationError("Your current location is outside the Delhi map. Tap the Building on the map instead.");
          return;
        }
        onChange(point);
        mapRef.current?.flyTo({ center: [point.lon, point.lat], zoom: 16 });
      },
      () => setLocationError("Location unavailable. Tap the Building on the map instead."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <div className="building-pin">
      <div ref={container} className="building-pin-map" role="application" aria-label="Map for pinning a Building" />
      <button type="button" className="pin-location-button" onClick={useCurrentLocation}>Use my location</button>
      {locationError && <small role="alert">{locationError}</small>}
    </div>
  );
}
