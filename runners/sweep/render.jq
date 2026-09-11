# Renders the sweep JSON into the Sweep email. Invoked by entrypoint.sh as
#   jq -r --arg week ... --arg monday ... --arg sunday ... --arg meta ... -f render.jq sweep.json
# Design source: Forni's "W38 Sweep Email" in Claude Design, 2026-09-11
# (project e4f18590): cream ground, cards on a hairline, the atelic masthead
# with one orange rule, monospace eyebrows, one card per role with the fit in
# orange, the long tail folded under "If you want to dig in".
#
# Gmail safe: every style inline, tables for layout. The <details> blocks
# fold in Apple Mail and open flat in Gmail, which is the designed fallback;
# nothing the reader needs is behind one except the ledger rows, which are
# for the Tuesday session rather than the glance.

def esc: tostring | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");

def mono: "font-family:'Courier New',monospace;";
def sans: "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
def ink: "#151515";
def dim: "#55503f";
def faint: "#8a8272";
def accent: "#FC4A1A";
def line: "#E6DFD2";
def hair: "#F0EAE0";

def eyebrow($text):
  "<tr><td style=\"padding:36px 8px 12px;" + mono + "font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:" + faint + "\">" + ($text | esc) + "</td></tr>";

def card($inner):
  "<tr><td style=\"background:#FDFBF6;border:1px solid " + line + ";border-radius:14px;padding:0\">"
  + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\">" + $inner + "</table></td></tr>";

def fold($summary; $body):
  "<details style=\"margin-top:12px\"><summary style=\"" + mono + "font-size:12px;color:" + faint + ";cursor:pointer\">+ " + ($summary | esc) + "</summary>"
  + "<div style=\"font-size:14px;line-height:1.55;color:" + dim + ";margin-top:8px\">" + $body + "</div></details>";

def title_line($name; $right):
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\"><tr>"
  + "<td style=\"font-size:17px;font-weight:600;letter-spacing:-0.02em;color:" + ink + ";line-height:1.2\">" + ($name | esc) + "</td>"
  + "<td align=\"right\" style=\"" + mono + "font-size:12px;color:" + accent + ";white-space:nowrap;padding-left:12px\">" + ($right | esc) + "</td>"
  + "</tr></table>";

def role_row($r; $last):
  "<tr><td style=\"padding:22px 24px " + (if $last then "22px" else "20px" end) + ";" + sans
  + (if $last then "" else "border-bottom:1px solid " + line + ";" end) + "\">"
  + title_line($r.company; ($r.fit | tostring))
  + "<div style=\"font-size:14px;color:" + dim + ";margin-top:3px\">" + ([$r.role, $r.comp, $r.arrangement] | map(select(. != null and . != "")) | map(esc) | join(" · ")) + "</div>"
  + "<div style=\"font-size:14px;line-height:1.55;color:" + ink + ";margin-top:12px\">" + ($r.why | esc) + "</div>"
  + (if ($r.about // "") != "" then fold("what they do"; ($r.about | esc)) else "" end)
  + (if ($r.url // "") != "" then "<div style=\"margin-top:14px\"><a href=\"" + ($r.url | esc) + "\" style=\"font-size:14px;font-weight:500;color:" + ink + ";text-decoration:none;border-bottom:1px solid " + accent + "\">Posting &rarr;</a></div>" else "" end)
  + "</td></tr>";

def frac_row($f):
  "<tr><td style=\"padding:22px 24px 20px;" + sans + "border-bottom:1px solid " + line + "\">"
  + title_line($f.company; ($f.rate // "Rate undisclosed"))
  + "<div style=\"font-size:14px;color:" + dim + ";margin-top:3px\">" + ([$f.role, $f.hours, $f.location] | map(select(. != null and . != "")) | map(esc) | join(" · ")) + "</div>"
  + "<div style=\"font-size:14px;line-height:1.55;color:" + ink + ";margin-top:12px\">" + ($f.why | esc) + "</div>"
  + (if ($f.detail // "") != "" then fold("detail"; ($f.detail | esc)) else "" end)
  + "</td></tr>";

def stat($n; $caption):
  "<td style=\"padding:10px 0;border-top:1px solid " + line + "\"><span style=\"" + sans + "font-size:22px;font-weight:600;letter-spacing:-0.02em;color:" + ink + "\">" + ($n | tostring) + "</span><br>" + $caption + "</td>";

def list_row($html):
  "<tr><td style=\"padding:6px 0;border-top:1px solid " + hair + "\">" + $html + "</td></tr>";

def empty_row($text):
  "<tr><td style=\"padding:22px 24px;" + sans + "font-size:14px;color:" + dim + "\">" + ($text | esc) + "</td></tr>";

def week_label: ($week | split("-W") | .[1] | ltrimstr("0"));

def dig_fold($summary_html; $body_html):
  "<details><summary style=\"font-size:15px;font-weight:600;color:" + ink + ";cursor:pointer\">"
  + "<span style=\"" + mono + "color:" + faint + "\">+</span> " + $summary_html + "</summary>" + $body_html + "</details>";

# ---------- the pieces ----------

def masthead:
  "<tr><td style=\"padding:8px 8px 22px;" + sans + "\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>"
  + "<td style=\"font-size:20px;font-weight:600;letter-spacing:-0.045em;color:" + ink + ";padding-right:8px;line-height:1\">atelic</td>"
  + "<td width=\"34\" style=\"width:34px;vertical-align:middle\"><div style=\"width:34px;height:2px;font-size:0;line-height:0;background-color:" + accent + ";background:linear-gradient(90deg," + accent + ",rgba(252,74,26,0))\">&nbsp;</div></td>"
  + "</tr></table></td></tr>";

def title_card:
  card(
    "<tr><td style=\"padding:26px 26px 6px;" + mono + "font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:" + faint + "\">Job sweep · Week " + week_label + "</td></tr>"
    + "<tr><td style=\"padding:0 26px;" + sans + "font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1.1;color:" + ink + "\">" + ((.headline // []) | map(esc) | join("<br>")) + "</td></tr>"
    + "<tr><td style=\"padding:14px 26px 0;" + sans + "font-size:15px;line-height:1.6;color:" + dim + "\">" + ((.lede // "") | esc) + "</td></tr>"
    + "<tr><td style=\"padding:20px 26px 24px\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"" + mono + "font-size:12px;color:" + faint + "\"><tr>"
    + stat((.shortlist // []) | length; "shortlisted")
    + stat((.fractional // []) | length; "fractional")
    + stat((.rejected // []) | length; "verified &amp; killed")
    + "</tr></table></td></tr>"
  );

def shortlist_card:
  (.shortlist // []) as $s
  | eyebrow("Shortlist")
  + card(
      if ($s | length) == 0 then empty_row("Nothing cleared every filter this week.")
      else ([range(0; $s | length)] | map(role_row($s[.]; . == (($s | length) - 1))) | join(""))
      end
    );

def fractional_card:
  (.fractional // []) as $f
  | eyebrow("Fractional lane")
  + card(
      (if ($f | length) == 0 then "<tr><td style=\"padding:22px 24px 20px;" + sans + "font-size:14px;color:" + dim + ";border-bottom:1px solid " + line + "\">No posted fractional role cleared the band this week.</td></tr>"
       else ($f | map(frac_row(.)) | join("")) end)
      + (if (.prospects // "") != "" then "<tr><td style=\"padding:18px 24px 4px;" + sans + "font-size:14px;line-height:1.55;color:" + dim + "\"><span style=\"" + mono + "font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:" + faint + "\">Prospects</span><br>" + (.prospects | esc) + "</td></tr>" else "" end)
      + (if (.tradeoff // "") != "" then "<tr><td style=\"padding:18px 24px 20px;" + sans + "font-size:14px;line-height:1.55;color:" + ink + "\"><span style=\"" + mono + "font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:" + accent + "\">One tradeoff</span><br>" + (.tradeoff | esc) + "</td></tr>" else "<tr><td style=\"padding:0 0 12px\"></td></tr>" end)
    );

def rejected_list:
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"margin-top:12px;font-size:13px;line-height:1.5;color:" + dim + "\">"
  + ((.rejected // []) | map(list_row("<b style=\"color:" + ink + ";font-weight:500\">" + (.company | esc) + "</b> · " + (.reason | esc))) | join(""))
  + (if (.rejected_note // "") != "" then list_row("<span style=\"color:" + faint + "\">" + (.rejected_note | esc) + "</span>") else "" end)
  + "</table>";

def sources_list:
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"margin-top:12px;font-size:14px;line-height:1.55;color:" + dim + "\">"
  + ((.sources // []) | map("<tr><td style=\"padding:8px 0;border-top:1px solid " + hair + "\"><b style=\"color:" + ink + ";font-weight:500\">" + (.lead | esc) + "</b> " + (.note | esc) + "</td></tr>") | join(""))
  + "</table>";

def ledger_table:
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"margin-top:12px;" + mono + "font-size:11px;line-height:1.5;color:" + dim + "\">"
  + "<tr><td style=\"padding:4px 6px 4px 0;color:" + faint + "\">Date</td><td style=\"padding:4px 6px;color:" + faint + "\">Company</td><td style=\"padding:4px 6px;color:" + faint + "\">Role</td><td style=\"padding:4px 6px;color:" + faint + "\">Key</td><td style=\"padding:4px 0 4px 6px;color:" + faint + "\">Verdict</td></tr>"
  + ((.ledger // []) | map("<tr><td style=\"padding:4px 6px 4px 0;border-top:1px solid " + hair + ";vertical-align:top;white-space:nowrap\">" + (.date | esc) + "</td><td style=\"padding:4px 6px;border-top:1px solid " + hair + ";vertical-align:top\">" + (.company | esc) + "</td><td style=\"padding:4px 6px;border-top:1px solid " + hair + ";vertical-align:top\">" + (.role | esc) + "</td><td style=\"padding:4px 6px;border-top:1px solid " + hair + ";vertical-align:top\">" + (.key | esc) + "</td><td style=\"padding:4px 0 4px 6px;border-top:1px solid " + hair + ";vertical-align:top\">" + (.verdict | esc) + "</td></tr>") | join(""))
  + "</table>";

def dig_card:
  ((.rejected // []) | length) as $nr
  | ((.ledger // []) | length) as $nl
  | eyebrow("If you want to dig in")
  + card(
      "<tr><td style=\"padding:18px 24px;" + sans + "border-bottom:1px solid " + line + "\">"
      + dig_fold("Considered and rejected <span style=\"" + mono + "font-size:12px;font-weight:400;color:" + faint + "\">" + ($nr | tostring) + "</span>"; rejected_list)
      + "</td></tr>"
      + "<tr><td style=\"padding:18px 24px;" + sans + "border-bottom:1px solid " + line + "\">"
      + dig_fold("Source notes"; sources_list)
      + "</td></tr>"
      + "<tr><td style=\"padding:18px 24px 20px;" + sans + "\">"
      + dig_fold("Ledger <span style=\"" + mono + "font-size:12px;font-weight:400;color:" + faint + "\">" + ($nl | tostring) + " rows for FY27-sweep-ledger.md</span>"; ledger_table)
      + "</td></tr>"
    );

def footer:
  "<tr><td style=\"padding:36px 8px 0;" + mono + "font-size:11px;line-height:1.8;color:" + faint + "\">" + (($ARGS.named.meta // "") | esc) + "</td></tr>";

# ---------- the page ----------

"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light\"><title>" + ($week | esc) + " Sweep</title>"
+ "<style>body{margin:0;padding:0;background:#F6F1E7}a{color:#151515}details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}@media (max-width:700px){.wrap{width:100%!important}}</style></head>"
+ "<body style=\"margin:0;padding:0;background:#F6F1E7;-webkit-text-size-adjust:100%\">"
+ "<span style=\"display:none;font-size:1px;color:#F6F1E7;max-height:0;overflow:hidden\">" + ((.preheader // "") | esc) + "</span>"
+ "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"background:#F6F1E7\"><tr><td align=\"center\" style=\"padding:28px 12px 48px\">"
+ "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"680\" class=\"wrap\" style=\"width:680px;max-width:680px\">"
+ masthead
+ title_card
+ shortlist_card
+ fractional_card
+ dig_card
+ footer
+ "</table></td></tr></table></body></html>"
