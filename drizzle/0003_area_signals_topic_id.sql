-- Persist the Extractor's topic so per-cell topic counts can be aggregated
-- for narrateCellSummary. Nullable: older rows and non-relevant/dropped
-- extractions never had a topic recorded.
ALTER TABLE area_signals ADD COLUMN topic_id text;
