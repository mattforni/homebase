# Renders the retro JSON into the Retro email, composed from the shared runner
# email design (runners/lib/email.jq). Invoked by the scaffold's runner_render as
#   jq -r -L <lib> --arg week ... --arg monday ... --arg sunday ... --arg meta ... -f render.jq retro.json
# and again with --arg format text for the plain text part, which is built
# here rather than left to Resend: its own conversion ran labels and numbers
# together ("12 sessions0 takeout orders14 atelic sends", W38).
#
# The shape is Forni's "W38 Retro Email" in Claude Design (project e4f18590,
# 2026-09-21): an overview card holding every target at a glance and what
# moved, then one card per area, each opening on its read. The sessions and
# the day strip are built from strava.json here, never from the model, so the
# only numbers the model supplies are the graded coverage counts.

include "email";

def fmt: $ARGS.named.format // "html";
def week_number: ($week | split("-W") | .[1] | tonumber | tostring);

# ---------- words and dates ----------

def word: ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"] as $w
  | if . >= 0 and . <= 10 then $w[.] else tostring end;

# HubSpot shouts its own vocabulary (NOT_A_FIT) and the model writes sentence
# case ("Social runs"). Both read as Title Case here.
def titlecase:
  ["a", "an", "the", "of", "in", "to", "for", "by"] as $small
  | (tostring | gsub("_"; " ") | split(" "))
  | to_entries
  | map(
      (.value | ascii_downcase) as $w
      | if $w == "" then ""
        elif (.key > 0) and (($small | index($w)) != null) then $w
        else ($w[0:1] | ascii_upcase) + ($w[1:])
        end)
  | join(" ");

def day_of($iso): ($iso[0:10] + "T00:00:00Z" | fromdate | strftime("%a"));
def range_line: ($monday + "T00:00:00Z" | fromdate) as $m
  | (($m | strftime("%a")) + ", " + $monday + " to " + (($m + 6 * 86400) | strftime("%a")) + ", " + $sunday);

def num: if type == "number" then . else (tostring | tonumber? // 0) end;

# ---------- the week, derived ----------

# Strava's sport types in the words the week is graded in.
def kind:
  {"Run": "Run", "TrailRun": "Run", "VirtualRun": "Run", "WeightTraining": "Lift", "Yoga": "Yoga",
   "RockClimbing": "Climb", "Walk": "Walk", "Hike": "Hike", "Ride": "Ride", "Swim": "Swim"}[.sport_type // ""]
  // (.sport_type // "Session");

# The same test the prompt grades by: a run Strava matched other athletes into,
# or one whose name says who it was with.
def social:
  kind == "Run" and (((.athlete_count // 1) >= 2) or ((.name // "") | test("diego|drc|sprc"; "i")));

# Session names lose their leading emoji; the table is for reading.
def clean_name: (.name // "") | gsub("^[^A-Za-z0-9'\"(]+"; "");

def sessions:
  (.strava // []) | sort_by(.start_date_local)
  | map({day: day_of(.start_date_local), date: .start_date_local[0:10], name: clean_name, kind: kind, social: social,
         minutes: (.moving_min // 0), miles: (if (.distance_mi // 0) > 0 then .distance_mi else null end)});

def days($sessions):
  ($monday + "T00:00:00Z" | fromdate) as $m
  | [range(0; 7)] | map(($m + . * 86400) as $t | ($t | strftime("%Y-%m-%d")) as $d
      | {label: ($t | strftime("%a")),
         entries: [$sessions[] | select(.date == $d) | {name: .kind, strong: .social, badge: (if .social then "S" else "" end)}]});

def two: . * 100 | round / 100 | tostring | if test("\\.") then (if test("\\.[0-9]$") then . + "0" else . end) else . + ".00" end;

# Every target the week is graded on: the model's coverage (with its note),
# takeout as a bare count, and the outreach measures from HubSpot.
def movement_targets:
  [(.coverage // [])[] | {label: (.modality | titlecase), logged: (.logged | num), target: (.target | num), note: (.note // "")}];
def takeout_target:
  ((.takeout // []) | length) as $n
  | {label: "Takeout", logged: $n, target: null,
     note: (if $n == 0 then "No confirmed orders" else ((.takeout // []) | map(.day + " " + .vehicle) | join(" · ")) end)};
def atelic_targets:
  [(.atelic.coverage // [])[] | {label: (.measure | titlecase), logged: (.logged | num), target: (.target | num)}
   | . + {note: (if .logged >= .target then "Target met" else ((.target - .logged) | word) + " short" end)}];

def graded: movement_targets + atelic_targets;
def verdict: (graded | length) as $n | ([graded[] | select(.logged >= .target)] | length) as $hit
  | if $n == 0 then "No targets graded." else ($hit | word) + " of " + ($n | word | ascii_downcase) + " targets hit." end;

# ---------- atelic rows ----------

def opp_rows: (.atelic.opportunities // []) | map([
  {value: .company},
  (if (.stage // "-") == "-" then {value: "No stage set", muted: true} else {value: .stage, hot: (.stage == "Closed Lost")} end),
  {value: (if (.cash // "-") == "-" then "" else .cash end), mono: true}]);
def lead_rows: (.atelic.open_leads // []) | map([
  {value: .company}, {value: (.status | titlecase)}, {value: (.kind | titlecase)},
  {value: (.touches | tostring), mono: true}, {value: (if .replied == "yes" then "Yes" else "" end)}]);
def closed_rows: (.atelic.closed_leads // []) | map([
  {value: .company}, {value: (.status | titlecase), hot: true}, {value: ((.reason // "-") | if . == "-" then "" else titlecase end)}]);

def opp_cols: [{label: "Company"}, {label: "Stage", right: true}, {label: "Cash", right: true}];
def lead_cols: [{label: "Company"}, {label: "Status", right: true}, {label: "Last Touch", right: true}, {label: "Touches", right: true}, {label: "Replied", right: true}];
def closed_cols: [{label: "Company"}, {label: "Outcome", right: true}, {label: "Reason", right: true}];

# ---------- html ----------

def html_sessions($s):
  records([{label: "Day"}, {label: "Session"}, {label: "Type", right: true}, {label: "Min", right: true}, {label: "Mi", right: true}];
    ($s | map([{value: .day, mono: true, muted: true}, {value: .name},
               {value: .kind, html: ((.kind | esc) + (if .social then badge("S") else "" end))},
               {value: (.minutes | tostring), mono: true}, {value: (if .miles then (.miles | two) else "" end), mono: true}]))
    + [[{value: ""}, {value: "Total"}, {value: ""}, {value: ([$s[].minutes] | add // 0 | tostring), mono: true},
        {value: ([$s[] | .miles // 0] | add // 0 | two), mono: true}]]);

def html_records_block($title; $cols; $rows; $last):
  if ($rows | length) == 0 then "" else
    sub_eyebrow($title)
    + "<tr><td style=\"padding:0 24px " + (if $last then "22px" else "18px;border-bottom:1px solid " + line end) + "\">" + records($cols; $rows) + "</td></tr>"
  end;

def html_page:
  sessions as $s
  | page($week + " Retro"; (.headline // "");
    masthead("Retro · Week " + week_number)
    + title_card(range_line; [verdict]; (.headline // "");
        scoreboard(
          group_row("Movement"; true)
          + ((movement_targets + [takeout_target]) as $t | [range(0; $t | length)] | map($t[.] as $r | target_row($r.label; $r.logged; $r.target; $r.note; . == ($t | length) - 1)) | join(""))
          + (atelic_targets as $t | if ($t | length) == 0 then "" else group_row("Atelic"; false)
              + ([range(0; $t | length)] | map($t[.] as $r | target_row($r.label; $r.logged; $r.target; $r.note; . == ($t | length) - 1)) | join("")) end))
        + (if ((.what_moved // []) | length) > 0 or (.what_moved_note // "") != ""
           then what_moved(.what_moved // []; .what_moved_note // "") else "<tr><td style=\"padding:0 0 26px\"></td></tr>" end))

    + eyebrow("Movement")
    + card(
        read_block(.movement_read // ""; true)
        + sub_eyebrow("By Day") + day_strip(days($s); false)
        + sub_eyebrow("Sessions · " + ($s | length | tostring))
        + (if ($s | length) == 0 then empty_row("Nothing logged in Strava this week.")
           else "<tr><td style=\"padding:0 24px 20px\">" + html_sessions($s) + "</td></tr>" end))

    + eyebrow("Takeout")
    + card(read_block(.takeout_read // ""; false))

    + eyebrow("Atelic")
    + card(
        read_block(.atelic_read // ""; true)
        + row(stat_strip([{n: ((.atelic.opportunities // []) | length), label: "Deals"},
                          {n: ((.atelic.open_leads // []) | length), label: "Open Leads"},
                          {n: ((.atelic.closed_leads // []) | length), label: "Closed"}]); false)
        + html_records_block("Deals · " + ((.atelic.opportunities // []) | length | tostring); opp_cols; opp_rows; false)
        + html_records_block("Open Leads · " + ((.atelic.open_leads // []) | length | tostring); lead_cols; lead_rows; false)
        + html_records_block("Closed · " + ((.atelic.closed_leads // []) | length | tostring); closed_cols; closed_rows; true))

    + eyebrow("Blind Spots")
    + card(read_block(.blind_spots // ""; false))

    + footer($ARGS.named.meta // ""));

# ---------- plain text ----------

def cells: map(map(.value // ""));

def text_page:
  sessions as $s
  | "ATELIC · RETRO · WEEK " + week_number + "\n" + range_line + "\n\n"
  + (verdict | ascii_upcase) + "\n\n" + ((.headline // "") | wrap | gsub("(?m)^  "; "")) + "\n\n\n"
  + "SCOREBOARD\n\nMovement\n" + ((movement_targets + [takeout_target]) | map(text_target) | join("\n")) + "\n"
  + (atelic_targets as $t | if ($t | length) == 0 then "" else "\nAtelic\n" + ($t | map(text_target) | join("\n")) + "\n" end)
  + (if ((.what_moved // []) | length) > 0 or (.what_moved_note // "") != ""
     then "\nWhat Moved\n" + ((.what_moved // []) | map("  " + .subject + " " + .event) | join("\n"))
       + (if (.what_moved_note // "") != "" then "\n  " + .what_moved_note else "" end) + "\n" else "" end)

  + text_section("Movement") + text_read(.movement_read // "")
  + "\nBy Day\n" + (days($s) | map("  " + (.label | rpad(5)) + (.entries | map(.name + (if .strong then " (S)" else "" end)) | join(" · ") | if . == "" then "Rest" else . end)) | join("\n")) + "\n"
  + "\nSessions · " + ($s | length | tostring) + "\n"
  + (if ($s | length) == 0 then "  Nothing logged in Strava this week." else
      text_table(["Day", "Session", "Type", "Min", "Mi"];
        ($s | map([.day, .name, .kind + (if .social then " (S)" else "" end), (.minutes | tostring), (if .miles then (.miles | two) else "" end)]))
        + [["", "Total", "", ([$s[].minutes] | add // 0 | tostring), ([$s[] | .miles // 0] | add // 0 | two)]]; [3, 4]) end) + "\n"

  + text_section("Takeout") + text_read(.takeout_read // "")

  + text_section("Atelic") + text_read(.atelic_read // "")
  + (opp_rows | if length == 0 then "" else "\nDeals · " + (length | tostring) + "\n" + text_table(opp_cols | map(.label); cells; [2]) + "\n" end)
  + (lead_rows | if length == 0 then "" else "\nOpen Leads · " + (length | tostring) + "\n" + text_table(lead_cols | map(.label); cells; [3]) + "\n" end)
  + (closed_rows | if length == 0 then "" else "\nClosed · " + (length | tostring) + "\n" + text_table(closed_cols | map(.label); cells; []) + "\n" end)

  + text_section("Blind Spots") + text_read(.blind_spots // "")
  + "\n\n" + ($ARGS.named.meta // "") + "\n";

if fmt == "text" then text_page else html_page end
