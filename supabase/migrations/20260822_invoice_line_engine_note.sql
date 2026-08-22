-- Engine-written plain-English explanation of WHY a line is flagged
-- ("Billed $240.00 — $35.00 above the Ops Cleaner Pay rate of $205.00").
-- The review UI shows it next to the flag badges so a reviewer doesn't have
-- to know every property's rate by heart. Written by the reconciliation
-- engine on every rebuild; distinct from review_note, which is the HUMAN's
-- note entered in the review dialog.
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS engine_note TEXT;
