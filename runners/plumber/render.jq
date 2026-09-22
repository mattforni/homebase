# Renders the plumber's JSON summary into the Pipeline email, composed from
# the shared runner email design (runners/lib/email.jq). Invoked by the
# scaffold's runner_render as
#   jq -r -L <lib> --arg week ... --arg monday ... --arg sunday ... --arg meta ... -f render.jq plumber.json
# The pieces and the palette live in the library; this file only says which
# of the summary's fields go where. The roster is deliberately not here: it
# travels as a file beside the email, since the block reads it in the repo.

include "email";

def week_number: ($week | split("-W") | .[1] | tonumber | tostring);

def short_date($d): ($d | split("-") | .[1] + "/" + .[2]);

def link($text; $url):
  if ($url // "") == "" then ($text | esc)
  else "<a href=\"" + ($url | esc) + "\" style=\"color:" + ink + ";text-decoration:underline;text-decoration-color:" + accent + "\">" + ($text | esc) + "</a>" end;

def target_of($type): ((.scoreboard // []) | map(select(.type == $type)) | .[0].target // 0);

# The weekly scoreboard as the roster carries it, Complete at zero on the day
# it is built, then one list per type of everyone still owed that touch.
def board:
  (.scoreboard // []) as $rows
  | ($rows | map(.target // 0) | add // 0) as $total
  | eyebrow("The board")
  + card(
      row(mono_table(["Type", "Complete", "Target", "%", "Details"];
            ($rows | map([.type, "0", (.target // 0 | tostring), "0", (.details // "")]))
            + [["Total", "0", ($total | tostring), "0", ""]]); false)
      + ((.checklist // []) | map(select((.names // []) | length > 0)) as $lists
         | if ($lists | length) == 0 then row("<span style=\"font-size:14px;color:" + dim + "\">Nobody is owed a touch this week.</span>"; true)
           else ([range(0; $lists | length)] | map(
             $lists[.] as $l
             | row("<b style=\"" + sans + "font-size:14px;color:" + ink + ";font-weight:600\">" + ($l.type | esc) + "</b>"
                   + list(($l.names | map(list_row(link(.person; .contact_url) + ", " + link(.company; .company_url)
                          + (if (.note // "") != "" then " <span style=\"color:" + faint + "\">· " + (.note | esc) + "</span>" else "" end)))
                          | join("")); "13px");
                   . == (($lists | length) - 1))
           ) | join(""))
           end)
    );

def counts:
  (.counts // {}) as $c
  | eyebrow("The queue")
  + card(
      row(mono_table(["Next Up", "Still NEW", "Unscored", "Tasks due", "Parked", "Stale"];
            [[($c.next_up // "?" | tostring), ($c.next_up_new // "?" | tostring), ($c.unscored // "?" | tostring),
              ($c.tasks_due // "?" | tostring), ($c.tasks_parked // "?" | tostring), ($c.tasks_stale // "?" | tostring)]]); ($c.top_opened // "") == "")
      + (if ($c.top_opened // "") != "" then note("Hottest reader"; $c.top_opened; true; true) else "" end)
    );

def flags:
  (.flags // []) as $f
  | eyebrow("Flags from the portal diff")
  + card(
      if ($f | length) == 0 then empty_row("The roster and the portal agree.")
      else row(list(($f | map(lead_row(.lead; .note)) | join("")); "14px"); true) end
    );

def dig_in:
  ((.unverified // []) | length) as $nu
  | ((.not_in_block // []) | length) as $nb
  | eyebrow("If you want to dig in")
  + card(
      fold_row(big_fold("Could not verify today"; ($nu | tostring);
        list((if $nu == 0 then list_row("Everything on the roster was verified.") else ((.unverified // []) | map(lead_row(.lead; .note)) | join("")) end); "13px")); false)
      + fold_row(big_fold("Deliberately not in this block"; ($nb | tostring);
        list((if $nb == 0 then list_row("Nothing was left off on purpose.") else ((.not_in_block // []) | map(lead_row(.lead; .note)) | join("")) end); "13px")); true)
    );

page($week + " Pipeline"; (.preheader // "");
  masthead("Pipeline")
  + title_card("Week " + week_number + " · " + short_date($monday) + " to " + short_date($sunday);
               (.headline // []); (.lede // "");
               stats_row(stat(target_of("Replies"); "replies owed")
                         + stat(target_of("Bumps"); "bumps due")
                         + stat(target_of("Intros"); "first touches")))
  + board
  + counts
  + flags
  + dig_in
  + footer($ARGS.named.meta // "")
)
