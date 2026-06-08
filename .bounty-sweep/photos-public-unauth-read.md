# Finding: property-photos storage bucket readable by unauthenticated users

Severity: MEDIUM
File: supabase/migrations/20260602b_property_photos_bucket.sql
Lines: 15-20

The `property_photos_public_read` policy on `storage.objects` uses `TO public`,
allowing any unauthenticated user to read property photos if they know the
object path. Property management photos can include sensitive security content.

Detected by weekly-bounty-sweep. Base: 052ade4c → HEAD: 68f41e39
