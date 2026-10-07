# shellcheck shell=bash
# Shared plumbing for bin/review/*: the findings schema the Claude reviewer
# fills, the state directory, the scorecard append, and the normalisers that
# turn each reviewer's raw output into the one JSONL stream the lander parses.
#
# The rules (when a review runs, which reviewer gates, how findings are
# triaged) live in plugins/sdlc/reference/code-review.md. This file is
# mechanism only.

REVIEW_STATE="${REVIEW_STATE:-$HOME/.local/state/review}"
REVIEW_SCORECARD="$REVIEW_STATE/scorecard.tsv"
REVIEW_HEADER=$'ts\tkind\trepo\tpr\tsha\treviewer\tran\treason\tfindings\tfixed\tdeclined\theld_min\tseconds'

die() { echo "${0##*/}: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required and not on PATH"; }

review_state_dir() {
  mkdir -p "$REVIEW_STATE/runs" || die "cannot create $REVIEW_STATE"
  # Raw reviewer output is kept for forensics, not forever.
  find "$REVIEW_STATE/runs" -type f -mtime +14 -delete 2>/dev/null || true
  printf '%s' "$REVIEW_STATE"
}

# Append one TSV row, writing the header on first touch.
# Args, in column order after ts: kind repo pr sha reviewer ran reason findings
# fixed declined held_min seconds. Tabs inside a value become spaces.
scorecard_append() {
  review_state_dir >/dev/null
  [[ -s "$REVIEW_SCORECARD" ]] || printf '%s\n' "$REVIEW_HEADER" >"$REVIEW_SCORECARD"
  local row field
  row=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for field in "$@"; do field="${field//$'\t'/ }"; field="${field//$'\n'/ }"; row+=$'\t'"${field//$'\r'/ }"; done
  printf '%s\n' "$row" >>"$REVIEW_SCORECARD"
}

# The shape the Claude reviewer is asked to return, appended to the system
# prompt of the headless run. The severity is the model's call; the normaliser
# falls back to a rule (major when a failure scenario is given, else minor)
# only when a finding arrives without one. Read by bin/review/run.
# shellcheck disable=SC2034
REVIEW_SHAPE_PROMPT='Report the review findings as your entire final reply: one JSON array, no prose before or after it, no code fence. Each element has exactly these keys: "file" (repo relative path), "line" (integer), "summary" (one sentence), "failure_scenario" (concrete inputs or state and the wrong outcome), "severity" (one of "critical", "major", "minor", "info": critical or major when the scenario breaks behaviour, loses or corrupts data, leaks a secret, or contradicts a documented rule the diff was meant to follow; minor for a correctness nit; info for reuse, simplification, or efficiency). An empty array means no findings.'

# normalise_claude <raw.json> <rc> <sha> <seconds> <files>
# Prints finding lines then exactly one complete line for the claude reviewer.
# raw.json is the --output-format json document from a headless run. Three
# shapes are accepted: structured_output.findings (the schema applied), a JSON
# array in the result text (optionally fenced), and anything else, which is
# reported as ran:false with the first 200 characters as the reason.
normalise_claude() {
  local raw="$1" rc="${2:-0}" sha="$3" seconds="${4:-0}" files="${5:-0}"
  if ! jq -e . "$raw" >/dev/null 2>&1; then
    jq -cn --arg sha "$sha" --argjson secs "$seconds" --argjson files "$files" \
      --arg reason "no json output (rc $rc): $(head -c 200 "$raw" 2>/dev/null | tr '\n' ' ')" \
      '{type:"complete",reviewer:"claude",ran:false,reason:$reason,findings:0,sha:$sha,seconds:$secs,files:$files}'
    return 0
  fi
  jq -c --arg sha "$sha" --argjson rc "$rc" --argjson secs "$seconds" --argjson files "$files" '
    def complete(ran; reason; n):
      {type:"complete", reviewer:"claude", ran:ran, reason:reason, findings:n, sha:$sha, seconds:$secs, files:$files};
    def finding(sev):
      {type:"finding", reviewer:"claude",
       severity:((.severity // sev) as $s | if (["critical","major","minor","info"] | index($s)) != null then $s else "major" end),
       fileName:(.file // .fileName // ""),
       line:(.line // null),
       summary:(.summary // ""),
       failure_scenario:(.failure_scenario // "")};
    def fallback_sev: if ((.failure_scenario // "") | length) > 0 then "major" else "minor" end;
    def unfence: tostring | gsub("^\\s*```(json)?\\s*"; "") | gsub("\\s*```\\s*$"; "");
    # The findings array is accepted in two forms only: the whole reply
    # (optionally fenced), or one fenced json block inside prose. A bare
    # bracket fragment inside prose is not one, and an array holding anything
    # but objects is not one either: both fall through to ran:false, because a
    # prose reply normalised to "zero findings" would be a gate that fails open.
    def objects_only: if (type == "array") and (all(.[]; type == "object")) then . else null end;
    def arr: (unfence | try fromjson catch null | objects_only) as $a
      | if $a != null then $a
        else ((tostring | capture("```(json)?\\s*(?<a>\\[[\\s\\S]*?\\])\\s*```").a? // "")
              | try fromjson catch null | objects_only) end;
    if (.is_error // false) or $rc != 0 then
      complete(false; ((.result // "error") | tostring | gsub("\\s+"; " ") | .[0:200]); 0)
    elif ((.structured_output.findings? // null) | type) == "array" then
      (.structured_output.findings | map(select(type == "object") | finding("major"))) as $f
      | ($f[]), complete(true; ""; ($f | length))
    elif (((.result // "") | arr) | type) == "array" then
      (((.result // "") | arr) | map(select(type == "object") | finding(fallback_sev))) as $f
      | ($f[]), complete(true; ""; ($f | length))
    else
      complete(false; ("unparseable output: " + ((.result // "") | tostring | gsub("\\s+"; " ") | .[0:200])); 0)
    end' "$raw"
}

# normalise_coderabbit <raw.jsonl> <sha> <seconds> <files>
# Passes finding lines through with reviewer:coderabbit and emits one complete
# line. The stream is clean only when its own complete line arrived; a stream
# that stopped short (rate limit, WebSocket drop) is ran:false with the error
# line's message as the reason.
normalise_coderabbit() {
  local raw="$1" sha="$2" seconds="${3:-0}" files="${4:-0}"
  jq -cs --arg sha "$sha" --argjson secs "$seconds" --argjson files "$files" '
    def complete(ran; reason; n):
      {type:"complete", reviewer:"coderabbit", ran:ran, reason:reason, findings:n, sha:$sha, seconds:$secs, files:$files};
    # The CLI puts the actual comment inside codegenInstructions, after a
    # boilerplate paragraph and a "Review comment at @<file> at line <n>:"
    # header; the line number lives nowhere else.
    def body: (.codegenInstructions // "") | tostring
      | (capture("at line (?<n>[0-9]+):\\s*(?<text>[\\s\\S]*)$") // {n: null, text: .});
    (map(select(.type == "finding")) | map(body as $b | {
       type:"finding", reviewer:"coderabbit",
       severity:(.severity // "minor"),
       fileName:(.fileName // .file // ""),
       line:(.lineRange.start // .line // ($b.n | if . == null then null else tonumber end)),
       summary:((.summary // .description // .message // .comment // $b.text) | tostring | gsub("\\s+"; " ") | .[0:400]),
       failure_scenario:""})) as $f
    | (map(select(.type == "complete")) | first) as $done
    | (map(select(.type == "error")) | first) as $err
    | ($f[]),
      (if $done != null then complete(true; ""; ($done.findings // ($f | length)))
       else complete(false; ("stream stopped before complete"
                             + (if $err != null then ": " + (($err.message // "") | tostring)
                                  + (if ($err.metadata.waitTime // "") != "" then " (wait " + ($err.metadata.waitTime|tostring) + ")" else "" end)
                                else "" end)); 0)
       end)' "$raw" 2>/dev/null \
  || jq -cn --arg sha "$sha" --argjson secs "$seconds" --argjson files "$files" \
       '{type:"complete",reviewer:"coderabbit",ran:false,reason:"unreadable stream",findings:0,sha:$sha,seconds:$secs,files:$files}'
}
