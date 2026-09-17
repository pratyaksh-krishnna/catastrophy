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
