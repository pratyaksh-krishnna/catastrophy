CREATE TABLE assessment_regeneration_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     uuid NOT NULL REFERENCES buildings(id),
  event_name      text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token     uuid,
  lease_until     timestamptz,
  delivered_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX assessment_regeneration_outbox_one_pending_per_building_idx
  ON assessment_regeneration_outbox (building_id)
  WHERE delivered_at IS NULL;

CREATE INDEX assessment_regeneration_outbox_due_idx
  ON assessment_regeneration_outbox (next_attempt_at)
  WHERE delivered_at IS NULL;
