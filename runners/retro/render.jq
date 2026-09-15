# Renders the retro JSON into the Retro email, composed from the shared runner
# email design (runners/lib/email.jq). Invoked by the scaffold's runner_render as
#   jq -r -L <lib> --arg week ... --arg monday ... --arg sunday ... --arg meta ... -f render.jq retro.json
# The pieces and the palette live in the library; this file only says which
# of the draft's fields go where. The 2026-08-27 Geist on cream template this
# replaced (ATE-543, 2026-09-15) had its own palette, frame and grid helpers;
# a phone read them badly, and every runner reading the same way in the inbox
# is worth more than the grids.

include "email";

def week_number: ($week | split("-W") | .[1] | tonumber | tostring);

def short_date($d): ($d | split("-") | .[1] + "/" + .[2]);

# HubSpot shouts its own vocabulary (NOT_A_FIT) and the week's kinds arrive
# lowercase. Both read as English here: split on underscores and spaces,
# capitalize every word, and leave the small words lower unless they lead.
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

# rows through a row filter, which reads {r, last} as its input: the record
# and whether it closes the card. (A jq filter parameter takes no arguments
# of its own, which is why the pair travels as the input.)
def items(rows; f):
  rows as $rows
  | ($rows | length) as $n
  | [range(0; $n)] | map({r: $rows[.], last: (. == ($n - 1))} | f) | join("");

# A session: the name, the duration on the right (the one fact every session
# has), the day and the other facts on the subline. The detail arrives as one
# comma joined string of two to four facts.
def session:
  .r as $r | .last as $last |
  (($r.detail // "") | tostring | split(", ")) as $facts
  | ([$facts[] | select(endswith(" min"))] | first // "") as $minutes
  | item($r.session; $minutes; [$r.day] + [$facts[] | select(endswith(" min") | not)]; ""; ""; ""; ""; ""; $last);

def takeout:
  .r as $r | .last as $last |
  item($r.vehicle; $r.day; []; ""; ""; ""; ""; ""; $last);

def coverage_table(rows; $first):
  mono_table([$first, "Logged", "Target"]; rows | map([.[0], (.[1] | tostring), (.[2] | tostring)]));

# A deal: the company, the total on the right, the stage and the money on the
# subline. Seven figures on one line was the row a phone could not show;
# middots wrap where a table column cannot.
def deal:
  .r as $r | .last as $last |
  item($r.company; ($r.total // ""); [$r.stage, "Build " + ($r.build // "-"), "Operate " + ($r.operate // "-"), "Trade " + ($r.trade // "-"), "Cash " + ($r.cash // "-")]; ""; ""; ""; ""; ""; $last);

# A lead: the company, whether it replied on the right, then status (with the
# disqualification reason under it when there is one), kind, and touches.
def lead:
  .r as $r | .last as $last |
  item($r.company; (if $r.replied == "yes" then "Replied" else "No reply" end);
       [($r.status | titlecase) + (if ($r.reason // "") != "" then ", " + ($r.reason | titlecase) else "" end),
        ($r.kind | titlecase),
        (($r.touches | tostring) + (if ($r.touches | tostring) == "1" then " touch" else " touches" end))];
       ""; ""; ""; ""; ""; $last);

def lead_card($heading; rows; $empty):
  eyebrow($heading)
  + card(if (rows | length) == 0 then empty_row($empty) else items(rows; lead) end);

page($week + " Retro"; (.headline // "");
  masthead("Retro")
  + title_card("Retro · " + short_date($monday) + " to " + short_date($sunday);
               ["Week " + week_number + "."]; (.headline // "");
               stats_row(stat((.movement // []) | length; "sessions")
                         + stat((.takeout // []) | length; "takeout orders")
                         + stat((.atelic.totals.sends // 0); "atelic sends")))

  + eyebrow("Movement")
  + card(
      (if ((.movement // []) | length) == 0 then empty_row("Nothing logged in Strava this week.")
       else items((.movement // []); session) end)
      + row(coverage_table((.coverage // []) | map([.modality, .logged, .target]); "Modality"); false)
      + note("The read"; (.movement_read // ""); false; true)
    )

  + eyebrow("Overconsumption")
  + card(
      (if ((.takeout // []) | length) == 0 then empty_row("No takeout orders this week.")
       else items((.takeout // []); takeout) end)
      + note("The read"; (.takeout_read // ""); false; true)
    )

  + eyebrow("Atelic · deals")
  + card(if ((.atelic.opportunities // []) | length) == 0 then empty_row("No deal moved this week.")
         else items((.atelic.opportunities // []); deal) end)
  + lead_card("Atelic · open leads"; (.atelic.open_leads // []); "No lead was touched this week.")
  + lead_card("Atelic · closed leads"; (.atelic.closed_leads // []); "Nothing closed this week.")
  + eyebrow("Atelic · the week")
  + card(
      row(coverage_table((.atelic.coverage // []) | map([.measure, .logged, .target]); "Measure"); false)
      + note("The read"; (.atelic_read // ""); false; true)
    )

  + eyebrow("Blind spots")
  + card(empty_row(.blind_spots // ""))

  + footer($ARGS.named.meta // "")
)
