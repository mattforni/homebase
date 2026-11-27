#!/bin/bash
# artifact-cleanup.sh
#
# PostToolUse(Artifact) hook. A page published for one decision (a comparison,
# a triage board, a side by side) is deleted by the session that made it once
# the decision lands, so nothing floats in Forni's gallery. The rule lives in
# ~/Eudaimonia/Admin/Tools/Claude/design.md, and Forni's standing ask is what
# lets a session delete such a page without being asked each time. This hook
# surfaces the rule the moment a page is born, carrying its link, since a
# prose rule read hours earlier gets dropped. Forni cleaned up two leftover
# decision pages by hand on 2026-11-26 (ATE-847) and asked for this.
#
# It never blocks; it only adds context. It fires only when the publish result
# reports Version 1 of a page, so a republish of the same file, a read, a list,
# a delete, an asset upload, and a page made from an Artifact type (a deck, a
# dashboard, a design: durable by nature) all stay quiet.
#
# Input:  hook JSON on stdin with .tool_input and .tool_response.
# Output: JSON on stdout with hookSpecificOutput.additionalContext, or nothing.

set -euo pipefail

HOOK_INPUT=$(cat)

# One jq pass: the action, whether it was a typed create or an asset upload,
# and the publish result's text, flattened to one line.
read -r ACTION TYPED ASSET < <(printf '%s' "$HOOK_INPUT" | jq -r '[
  (.tool_input.action // "publish"),
  ((.tool_input.type_url // "") != ""),
  (.tool_input.asset // false)
] | @tsv' 2>/dev/null || echo "none false false")

if [[ "$ACTION" != "publish" || "$TYPED" == "true" || "$ASSET" == "true" ]]; then
  exit 0
fi

RESULT=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_response | if type == "string" then . else tostring end' 2>/dev/null | tr '\n' ' ' || true)

if [[ "$RESULT" != *"(Version 1,"* ]]; then
  exit 0
fi

URL=$(printf '%s' "$RESULT" | grep -oE 'https://claude\.ai/(code/)?artifact/[A-Za-z0-9-]+' | head -n 1 || true)

jq -n --arg url "${URL:-the page just published}" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("If " + $url + " exists for one decision (a comparison, a triage board, a side by side), delete it with the Artifact tool in the same turn the decision is made; Forni asked for this standing, so nothing is left in his gallery. A page he will reopen stays (~/Eudaimonia/Admin/Tools/Claude/design.md).")
  }
}'
