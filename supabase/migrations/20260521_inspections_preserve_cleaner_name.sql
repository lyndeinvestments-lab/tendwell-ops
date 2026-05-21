-- ═══════════════════════════════════════════════════════════════════════════════
-- Preserve cleaner name on inspections even after the cleaner is deleted.
-- ═══════════════════════════════════════════════════════════════════════════════
-- `inspections.cleaner_id` is `ON DELETE SET NULL`, so removing a cleaner from
-- the roster nulls the FK on every past inspection and the UI then falls back
-- to `inspected_by` ("ops-user" — the automated import actor, not the cleaner).
--
-- Snapshot the cleaner's full_name on each inspection row so that history
-- survives roster cleanup. Populated automatically by a trigger on insert /
-- when cleaner_id changes; backfilled here for existing rows.

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS cleaner_name text;

CREATE OR REPLACE FUNCTION public.inspection_snapshot_cleaner_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only refresh the snapshot when the FK is set and either the row is new,
  -- the cleaner changed, or the snapshot is currently empty. We never blank
  -- out an existing snapshot just because cleaner_id is being cleared — that
  -- is the whole point of keeping the historical name.
  IF NEW.cleaner_id IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NEW.cleaner_id IS DISTINCT FROM OLD.cleaner_id
       OR NEW.cleaner_name IS NULL
     ) THEN
    SELECT c.full_name INTO NEW.cleaner_name
    FROM public.cleaners c
    WHERE c.id = NEW.cleaner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inspections_snapshot_cleaner_name ON public.inspections;

CREATE TRIGGER inspections_snapshot_cleaner_name
  BEFORE INSERT OR UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.inspection_snapshot_cleaner_name();

-- Backfill snapshot from current cleaners join. Rows whose cleaner has
-- already been deleted (cleaner_id IS NULL) cannot be recovered — their
-- cleaner_name stays NULL and the UI shows "Cleaner not recorded".
UPDATE public.inspections i
SET cleaner_name = c.full_name
FROM public.cleaners c
WHERE i.cleaner_id = c.id
  AND (i.cleaner_name IS NULL OR i.cleaner_name = '');
