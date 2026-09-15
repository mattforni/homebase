# Renders the sweep JSON into the Recruiter email, composed from the shared
# runner email design (runners/lib/email.jq). Invoked by entrypoint.sh as
#   jq -r -L <lib> --arg week ... --arg monday ... --arg sunday ... --arg meta ... -f render.jq sweep.json
# The pieces and the palette live in the library; this file only says which
# of the board's fields go where. The ledger is deliberately not here: it
# travels as a file beside the email (entrypoint.sh), since the Tuesday block
# appends it rather than reads it.

include "email";

def week_number: ($week | split("-W") | .[1] | tonumber | tostring);

def short_date($d): ($d | split("-") | .[1] + "/" + .[2]);

def shortlist:
  (.shortlist // []) as $s
  | eyebrow("Shortlist")
  + card(
      if ($s | length) == 0 then empty_row("Nothing cleared every filter this week.")
      else ([range(0; $s | length)] | map(
          $s[.] as $r
          | item($r.company; ($r.fit | tostring); [$r.role, $r.comp, $r.arrangement]; $r.why;
                 "what they do"; $r.about; "Posting"; $r.url; . == (($s | length) - 1))
        ) | join(""))
      end
    );

# The escape hatches, above the fold where they cannot be read past: a growth
# engineering title that missed a filter, a hub hybrid outlier. The accent
# value on the right is what the role missed, so the call is visible at a glance.
def flagged:
  (.flagged // []) as $f
  | if ($f | length) == 0 then ""
    else eyebrow("For your call")
      + card([range(0; $f | length)] | map(
          $f[.] as $r
          | item($r.company; ($r.missed // "flagged"); [$r.role, $r.comp, $r.arrangement]; $r.why;
                 ""; ""; "Posting"; $r.url; . == (($f | length) - 1))
        ) | join(""))
    end;

def fractional:
  (.fractional // []) as $f
  | eyebrow("Fractional lane")
  + card(
      (if ($f | length) == 0 then "<tr><td style=\"padding:22px 24px 20px;" + sans + "font-size:14px;color:" + dim + ";border-bottom:1px solid " + line + "\">No posted fractional role cleared the band this week.</td></tr>"
       else ($f | map(item(.company; (.rate // "Rate undisclosed"); [.role, .hours, .location]; .why; "detail"; .detail; ""; ""; false)) | join("")) end)
      + (if (.prospects // "") != "" then note("Prospects"; .prospects; false; ((.tradeoff // "") == "")) else "" end)
      + (if (.tradeoff // "") != "" then note("One tradeoff"; .tradeoff; true; true) else "" end)
    );

def dig_in:
  ((.rejected // []) | length) as $nr
  | eyebrow("If you want to dig in")
  + card(
      fold_row(big_fold("Considered and rejected"; ($nr | tostring);
        list(((.rejected // []) | map(lead_row(.company; "· " + .reason)) | join(""))
             + (if (.rejected_note // "") != "" then list_row("<span style=\"color:" + faint + "\">" + (.rejected_note | esc) + "</span>") else "" end); "13px")); false)
      + fold_row(big_fold("Source notes"; "";
        list(((.sources // []) | map(lead_row(.lead; .note)) | join("")); "14px")); true)
    );

page($week + " Recruiter"; (.preheader // "");
  masthead("Recruiter")
  + title_card("Week " + week_number + " · " + short_date($monday) + " to " + short_date($sunday);
               (.headline // []); (.lede // "");
               stats_row(stat((.shortlist // []) | length; "shortlisted")
                         + stat((.flagged // []) | length; "for your call")
                         + stat((.rejected // []) | length; "verified &amp; killed")))
  + shortlist
  + flagged
  + fractional
  + dig_in
  + footer($ARGS.named.meta // "")
)
