-- Per-property cleans-per-month derived from breezeway_tasks. Replaces the
-- manually-imported avg_cleans_per_month signal on the Per-Property tab so
-- the Pro Forma updates automatically as the daily Breezeway sync lands.
--
-- Definition: avg_cleans_per_month = total is_clean rows / distinct months
-- present in due_date. Deep cleans are NOT included in this number — they
-- ride a separate revenue line.

CREATE OR REPLACE VIEW property_breezeway_stats AS
SELECT
  p.id                                                           AS property_id,
  COALESCE(COUNT(bt.id) FILTER (WHERE bt.is_clean), 0)           AS total_cleans,
  COALESCE(COUNT(bt.id) FILTER (WHERE bt.is_deep_clean), 0)      AS total_deep_cleans,
  COUNT(DISTINCT to_char(bt.due_date, 'YYYY-MM'))                AS months_with_data,
  CASE
    WHEN COUNT(DISTINCT to_char(bt.due_date, 'YYYY-MM')) > 0 THEN
      ROUND(
        (COUNT(bt.id) FILTER (WHERE bt.is_clean))::numeric
        / COUNT(DISTINCT to_char(bt.due_date, 'YYYY-MM')),
        1
      )
    ELSE 0
  END                                                            AS avg_cleans_per_month,
  CASE
    WHEN COUNT(DISTINCT to_char(bt.due_date, 'YYYY-MM')) > 0 THEN
      ROUND(
        (COUNT(bt.id) FILTER (WHERE bt.is_deep_clean))::numeric
        / COUNT(DISTINCT to_char(bt.due_date, 'YYYY-MM')),
        2
      )
    ELSE 0
  END                                                            AS avg_deep_cleans_per_month,
  MIN(bt.due_date)                                               AS earliest_task,
  MAX(bt.due_date)                                               AS latest_task
FROM properties p
LEFT JOIN breezeway_tasks bt ON bt.property_id = p.id
GROUP BY p.id;

GRANT SELECT ON property_breezeway_stats TO authenticated;
