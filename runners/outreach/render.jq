# Renders the outreach runner's status email from the agent's own result,
# composed from the shared runner email design (runners/lib/email.jq). The
# outreacher writes the roster into the Atelic repo and this email only says
# it did, so the draft here is the `claude -p` result itself rather than a
# JSON object the model was asked for. Invoked by the scaffold's runner_render as
#   jq -r -L <lib> --arg week ... --arg monday ... --arg sunday ... --arg meta ... -f render.jq result.json
# A failed run never reaches this file: the scaffold mails the shared failure
# page instead. Replaced the three bash builders that lived in runner.sh
# (ATE-543, 2026-09-15).

include "email";

def week_number: ($week | split("-W") | .[1] | tonumber | tostring);

def short_date($d): ($d | split("-") | .[1] + "/" + .[2]);

def duration:
  if .duration_ms == null then "n/a"
  else (.duration_ms / 1000 | floor) as $s
    | (if $s < 60 then "\($s)s"
       elif $s < 3600 then "\($s / 60 | floor)m \($s % 60 | tostring | if length < 2 then "0" + . else . end)s"
       else "\($s / 3600 | floor)h \(($s % 3600) / 60 | floor | tostring | if length < 2 then "0" + . else . end)m" end)
  end;

def cost: if .total_cost_usd == null then "n/a" else "$" + (.total_cost_usd * 100 | round / 100 | tostring) end;

(.result // "") as $text
| ($text | split("\n") | map(select(. != ""))) as $lines
| ($lines[0] // "The roster is built.") as $first
| page($week + " Outreach"; $first;
    masthead("Outreach")
    + title_card("Outreach · " + short_date($monday) + " to " + short_date($sunday);
                 ["Week " + week_number + " roster,", "built."]; $first;
                 stats_row(stat(duration; "wall clock") + stat(cost; "cost") + stat((.num_turns // "?"); "turns")))
    + eyebrow("What the agent said")
    + card(
        row(big_fold("Full output"; (($lines | length | tostring) + " lines");
            "<pre style=\"" + mono + "font-size:12px;line-height:1.5;white-space:pre-wrap;color:" + dim + ";margin:12px 0 0\">" + ($text | esc) + "</pre>"); true)
      )
    + footer($ARGS.named.meta // "")
  )
