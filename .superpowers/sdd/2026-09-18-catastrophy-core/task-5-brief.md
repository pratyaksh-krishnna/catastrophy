### Task 5: Database schema and PostGIS migration

**Files:**
- Create: `src/db/client.ts`, `src/db/schema.ts`, `drizzle/0000_init.sql`, `drizzle.config.ts`, `.env.example`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: `HazardTypeId` (Task 1), `SourceClass`/`GeoAgreement` (Task 2), `AlertLevel` (Task 3)
- Produces: `db`, `pool`, and tables `societies`, `reporters`, `officeBearers`, `buildings`, `evidence`, `hazards`, `evidenceHazards`, `assessments`, `escalations`, `resolutionClaims`, `areaSignals`

- [ ] **Step 1: Install dependencies and write the migration**

```bash
npm i drizzle-orm pg
npm i -D drizzle-kit @types/pg
docker compose up -d
```

Create `.env.example`:

```
DATABASE_URL=postgres://postgres:catastrophy@127.0.0.1:55432/catastrophy
DATABASE_URL_TEST=postgres://postgres:catastrophy@127.0.0.1:55432/catastrophy
MODEL=anthropic.claude-opus-5
AWS_REGION=ap-south-1
S3_BUCKET=catastrophy-media
SES_FROM=alerts@example.invalid
ESCALATION_INBOX=escalations@example.invalid
```

Create `drizzle/0000_init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE societies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reporters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym   text NOT NULL,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE office_bearers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  uuid NOT NULL REFERENCES societies(id),
  reporter_id uuid NOT NULL REFERENCES reporters(id),
  approved_at timestamptz,
  UNIQUE (society_id, reporter_id)
);

CREATE TABLE buildings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id   uuid REFERENCES societies(id),
  address_text text NOT NULL,
  location     geography(Point, 4326) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buildings_location_idx ON buildings USING GIST (location);

CREATE TABLE evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     uuid NOT NULL REFERENCES buildings(id),
  reporter_id     uuid NOT NULL REFERENCES reporters(id),
  source_class    text NOT NULL,
  note            text,
  captured_at     timestamptz NOT NULL,
  device_location geography(Point, 4326),
  exif_location   geography(Point, 4326),
  geo_agreement   text NOT NULL DEFAULT 'unknown',
  s3_key_original text,
  s3_key_public   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_building_idx ON evidence (building_id);

CREATE TABLE hazards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id),
  type_id     text NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  opened_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (building_id, type_id)
);
CREATE INDEX hazards_building_idx ON hazards (building_id);

CREATE TABLE evidence_hazards (
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  hazard_id   uuid NOT NULL REFERENCES hazards(id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, hazard_id)
);

-- One current Assessment per Building. Replaced wholesale, never appended to.
CREATE TABLE assessments (
  building_id  uuid PRIMARY KEY REFERENCES buildings(id),
  score        double precision NOT NULL,
  alert_level  text NOT NULL,
  narrative    text NOT NULL,
  ranked       jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE escalations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     uuid NOT NULL REFERENCES buildings(id),
  authority       text NOT NULL,
  snapshot        jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'sent',
  external_ticket text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz
);
CREATE INDEX escalations_building_idx ON escalations (building_id);

CREATE TABLE resolution_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id       uuid NOT NULL REFERENCES hazards(id),
  office_bearer_id uuid NOT NULL REFERENCES office_bearers(id),
  evidence_id     uuid NOT NULL REFERENCES evidence(id),
  contest_until   timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Located to a cell, never to a Building. Never touches Confidence or Score.
CREATE TABLE area_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geohash     text NOT NULL,
  precision   integer NOT NULL,
  source_id   text NOT NULL,
  text        text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX area_signals_geohash_idx ON area_signals (geohash);
```

Apply it:

```bash
psql "$DATABASE_URL" -f drizzle/0000_init.sql
```

- [ ] **Step 2: Write the failing test**

Create `src/db/schema.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { buildings } from "./schema.js";

afterAll(async () => { await pool.end(); });

describe("schema", () => {
  it("has postgis available", async () => {
    const r = await db.execute(sql`SELECT PostGIS_Version() AS v`);
    expect(r.rows[0].v).toBeTruthy();
  });

  it("stores and reads a building's point", async () => {
    const [row] = await db
      .insert(buildings)
      .values({
        addressText: "12 Test Marg, Lajpat Nagar",
        location: sql`ST_SetSRID(ST_MakePoint(77.2432, 28.5677), 4326)::geography`,
      })
      .returning({ id: buildings.id });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);

    const back = await db.execute(
      sql`SELECT ST_Y(location::geometry) AS lat FROM buildings WHERE id = ${row.id}`,
    );
    expect(Number(back.rows[0].lat)).toBeCloseTo(28.5677, 4);
  });

  it("refuses a second hazard of the same type on one building", async () => {
    const [b] = await db
      .insert(buildings)
      .values({
        addressText: "dup test",
        location: sql`ST_SetSRID(ST_MakePoint(77.0, 28.0), 4326)::geography`,
      })
      .returning({ id: buildings.id });

    await db.execute(sql`INSERT INTO hazards (building_id, type_id) VALUES (${b.id}, 'load_bearing_crack')`);
    await expect(
      db.execute(sql`INSERT INTO hazards (building_id, type_id) VALUES (${b.id}, 'load_bearing_crack')`),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/schema.test.ts`
Expected: FAIL — cannot resolve `./client.js`

- [ ] **Step 4: Write the client and schema**

Create `src/db/client.ts`:

```typescript
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool);
```

Create `src/db/schema.ts`:

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add src/db drizzle drizzle.config.ts docker-compose.yml .env.example package.json
git commit -m "feat: postgis schema for buildings, evidence, hazards, assessments and escalations"
```

---

