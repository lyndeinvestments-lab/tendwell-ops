-- Issues Tracker: treat Completed issues as already read.
--
-- Bug: issue_catchup_feed.is_unread flagged EVERY issue with no read-cursor
-- row as unread, so the header ("124 unread") and the Catch-up queue counted
-- all 113 completed issues even though only the ~11 open items actually need
-- attention. Completed work should never sit in the unread/Catch-up bucket.
--
-- Fix: a Completed issue is always is_unread = false, regardless of read
-- cursors or child-table activity. Open issues keep the original logic
-- (no cursor / explicitly marked unread / activity newer than the cursor).
create or replace view public.issue_catchup_feed
with (security_invoker = true) as
select
  ci.*,
  greatest(
    ci.updated_at,
    coalesce(lc.max_created, ci.updated_at),
    coalesce(lp.max_created, ci.updated_at)
  ) as activity_at,
  ir.last_read_at,
  coalesce(ir.marked_unread, false) as marked_unread,
  (
    ci.status <> 'Completed'
    and (
      ir.user_id is null
      or ir.marked_unread
      or greatest(
           ci.updated_at,
           coalesce(lc.max_created, ci.updated_at),
           coalesce(lp.max_created, ci.updated_at)
         ) > ir.last_read_at
    )
  ) as is_unread
from cleaning_issues ci
left join issue_reads ir
  on ir.issue_id = ci.id and ir.user_id = public.current_app_user_id()
left join (
  select issue_id, max(created_at) as max_created from issue_comments group by issue_id
) lc on lc.issue_id = ci.id
left join (
  select issue_id, max(created_at) as max_created from issue_photos group by issue_id
) lp on lp.issue_id = ci.id;

grant select on public.issue_catchup_feed to authenticated;
