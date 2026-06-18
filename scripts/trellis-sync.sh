#!/usr/bin/env bash
# Nightly + on-demand Trellis → Supabase sync. Runs Claude Code headless with
# the trellis-sync skill (the only context that has the Trellis MCP servers).
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="${TMPDIR:-/tmp}/trellis-sync-$(date +%Y%m%d-%H%M%S).log"
echo "[trellis-sync] start $(date)" >> "$LOG"
claude -p "Use the trellis-sync skill to run a full Trellis→Supabase sync now." >> "$LOG" 2>&1
echo "[trellis-sync] done $(date)" >> "$LOG"
