#!/usr/bin/env bash
# Nightly + on-demand Trellis → Supabase sync. Runs Claude Code headless with
# the trellis-sync skill (the only context that has the Trellis MCP servers).
set -euo pipefail
cd "$(dirname "$0")/.."
# cron runs with a minimal PATH — make `claude` (and node) resolvable.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
LOG="${TMPDIR:-/tmp}/trellis-sync-$(date +%Y%m%d-%H%M%S).log"
echo "[trellis-sync] start $(date)" >> "$LOG"
# Tool permissions for this unattended run come from .claude/settings.local.json
# (a scoped allowlist of the trellis + supabase MCP tools) — not a blanket
# --dangerously-skip-permissions. Keep that file in place on this machine.
claude -p "Use the trellis-sync skill to run a full Trellis→Supabase sync now. Work strictly sequentially: one MCP call at a time, small pages, upsert each page before the next. Do not spawn sub-agents." >> "$LOG" 2>&1
echo "[trellis-sync] done $(date)" >> "$LOG"
