import { describe, it, expect } from "vitest";
import {
  LOCALITY_CATALOGUE,
  LOCALITY_IDS,
  MIN_MAPPABLE_PRECISION,
  cellFor,
} from "./localities.js";

describe("locality catalogue", () => {
  it("is closed and non-empty", () => {
    expect(LOCALITY_IDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(LOCALITY_IDS).size).toBe(LOCALITY_IDS.length);
  });

  it("matches the catalogue keys", () => {
    expect(new Set(LOCALITY_IDS)).toEqual(new Set(Object.keys(LOCALITY_CATALOGUE)));
  });

  it("gives every entry a plausible Delhi coordinate", () => {
    for (const id of LOCALITY_IDS) {
      const entry = LOCALITY_CATALOGUE[id]!;
      expect(entry.lat).toBeGreaterThanOrEqual(28.3);
      expect(entry.lat).toBeLessThanOrEqual(28.9);
      expect(entry.lon).toBeGreaterThanOrEqual(76.8);
      expect(entry.lon).toBeLessThanOrEqual(77.4);
    }
  });

  it("includes district-level entries below the mappable precision", () => {
    const districts = LOCALITY_IDS.filter(
      (id) => LOCALITY_CATALOGUE[id]!.precision < MIN_MAPPABLE_PRECISION + 1,
    );
    expect(districts.length).toBeGreaterThanOrEqual(6);
    for (const id of districts) {
      expect(LOCALITY_CATALOGUE[id]!.precision).toBeLessThan(MIN_MAPPABLE_PRECISION);
    }
  });
});

describe("cellFor", () => {
  it("returns a stable geohash of the right length for a locality", () => {
    const cell = cellFor("laxmi_nagar");
    expect(cell).not.toBeNull();
    expect(cell!.precision).toBe(LOCALITY_CATALOGUE.laxmi_nagar.precision);
    expect(cell!.geohash.length).toBe(cell!.precision);
    // deterministic — same input, same output
    expect(cellFor("laxmi_nagar")).toEqual(cell);
  });

  it("returns null for a district-level entry", () => {
    expect(cellFor("north_delhi")).toBeNull();
    expect(cellFor("south_delhi")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(cellFor("not_a_real_place")).toBeNull();
    expect(cellFor("")).toBeNull();
  });

  it("does not collide two nearby localities on the same geohash", () => {
    const a = cellFor("hauz_khas");
    const b = cellFor("green_park");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.geohash).not.toBe(b!.geohash);
  });

  it("only ever maps entries at or above MIN_MAPPABLE_PRECISION", () => {
    for (const id of LOCALITY_IDS) {
      const cell = cellFor(id);
      const entry = LOCALITY_CATALOGUE[id]!;
      if (entry.precision < MIN_MAPPABLE_PRECISION) {
        expect(cell).toBeNull();
      } else {
        expect(cell).not.toBeNull();
        expect(cell!.geohash.length).toBe(entry.precision);
      }
    }
  });
});
