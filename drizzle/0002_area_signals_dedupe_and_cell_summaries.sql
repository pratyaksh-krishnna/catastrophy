CREATE UNIQUE INDEX area_signals_source_id_idx ON area_signals (source_id);

-- Public prose derived from Signals for one cell. Never contains raw post text.
CREATE TABLE cell_summaries (
  geohash      text PRIMARY KEY,
  precision    integer NOT NULL,
  summary      text NOT NULL,
  signal_count integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
