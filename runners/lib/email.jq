# The runner email: one design, shared by every runner that mails a page.
#
# Source: Forni's "W38 Sweep Email" in Claude Design (project e4f18590,
# 2026-09-11), made canonical the same day: cream ground, cards on a hairline
# with a soft radius, the atelic wordmark and one orange rule at the top left
# with the email's title beside it, monospace uppercase eyebrows, sans for
# everything read, the accent reserved for the one number that matters on a
# row and for the "Posting" underline. A runner composes its page from the
# pieces below and never invents a look of its own; a new kind of row is a
# new def here, so the next runner gets it too.
#
# Used as a jq module: `include "email";` at the top of a runner's render.jq,
# with `-L` pointing at this directory (runners/lib in the repo, /home/runner/lib
# in an image). Every style is inline and every layout is a table, because
# Gmail strips <style> and ignores media queries on some accounts; the
# <details> folds open flat there and fold in Apple Mail, which is the
# designed fallback. Written for jq 1.6, the version the images ship: no
# `$label` (a keyword there), no `ltrimstr` on non strings, no `@html`.

# ---------- tokens ----------

def ground: "#F6F1E7";
def paper: "#FDFBF6";
def ink: "#151515";
def dim: "#55503f";
def faint: "#8a8272";
def accent: "#FC4A1A";
def line: "#E6DFD2";
def hair: "#F0EAE0";

def mono: "font-family:'Courier New',monospace;";
def sans: "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";

def esc: tostring | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");

def eyebrow_style: mono + "font-size:11px;letter-spacing:0.12em;text-transform:uppercase;";

# ---------- atoms ----------

# A section label between cards.
def eyebrow($text):
  "<tr><td style=\"padding:36px 8px 12px;" + eyebrow_style + "color:" + faint + "\">" + ($text | esc) + "</td></tr>";

# A card: paper on a hairline, rows inside.
def card($rows):
  "<tr><td style=\"background:" + paper + ";border:1px solid " + line + ";border-radius:14px;padding:0\">"
  + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\">" + $rows + "</table></td></tr>";

# A small disclosure inside a row: "+ what they do".
def fold($summary; $body_html):
  "<details style=\"margin-top:12px\"><summary style=\"" + mono + "font-size:12px;color:" + faint + ";cursor:pointer\">+ " + ($summary | esc) + "</summary>"
  + "<div style=\"font-size:14px;line-height:1.55;color:" + dim + ";margin-top:8px\">" + $body_html + "</div></details>";

# A card level disclosure: a bold summary with an optional faint count beside it.
def big_fold($summary; $count_html; $body_html):
  "<details><summary style=\"font-size:15px;font-weight:600;color:" + ink + ";cursor:pointer\">"
  + "<span style=\"" + mono + "color:" + faint + "\">+</span> " + ($summary | esc)
  + (if $count_html == "" then "" else " <span style=\"" + mono + "font-size:12px;font-weight:400;color:" + faint + "\">" + $count_html + "</span>" end)
  + "</summary>" + $body_html + "</details>";

# A name on the left and the one value that matters on the right, in the accent.
def title_line($name; $right):
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\"><tr>"
  + "<td style=\"font-size:17px;font-weight:600;letter-spacing:-0.02em;color:" + ink + ";line-height:1.2\">" + ($name | esc) + "</td>"
  + "<td align=\"right\" style=\"" + mono + "font-size:12px;color:" + accent + ";white-space:nowrap;padding-left:12px\">" + ($right | esc) + "</td>"
  + "</tr></table>";

# The workhorse row: title line, a dim subline of facts joined by middots, a
# body sentence or two, an optional fold, an optional link. $last drops the
# bottom hairline so the card closes clean.
def item($name; $right; $subparts; $body; $fold_label; $fold_body; $link_text; $url; $last):
  "<tr><td style=\"padding:22px 24px " + (if $last then "22px" else "20px" end) + ";" + sans
  + (if $last then "" else "border-bottom:1px solid " + line + ";" end) + "\">"
  + title_line($name; $right)
  + (if ($subparts | length) > 0 then "<div style=\"font-size:14px;color:" + dim + ";margin-top:3px\">" + ($subparts | map(select(. != null and . != "")) | map(esc) | join(" · ")) + "</div>" else "" end)
  + (if ($body // "") != "" then "<div style=\"font-size:14px;line-height:1.55;color:" + ink + ";margin-top:12px\">" + ($body | esc) + "</div>" else "" end)
  + (if ($fold_body // "") != "" then fold($fold_label; ($fold_body | esc)) else "" end)
  + (if ($url // "") != "" then "<div style=\"margin-top:14px\"><a href=\"" + ($url | esc) + "\" style=\"font-size:14px;font-weight:500;color:" + ink + ";text-decoration:none;border-bottom:1px solid " + accent + "\">" + ($link_text | esc) + " &rarr;</a></div>" else "" end)
  + "</td></tr>";

# A short note inside a card under a small eyebrow; accent puts the eyebrow in orange.
def note($eyebrow_text; $text; $accented; $last):
  "<tr><td style=\"padding:18px 24px " + (if $last then "20px" else "4px" end) + ";" + sans + "font-size:14px;line-height:1.55;color:" + (if $accented then ink else dim end) + "\">"
  + "<span style=\"" + eyebrow_style + "color:" + (if $accented then accent else faint end) + "\">" + ($eyebrow_text | esc) + "</span><br>" + ($text | esc) + "</td></tr>";

# One line of dim text filling a card row: the empty state.
def empty_row($text):
  "<tr><td style=\"padding:22px 24px;" + sans + "font-size:14px;color:" + dim + "\">" + ($text | esc) + "</td></tr>";

# A big number over a small caption; three of these sit in a title card.
def stat($n; $caption):
  "<td style=\"padding:10px 0;border-top:1px solid " + line + "\"><span style=\"" + sans + "font-size:22px;font-weight:600;letter-spacing:-0.02em;color:" + ink + "\">" + ($n | tostring) + "</span><br>" + $caption + "</td>";

def stats_row($cells_html):
  "<tr><td style=\"padding:20px 26px 24px\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"" + mono + "font-size:12px;color:" + faint + "\"><tr>" + $cells_html + "</tr></table></td></tr>";

# A hairline list inside a fold: one html cell per row.
def list($rows_html; $font_size):
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"margin-top:12px;font-size:" + $font_size + ";line-height:1.5;color:" + dim + "\">" + $rows_html + "</table>";

def list_row($html):
  "<tr><td style=\"padding:6px 0;border-top:1px solid " + hair + "\">" + $html + "</td></tr>";

def lead_row($lead; $rest):
  list_row("<b style=\"color:" + ink + ";font-weight:500\">" + ($lead | esc) + "</b> " + ($rest | esc));

# A card row that holds a card level fold.
def fold_row($fold_html; $last):
  "<tr><td style=\"padding:18px 24px" + (if $last then " 20px" else "" end) + ";" + sans + (if $last then "" else ";border-bottom:1px solid " + line end) + "\">" + $fold_html + "</td></tr>";

# A compact monospace table for data the reader copies rather than reads:
# $headers a list of strings, $rows a list of lists of strings.
def mono_table($headers; $rows):
  "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"margin-top:12px;" + mono + "font-size:11px;line-height:1.5;color:" + dim + "\">"
  + "<tr>" + ($headers | map("<td style=\"padding:4px 6px;color:" + faint + "\">" + esc + "</td>") | join("")) + "</tr>"
  + ($rows | map("<tr>" + (map("<td style=\"padding:4px 6px;border-top:1px solid " + hair + ";vertical-align:top\">" + esc + "</td>") | join("")) + "</tr>") | join(""))
  + "</table>";

# ---------- the frame ----------

# The wordmark and one orange rule at the top left, the email's title beside
# them: the runner's name, not the week, so every runner reads the same way
# in the inbox and the week belongs to the title card.
def masthead($title):
  "<tr><td style=\"padding:8px 8px 22px;" + sans + "\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>"
  + "<td style=\"font-size:20px;font-weight:600;letter-spacing:-0.045em;color:" + ink + ";padding-right:8px;line-height:1\">atelic</td>"
  + "<td width=\"34\" style=\"width:34px;vertical-align:middle;padding-right:12px\"><div style=\"width:34px;height:2px;font-size:0;line-height:0;background-color:" + accent + ";background:linear-gradient(90deg," + accent + ",rgba(252,74,26,0))\">&nbsp;</div></td>"
  + "<td style=\"" + eyebrow_style + "color:" + faint + ";vertical-align:middle;line-height:1\">" + ($title | esc) + "</td>"
  + "</tr></table></td></tr>";

# The title card: an eyebrow, a headline of one to three short lines, a lede,
# and whatever stats_row the runner hands in ("" for none).
def title_card($eyebrow_text; $headline_lines; $lede; $stats_html):
  card(
    "<tr><td style=\"padding:26px 26px 6px;" + eyebrow_style + "color:" + faint + "\">" + ($eyebrow_text | esc) + "</td></tr>"
    + "<tr><td style=\"padding:0 26px;" + sans + "font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1.1;color:" + ink + "\">" + ($headline_lines | map(esc) | join("<br>")) + "</td></tr>"
    + (if ($lede // "") != "" then "<tr><td style=\"padding:14px 26px " + (if $stats_html == "" then "26px" else "0" end) + ";" + sans + "font-size:15px;line-height:1.6;color:" + dim + "\">" + ($lede | esc) + "</td></tr>" else "" end)
    + $stats_html
  );

# One quiet line at the foot: the run's facts.
def footer($meta):
  "<tr><td style=\"padding:36px 8px 0;" + mono + "font-size:11px;line-height:1.8;color:" + faint + "\">" + ($meta | esc) + "</td></tr>";

# The page: preheader for the inbox preview, the 680 column, the rows.
def page($title; $preheader; $rows_html):
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light\"><title>" + ($title | esc) + "</title>"
  + "<style>body{margin:0;padding:0;background:" + ground + "}a{color:" + ink + "}details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}@media (max-width:700px){.wrap{width:100%!important}}</style></head>"
  + "<body style=\"margin:0;padding:0;background:" + ground + ";-webkit-text-size-adjust:100%\">"
  + (if ($preheader // "") != "" then "<span style=\"display:none;font-size:1px;color:" + ground + ";max-height:0;overflow:hidden\">" + ($preheader | esc) + "</span>" else "" end)
  + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"background:" + ground + "\"><tr><td align=\"center\" style=\"padding:28px 12px 48px\">"
  + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"680\" class=\"wrap\" style=\"width:680px;max-width:680px\">"
  + $rows_html
  + "</table></td></tr></table></body></html>";

# The failure page, in the same cream, so a bad week reads like a good one
# with the reason on top and the log's tail beneath.
def failure_page($runner_title; $eyebrow_text; $reason; $log_tail):
  page($runner_title + ": did not run"; $reason;
    masthead($runner_title)
    + card(
        "<tr><td style=\"padding:26px 26px 6px;" + eyebrow_style + "color:" + faint + "\">" + ($eyebrow_text | esc) + "</td></tr>"
        + "<tr><td style=\"padding:0 26px;" + sans + "font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1.1;color:" + ink + "\">The " + ($runner_title | ascii_downcase | esc) + " did not run.</td></tr>"
        + "<tr><td style=\"padding:14px 26px 0;" + sans + "font-size:15px;line-height:1.6;color:" + dim + "\">" + ($reason | esc) + "</td></tr>"
        + "<tr><td style=\"padding:20px 26px 26px\"><pre style=\"" + mono + "font-size:12px;white-space:pre-wrap;color:" + dim + ";border-top:1px solid " + line + ";padding-top:14px;margin:0\">" + ($log_tail | esc) + "</pre></td></tr>"
      )
  );
