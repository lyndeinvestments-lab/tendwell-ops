-- Quarterly goals (leadership-only).
--
-- Lives next to the North Star scorecard but deliberately NOT in
-- north_star_metrics / north_star_values: those tables are readable by every
-- signed-in user (USING (true)). Quarterly goals from the Jack/Jordan quarterly
-- meeting are for admins only, so this table is locked to
-- current_user_role() = 'admin' in the database itself. Hiding the tab in the UI
-- is a convenience; this policy is the actual gate.
--
-- kind: 'goal'    = a quarterly "big rock"
--       'measure' = something to measure / prepare for review (not a deliverable)

CREATE TABLE IF NOT EXISTS public.quarterly_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter     text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  kind        text NOT NULL DEFAULT 'goal' CHECK (kind IN ('goal', 'measure')),
  title       text NOT NULL,
  detail      text,
  owner_name  text,
  status      text NOT NULL DEFAULT 'Not started'
              CHECK (status IN ('Not started', 'In progress', 'Blocked', 'Done')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quarterly_goals_quarter
  ON public.quarterly_goals (quarter, kind, sort_order);

ALTER TABLE public.quarterly_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quarterly_goals_admin_all ON public.quarterly_goals;
CREATE POLICY quarterly_goals_admin_all ON public.quarterly_goals
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

REVOKE ALL ON public.quarterly_goals FROM anon;
