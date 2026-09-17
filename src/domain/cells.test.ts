import { describe, it, expect } from "vitest";
import { suppressCells, K_SUPPRESSION, type ReportedPoint } from "./cells.js";

// Connaught Place, Delhi — points a few metres apart share a precision-7 cell.
const dense = (n: number): ReportedPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    buildingId: `b${i}`,
    lat: 28.6315 + i * 0.00002,
    lon: 77.2167 + i * 0.00002,
    score: 0.5,
  }));

describe("suppressCells", () => {
  it("renders nothing for a lone reported building", () => {
    expect(suppressCells(dense(1), 7)).toEqual([]);
  });

  it("renders nothing below the k threshold", () => {
    expect(suppressCells(dense(K_SUPPRESSION - 1), 7)).toEqual([]);
  });

  it("renders a cell once k distinct buildings fall inside it", () => {
    const cells = suppressCells(dense(K_SUPPRESSION), 7);
    expect(cells.length).toBe(1);
    expect(cells[0].buildingCount).toBeGreaterThanOrEqual(K_SUPPRESSION);
  });

  it("merges sparse points upward into a coarser cell rather than dropping them", () => {
    // Six points spread across separate precision-7 cells but one precision-5 cell.
    const spread: ReportedPoint[] = Array.from({ length: 6 }, (_, i) => ({
      buildingId: `s${i}`,
      lat: 28.63 + i * 0.004,
      lon: 77.21 + i * 0.004,
      score: 0.4,
    }));
    const cells = suppressCells(spread, 7);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0].precision).toBeLessThan(7);
  });

  it("counts each building once however many times it appears", () => {
    const dup = [...dense(K_SUPPRESSION), ...dense(K_SUPPRESSION)];
    const cells = suppressCells(dup, 7);
    expect(cells[0].buildingCount).toBe(K_SUPPRESSION);
  });

  it("gives intensity in 0..1 and never leaks a raw count through it", () => {
    const cells = suppressCells(dense(20), 7);
    expect(cells[0].intensity).toBeGreaterThan(0);
    expect(cells[0].intensity).toBeLessThanOrEqual(1);
  });
});
