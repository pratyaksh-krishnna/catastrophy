import { describe, expect, it } from "vitest";
import { routeAuthorities } from "./routing.js";

describe("routeAuthorities", () => {
  it("sends structural Hazards to MCD", () => {
    expect(routeAuthorities([{ typeId: "slab_deflection", confidence: 0.6 }])).toEqual(["mcd"]);
  });

  it("sends unauthorised construction to DDA", () => {
    expect(routeAuthorities([{ typeId: "unauthorised_storey", confidence: 0.6 }])).toEqual(["dda"]);
  });

  it("adds DDMA and MCD when a Severity-5 Hazard is present", () => {
    const authorities = routeAuthorities([{ typeId: "illegal_basement_excavation", confidence: 0.9 }]);
    expect(authorities).toEqual(["dda", "ddma", "mcd"]);
  });

  it("deduplicates authorities across several Hazards", () => {
    expect(
      routeAuthorities([
        { typeId: "slab_deflection", confidence: 0.5 },
        { typeId: "roof_damage", confidence: 0.5 },
      ]),
    ).toEqual(["mcd"]);
  });

  it("routes nothing when there are no open Hazards", () => {
    expect(routeAuthorities([])).toEqual([]);
  });
});
