#!/bin/bash
# artifact-cleanup.sh
#
# PostToolUse(Artifact) hook. A page published for one decision (a comparison,
# a triage board, a side by side) is deleted by the session that made it once
# the decision lands, so nothing floats in Forni's gallery. The rule lives in
# ~/Eudaimonia/Admin/Tools/Claude/design.md; this hook surfaces it at the
# moment a page is born, since a prose rule read hours earlier gets dropped.
# Forni cleaned up two leftover decision pages by hand on 2026-11-26 (ATE-847)
# and asked for this.
#
# Non-blocking: it only adds context. It fires on a first publish of a page
# (no `url`, no asset upload) and stays quiet on redeploys, reads, lists,
# deletes, and every other action.
#
# Input:  hook JSON on stdin with .tool_input (the Artifact call's input).
# Output: JSON on stdout with hookSpecificOutput.additionalContext, or nothing.

set -euo pipefail

HOOK_INPUT=$(cat)

ACTION=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.action // "publish"' 2>/dev/null || echo "")
URL=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.url // empty' 2>/dev/null || echo "")
ASSET=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.asset // false' 2>/dev/null || echo "false")

if [[ "$ACTION" != "publish" || -n "$URL" || "$ASSET" == "true" ]]; then
  exit 0
fi

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: "If this page exists for one decision (a comparison, a triage board, a side by side), delete it with the Artifact tool in the same turn the decision is made, so nothing is left in the gallery. Pages Forni will reopen stay (~/Eudaimonia/Admin/Tools/Claude/design.md)."
  }
}'
