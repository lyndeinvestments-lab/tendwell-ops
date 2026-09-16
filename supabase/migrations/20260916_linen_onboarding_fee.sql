-- Onboarding linen fee, and a real cost basis for the recurring linen program.
--
-- Two related changes:
--
-- 1. A one-time onboarding linen fee. Properties on the linen program get
--    stocked at a par level of 3 sets (on the bed, in the wash, on the shelf),
--    priced per bed size and per bathroom type from the Dzee contracted cost
--    table (order #000029074, June 2026). The suggested figure is computed
--    live from the property's bed/bath mix, so it tracks edits; only the
--    operator's inputs are stored here.
--
-- 2. The recurring program cost stops being a flat `beds * $300 / 12 / 4` and
--    instead derives from each bed's real replacement cost: sets-per-year x
--    that bed size's per-set cost, still spread over 12 months and 4 cleans.
--    Nothing to migrate for this - it is a calculation change - but the unit
--    costs it reads are seeded below.
--
-- All rates live in app_settings so Dzee price changes never need a deploy.

-- ---------------------------------------------------------------------------
-- Per-property inputs for the onboarding fee
-- ---------------------------------------------------------------------------

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS linen_onboarding_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS linen_onboarding_sets INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS linen_onboarding_comforters BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN properties.linen_onboarding_fee IS
  'Manual override for the one-time onboarding linen fee. NULL means quote the suggested figure, which is computed live from the bed/bath mix. An explicit 0 is a deliberately waived fee, not a blank.';

COMMENT ON COLUMN properties.linen_onboarding_sets IS
  'Par level used for the onboarding linen quote. Default 3: one set on the bed, one in the wash, one on the shelf.';

COMMENT ON COLUMN properties.linen_onboarding_comforters IS
  'Include duvet inserts (2 per bed) in the onboarding linen quote. Off by default because many owners supply their own.';

-- A negative fee or a par level below 1 is always a data-entry slip.
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_linen_onboarding_fee_nonneg;
ALTER TABLE properties
  ADD CONSTRAINT properties_linen_onboarding_fee_nonneg
  CHECK (linen_onboarding_fee IS NULL OR linen_onboarding_fee >= 0);

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_linen_onboarding_sets_positive;
ALTER TABLE properties
  ADD CONSTRAINT properties_linen_onboarding_sets_positive
  CHECK (linen_onboarding_sets >= 1);

-- ---------------------------------------------------------------------------
-- Unit costs (Dzee contracted, per SET unless noted). Cost, not fee - markup
-- is applied on top via linen_markup_pct.
-- ---------------------------------------------------------------------------

INSERT INTO app_settings (key, value) VALUES
  -- Bed linens per set: fitted + flat + top sheet + pillowcases + that bed's
  -- towels. Full beds use queen bedding, so they read the queen rate.
  ('linen_set_king',         '48.02'),
  ('linen_set_queen',        '43.59'),
  ('linen_set_twin',         '29.21'),
  -- Bathroom linens per set.
  ('linen_set_full_bath',    '15.13'),
  ('linen_set_half_bath',    '2.32'),
  -- Duvet inserts, 2 per bed. Does not scale with the par level.
  ('linen_duvet_king',       '42.60'),
  ('linen_duvet_queen',      '40.82'),
  ('linen_duvet_twin',       '31.52'),
  -- Pool towels, 3 per guest, priced per guest. Included when the property has
  -- a hot tub or a pool; there is no separate pool-vs-hot-tub towel stock.
  ('linen_pool_towel_guest', '11.80'),
  -- Markup on the onboarding subtotal. Ships at cost; raise to add margin.
  ('linen_markup_pct',       '0'),
  -- Recurring program: replacement sets per bed per year.
  ('linen_recur_sets_year',  '2'),
  -- Per-set rate for beds with no size breakdown recorded. Portfolio-weighted
  -- average over the 148-bed reference set (67 king, 36 queen, 5 full, 40 twin).
  ('linen_blended_per_set',  '41.71')
ON CONFLICT (key) DO NOTHING;
