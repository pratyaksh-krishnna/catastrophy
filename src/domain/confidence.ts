export type SourceClass =
  | "official_record"
  | "resident_video"
  | "resident_photo"
  | "news_article"
  | "resident_account"
  | "social_post";

export type GeoAgreement = "agree" | "disagree" | "unknown";

export interface EvidenceRef {
  reporterId: string;
  sourceClass: SourceClass;
  capturedAt: Date;
  geoAgreement: GeoAgreement;
}

/** How much trust an origin lends. Moved by the feedback loop; never by volume. */
export const SOURCE_CLASS_WEIGHT: Record<SourceClass, number> = {
  official_record: 0.9,
  resident_video: 0.65,
  resident_photo: 0.6,
  news_article: 0.45,
  resident_account: 0.35,
  social_post: 0.2,
};

/** One Reporter can never push Confidence past this alone — see ADR-0001. */
export const REPORTER_CAP = 0.5;
export const HALF_LIFE_DAYS = 180;
export const CROSS_CLASS_BONUS = 0.15;

const GEO_FACTOR: Record<GeoAgreement, number> = { agree: 1.1, unknown: 1.0, disagree: 0.5 };

function decay(capturedAt: Date, now: Date): number {
  const days = (now.getTime() - capturedAt.getTime()) / 86_400_000;
  return days <= 0 ? 1 : Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function itemStrength(e: EvidenceRef, now: Date): number {
  return Math.min(1, SOURCE_CLASS_WEIGHT[e.sourceClass] * GEO_FACTOR[e.geoAgreement]) * decay(e.capturedAt, now);
}

export function computeConfidence(evidence: EvidenceRef[], now: Date): number {
  if (evidence.length === 0) return 0;

  // Per Reporter, take their single strongest item. Volume from one person adds nothing.
  const strongestByReporter = new Map<string, number>();
  for (const e of evidence) {
    const s = itemStrength(e, now);
    strongestByReporter.set(e.reporterId, Math.max(strongestByReporter.get(e.reporterId) ?? 0, s));
  }

  // Noisy-OR across independent Reporters: diminishing returns, never reaching 1.
  let combined = 0;
  for (const s of strongestByReporter.values()) {
    combined = 1 - (1 - combined) * (1 - Math.min(s, REPORTER_CAP));
  }

  const classes = new Set(evidence.map((e) => e.sourceClass));
  if (classes.size >= 2) combined += (1 - combined) * CROSS_CLASS_BONUS;

  return Math.min(1, combined);
}
