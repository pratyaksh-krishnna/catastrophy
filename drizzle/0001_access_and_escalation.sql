CREATE TABLE building_residents (
  building_id uuid NOT NULL REFERENCES buildings(id),
  reporter_id uuid NOT NULL REFERENCES reporters(id),
  approved_at timestamptz NOT NULL,
  PRIMARY KEY (building_id, reporter_id)
);

ALTER TABLE escalations ADD COLUMN assessment_generated_at timestamptz;
CREATE UNIQUE INDEX escalations_one_per_assessment_authority_idx
  ON escalations (building_id, authority, assessment_generated_at);
