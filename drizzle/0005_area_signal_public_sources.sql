-- Public provenance for cell-level media/social signals. These values are
-- supplied by external discovery, never by a resident evidence upload.
ALTER TABLE area_signals
  ADD COLUMN source_url text,
  ADD COLUMN source_title text,
  ADD COLUMN media_url text,
  ADD COLUMN media_kind text;

CREATE INDEX area_signals_geohash_occurred_at_idx
  ON area_signals (geohash, occurred_at DESC);

-- Older records predate the explicit provenance fields. Their source_id was
-- the article URL by contract, so copy only valid web URLs. Demo fixtures are
-- identified in the public DTO and are never linked as real reporting.
UPDATE area_signals
SET source_url = source_id
WHERE source_url IS NULL
  AND source_id ~ '^https?://[^[:space:]]+$';

-- A video discovery URL is safe to represent as an outbound video card. It is
-- never embedded from a third-party site.
UPDATE area_signals
SET media_url = source_url,
    media_kind = 'video'
WHERE media_url IS NULL
  AND source_url ~* '^https?://(www\.)?(youtube\.com|youtu\.be)/';
