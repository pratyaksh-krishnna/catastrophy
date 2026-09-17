import {
  pgTable, uuid, text, timestamp, doublePrecision, jsonb, integer, primaryKey, customType,
} from "drizzle-orm/pg-core";

/** PostGIS geography(Point,4326). Written with ST_* SQL, read via ST_X/ST_Y. */
const point = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Point, 4326)",
});

export const societies = pgTable("societies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reporters = pgTable("reporters", {
  id: uuid("id").primaryKey().defaultRandom(),
  pseudonym: text("pseudonym").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const officeBearers = pgTable("office_bearers", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").notNull().references(() => societies.id),
  reporterId: uuid("reporter_id").notNull().references(() => reporters.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export const buildings = pgTable("buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").references(() => societies.id),
  addressText: text("address_text").notNull(),
  location: point("location").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull().references(() => buildings.id),
  reporterId: uuid("reporter_id").notNull().references(() => reporters.id),
  sourceClass: text("source_class").notNull(),
  note: text("note"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  deviceLocation: point("device_location"),
  exifLocation: point("exif_location"),
  geoAgreement: text("geo_agreement").notNull().default("unknown"),
  s3KeyOriginal: text("s3_key_original"),
  s3KeyPublic: text("s3_key_public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hazards = pgTable("hazards", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull().references(() => buildings.id),
  typeId: text("type_id").notNull(),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const evidenceHazards = pgTable(
  "evidence_hazards",
  {
    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
    hazardId: uuid("hazard_id").notNull().references(() => hazards.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.evidenceId, t.hazardId] }) }),
);

export const assessments = pgTable("assessments", {
  buildingId: uuid("building_id").primaryKey().references(() => buildings.id),
  score: doublePrecision("score").notNull(),
  alertLevel: text("alert_level").notNull(),
  narrative: text("narrative").notNull(),
  ranked: jsonb("ranked").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const escalations = pgTable("escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull().references(() => buildings.id),
  authority: text("authority").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  status: text("status").notNull().default("sent"),
  externalTicket: text("external_ticket"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const resolutionClaims = pgTable("resolution_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  hazardId: uuid("hazard_id").notNull().references(() => hazards.id),
  officeBearerId: uuid("office_bearer_id").notNull().references(() => officeBearers.id),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
  contestUntil: timestamp("contest_until", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const areaSignals = pgTable("area_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  geohash: text("geohash").notNull(),
  precision: integer("precision").notNull(),
  sourceId: text("source_id").notNull(),
  text: text("text").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
