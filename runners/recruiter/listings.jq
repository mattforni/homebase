# Turns the Getro pulls into one listing table the recruiter reads instead of
# fetching the boards itself. Invoked by entrypoint.sh over every pull record
# (one JSON object per board and query, written by the pull phase) as
#   jq -n --rawfile deny deny.txt -f listings.jq pulls/getro/*.json
# for the JSON, and with --arg format md for the markdown the model reads.
#
# Each pull record is {board, base, query, url, http, total, found, error},
# where found is the board's own job objects out of its Next.js state. Rows
# are deduplicated on the board's job id (the same posting appears on several
# boards and under several queries, and the overlap is what is being counted
# away), and the deny list is applied here, so a deny listed card never
# reaches the model at all. Written for jq 1.6, the version in the image.

def trim: sub("^\\s+"; "") | sub("\\s+$"; "");
def norm: ascii_downcase | gsub("\\s+"; " ") | trim;

# deny.txt, one entry per line: a bare brand, or "brand | role". Comments and
# blank lines are skipped.
def deny_entries:
    $deny | split("\n")
    | map(sub("#.*$"; "") | trim | select(. != ""))
    | map(split("|") | {brand: (.[0] | norm), role: ((.[1] // "") | norm)});

def denied_by($entries):
    . as $row
    | ($row.company | norm) as $c
    | ($row.title | norm) as $t
    | [ $entries[] | select(.brand == $c and (.role == "" or ($t | contains(.role)))) ]
    | first // null;

def money:
    if . == null then null
    elif . >= 1000000 then "$\(. / 100000 | floor)K"
    else "$\(. / 100 | floor)" end;

def comp:
    if .compensationAmountMinCents == null and .compensationAmountMaxCents == null then null
    else
        [ (.compensationAmountMinCents | money), (.compensationAmountMaxCents | money) ]
        | map(select(. != null)) | unique | join(" to ")
    end;

def row($pull):
    {
        id: .id,
        title: (.title // ""),
        company: (.organization.name // ""),
        company_slug: (.organization.slug // ""),
        locations: ((.locations // []) | join("; ")),
        work_mode: (.workMode // ""),
        seniority: (.seniority // ""),
        comp: comp,
        posted: (if .createdAt then (.createdAt | todate | .[0:10]) else null end),
        source: (.source // ""),
        url: (.url // ""),
        board_url: ($pull.base + "/companies/" + (.organization.slug // "") + "/jobs/" + (.slug // (.id | tostring))),
        boards: [$pull.board],
        queries: [$pull.query]
    };

def merge_rows:
    group_by(.id)
    | map(
        (.[0]) + {
            boards: (map(.boards[]) | unique),
            queries: (map(.queries[]) | unique)
        }
    );

[inputs] as $pulls
| deny_entries as $entries
| ($pulls | map({board, query, url, http, total, found: ((.found // []) | length), error: (.error // null)})) as $pull_table
| ($pulls | map(. as $p | (.found // [])[] | row($p)) | merge_rows) as $all
| ($all | map(. as $r | denied_by($entries) as $d | if $d then $r + {denied: $d} else empty end)) as $dropped
| ($all | map(select(denied_by($entries) == null)) | sort_by(.posted // "") | reverse) as $kept
| {
    pulls: $pull_table,
    counts: {
        fetches: ($pulls | length),
        fetches_ok: ($pulls | map(select(.error == null)) | length),
        cards: ($pulls | map((.found // []) | length) | add // 0),
        unique: ($all | length),
        denied: ($dropped | length),
        kept: ($kept | length)
    },
    denied: ($dropped | group_by(.company) | map({company: .[0].company, count: length, titles: (map(.title) | unique)})),
    listings: $kept
  } as $out
| if $format == "md" then
    (
        [ "# Board pulls for the sweep",
          "",
          "\($out.counts.fetches_ok) of \($out.counts.fetches) fetches returned a page; \($out.counts.cards) cards, \($out.counts.unique) unique postings, \($out.counts.denied) dropped by the deny list, \($out.counts.kept) below.",
          "",
          "| Board | Query | HTTP | Shown | Total | Error |",
          "|---|---|---|---|---|---|"
        ]
        + ($out.pulls | map("| \(.board) | \(.query) | \(.http) | \(.found) | \(.total // "") | \(.error // "") |"))
        + [ "",
            "A board renders the first twenty for a query; a total above twenty means the rest were not seen.",
            "",
            "## Dropped by the deny list",
            "" ]
        + (if ($out.denied | length) == 0 then ["none"] else ($out.denied | map("- \(.company): \(.count) card\(if .count == 1 then "" else "s" end) (\(.titles | join("; ")))")) end)
        + [ "",
            "## Listings, newest first",
            "",
            "One line per posting: board job id · title · employer (slug) · locations · work mode · seniority · comp · posted · boards · queries · the employer's own posting url · the board's card.",
            "" ]
        + ($out.listings | map(
            "- \(.id) · \(.title) · \(.company) (\(.company_slug)) · \(if .locations == "" then "no location" else .locations end) · \(.work_mode) · \(.seniority) · \(.comp // "comp not shown") · posted \(.posted // "undated") · \(.boards | join(", ")) · \(.queries | join(", ")) · \(.url) · \(.board_url)"
          ))
    ) | join("\n")
  else $out end
