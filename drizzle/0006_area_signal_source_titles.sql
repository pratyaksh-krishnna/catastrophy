-- Live records created before source_title existed contain the discovery
-- headline as the first line of `text`. Copy that bounded publisher headline
-- once for attribution; demo fixtures remain labelled by the public DTO.
UPDATE area_signals
SET source_title = left(trim(regexp_replace(split_part(text, E'\n', 1), '[[:cntrl:]]+', ' ', 'g')), 160)
WHERE source_title IS NULL
  AND source_url IS NOT NULL
  AND source_url !~* '^https?://news\.example\.com/'
  AND length(trim(split_part(text, E'\n', 1))) > 0;
