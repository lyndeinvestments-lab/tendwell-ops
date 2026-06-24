#!/usr/bin/env bash
# Nightly + on-demand Trellis → Supabase sync. Runs Claude Code headless with
# the trellis-sync skill (the only context that has the Trellis MCP servers).
set -euo pipefail
cd "$(dirname "$0")/.."
# cron runs with a minimal PATH — make `claude` (and node) resolvable.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
LOG="${TMPDIR:-/tmp}/trellis-sync-$(date +%Y%m%d-%H%M%S).log"
echo "[trellis-sync] start $(date)" >> "$LOG"
# Deterministic, LLM-free sync (fast: ~minutes, not hours). Reads the Trellis
# API keys from ~/.claude.json (trellis-workspace-a/b) and Supabase creds from
# the environment (set by the crontab line). Args (e.g. --nightly) pass through.
node scripts/trellis-sync-direct.mjs "$@" >> "$LOG" 2>&1
echo "[trellis-sync] done $(date)" >> "$LOG"
