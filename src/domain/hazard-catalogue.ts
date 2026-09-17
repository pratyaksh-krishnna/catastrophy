export type Severity = 1 | 2 | 3 | 4 | 5;
export type AuthorityId = "mcd" | "dda" | "ddma";

export interface HazardType {
  readonly id: HazardTypeId;
  readonly label: string;
  /** Harm if real. Grounded in UBBL 2016. Never computed — see ADR-0001. */
  readonly severity: Severity;
  readonly authority: AuthorityId;
  readonly byelawRef: string | null;
}

const RAW = {
  load_bearing_crack:        ["Cracking in a load-bearing wall", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  foundation_settlement:     ["Foundation settlement or tilt", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  column_failure:            ["Column spalling or failure", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  illegal_basement_excavation: ["Unauthorised basement excavation", 5, "dda", "UBBL 2016 cl. 3.3"],
  slab_deflection:           ["Visible slab deflection", 4, "mcd",  "UBBL 2016 cl. 1.6"],
  unauthorised_storey:       ["Unauthorised additional storey", 4, "dda",  "UBBL 2016 cl. 3.3"],
  cantilever_overload:       ["Overloaded cantilever projection", 4, "dda",  "UBBL 2016 cl. 3.8"],
  rebar_corrosion:           ["Exposed or corroding reinforcement", 4, "mcd",  "UBBL 2016 cl. 1.6"],
  adjacent_excavation:       ["Excavation undermining an adjacent plot", 4, "dda", "UBBL 2016 cl. 3.3"],
  balcony_detachment:        ["Balcony separating from the structure", 4, "mcd",  null],
  facade_detachment:         ["Facade or cladding detaching", 4, "mcd",  null],
  fire_egress_blocked:       ["Blocked or absent means of egress", 4, "mcd",  "UBBL 2016 cl. 4.0"],
  water_seepage_structural:  ["Seepage reaching structural members", 3, "mcd",  null],
  staircase_damage:          ["Damaged or unsupported staircase", 3, "mcd",  null],
  boundary_wall_lean:        ["Leaning boundary or parapet wall", 3, "mcd",  null],
  electrical_hazard:         ["Exposed or overloaded electrical work", 3, "mcd",  null],
  lift_shaft_damage:         ["Lift shaft structural damage", 3, "mcd",  null],
  roof_damage:               ["Roof structural damage", 3, "mcd",  null],
  gas_pipeline_proximity:    ["Gas line routed unsafely", 3, "mcd",  null],
  overloaded_water_tank:     ["Overloaded rooftop water tank", 3, "mcd",  null],
  sewage_undermining:        ["Sewage or drainage undermining foundations", 3, "mcd", null],
  drainage_failure:          ["Drainage failure causing standing water", 2, "mcd",  null],
  plaster_spalling:          ["Plaster spalling without exposed rebar", 2, "mcd",  null],
  seismic_retrofit_absent:   ["No seismic retrofit on a pre-code structure", 2, "mcd", "UBBL 2016 cl. 1.6"],
  other:                     ["Uncategorised — pending review", 1, "mcd",  null],
} as const satisfies Record<string, readonly [string, Severity, AuthorityId, string | null]>;

export type HazardTypeId = keyof typeof RAW;

export const HAZARD_CATALOGUE: Record<HazardTypeId, HazardType> = Object.fromEntries(
  Object.entries(RAW).map(([id, [label, severity, authority, byelawRef]]) => [
    id,
    { id: id as HazardTypeId, label, severity, authority, byelawRef },
  ]),
) as Record<HazardTypeId, HazardType>;

export const HAZARD_TYPE_IDS = Object.keys(RAW) as HazardTypeId[];

export function severityOf(id: HazardTypeId): Severity {
  return HAZARD_CATALOGUE[id].severity;
}
