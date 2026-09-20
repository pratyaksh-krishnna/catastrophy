import ngeohash from "ngeohash";

/** Below this, an entry resolves no finer than a district and is not mapped. */
export const MIN_MAPPABLE_PRECISION = 5;

export interface Locality {
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  readonly precision: number;
}

// Closed list of Delhi places the Extractor may name. Localities carry precision 6
// (street/neighbourhood scale); district-level entries carry precision 4 and exist
// only so a district mention can be recognised and dropped per the Signals spec.
const RAW = {
  laxmi_nagar:        ["Laxmi Nagar", 28.6304, 77.2773, 6],
  karol_bagh:         ["Karol Bagh", 28.6519, 77.1909, 6],
  shahdara:           ["Shahdara", 28.6692, 77.2905, 6],
  seelampur:          ["Seelampur", 28.6707, 77.2673, 6],
  chandni_chowk:      ["Chandni Chowk", 28.6506, 77.2303, 6],
  dwarka:             ["Dwarka", 28.5921, 77.0460, 6],
  rohini:             ["Rohini", 28.7495, 77.0565, 6],
  saket:              ["Saket", 28.5245, 77.2066, 6],
  okhla:              ["Okhla", 28.5355, 77.2910, 6],
  mayur_vihar:        ["Mayur Vihar", 28.6096, 77.2953, 6],
  paharganj:          ["Paharganj", 28.6449, 77.2167, 6],
  jahangirpuri:       ["Jahangirpuri", 28.7284, 77.1637, 6],
  sangam_vihar:       ["Sangam Vihar", 28.5008, 77.2274, 6],
  najafgarh:          ["Najafgarh", 28.6092, 76.9803, 6],
  vasant_kunj:        ["Vasant Kunj", 28.5203, 77.1588, 6],
  lajpat_nagar:       ["Lajpat Nagar", 28.5677, 77.2431, 6],
  greater_kailash:    ["Greater Kailash", 28.5494, 77.2425, 6],
  hauz_khas:          ["Hauz Khas", 28.5494, 77.2001, 6],
  connaught_place:    ["Connaught Place", 28.6315, 77.2167, 6],
  rajouri_garden:     ["Rajouri Garden", 28.6467, 77.1204, 6],
  janakpuri:          ["Janakpuri", 28.6219, 77.0827, 6],
  tilak_nagar:        ["Tilak Nagar", 28.6390, 77.0921, 6],
  patel_nagar:        ["Patel Nagar", 28.6500, 77.1673, 6],
  malviya_nagar:      ["Malviya Nagar", 28.5307, 77.2100, 6],
  defence_colony:     ["Defence Colony", 28.5730, 77.2294, 6],
  vasant_vihar:       ["Vasant Vihar", 28.5590, 77.1590, 6],
  pitampura:          ["Pitampura", 28.6980, 77.1315, 6],
  ashok_vihar:        ["Ashok Vihar", 28.6950, 77.1770, 6],
  model_town:         ["Model Town", 28.7115, 77.1922, 6],
  civil_lines:        ["Civil Lines", 28.6772, 77.2213, 6],
  daryaganj:          ["Daryaganj", 28.6459, 77.2416, 6],
  kalkaji:            ["Kalkaji", 28.5384, 77.2603, 6],
  nehru_place:        ["Nehru Place", 28.5486, 77.2519, 6],
  mehrauli:           ["Mehrauli", 28.5169, 77.1770, 6],
  dilshad_garden:     ["Dilshad Garden", 28.6773, 77.3210, 6],
  preet_vihar:        ["Preet Vihar", 28.6362, 77.2947, 6],
  vikaspuri:          ["Vikaspuri", 28.6360, 77.0648, 6],
  uttam_nagar:        ["Uttam Nagar", 28.6198, 77.0596, 6],
  punjabi_bagh:       ["Punjabi Bagh", 28.6692, 77.1310, 6],
  moti_nagar:         ["Moti Nagar", 28.6558, 77.1466, 6],
  green_park:         ["Green Park", 28.5588, 77.2064, 6],
  yamuna_vihar:       ["Yamuna Vihar", 28.6926, 77.2726, 6],
  north_delhi:        ["North Delhi", 28.7041, 77.1917, 4],
  south_delhi:        ["South Delhi", 28.5245, 77.2066, 4],
  east_delhi:         ["East Delhi", 28.6512, 77.2900, 4],
  west_delhi:         ["West Delhi", 28.6692, 77.1004, 4],
  new_delhi:          ["New Delhi", 28.6139, 77.2090, 4],
  central_delhi:      ["Central Delhi", 28.6519, 77.2315, 4],
} as const satisfies Record<string, readonly [string, number, number, number]>;

export type LocalityId = keyof typeof RAW;

export const LOCALITY_CATALOGUE: Record<LocalityId, Locality> = Object.fromEntries(
  Object.entries(RAW).map(([id, [label, lat, lon, precision]]) => [
    id,
    { label, lat, lon, precision },
  ]),
) as Record<LocalityId, Locality>;

export const LOCALITY_IDS = Object.keys(RAW) as LocalityId[];

function isLocalityId(id: string): id is LocalityId {
  return Object.prototype.hasOwnProperty.call(LOCALITY_CATALOGUE, id);
}

/**
 * Deterministic geocoding for a name the Extractor picked off the closed list.
 * Unknown ids and district-level entries (below MIN_MAPPABLE_PRECISION) return
 * null — per the Signals spec, anything no finer than a district is not mapped.
 */
export function cellFor(id: string): { geohash: string; precision: number } | null {
  if (!isLocalityId(id)) return null;

  const entry = LOCALITY_CATALOGUE[id];
  if (entry.precision < MIN_MAPPABLE_PRECISION) return null;

  return {
    geohash: ngeohash.encode(entry.lat, entry.lon, entry.precision),
    precision: entry.precision,
  };
}
