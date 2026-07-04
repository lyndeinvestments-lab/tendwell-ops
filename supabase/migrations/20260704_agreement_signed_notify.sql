-- Notify admins by email when an owner signs their service agreement.
-- Adds the per-user preference toggle; the event itself is sent server-side
-- from api/agreements/sign.ts via the shared notify pipeline
-- (EVENT_VIEW_REQUIREMENT maps agreement_signed -> 'settings', i.e. admins).
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_agreement_signed BOOLEAN NOT NULL DEFAULT true;
