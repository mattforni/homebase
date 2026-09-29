# The dedupe guard on the ledger write. The agent is told to treat any posting
# whose key is already in ledger.md as a resurfaced dedupe, but a candidate
# that arrives by web search rather than a board card can skip that check:
# on 2026-09-28 Dragos's Principal Software Engineer, Backend, applied since
# 2026-09-01, came back as the week's top pick, and the upsert then refreshed
# the applied row's seen date and verdict. So the runner checks every sweep
# row's key against the seen set it pulled before the model ran, keeps the
# misses out of the upsert, and moves each one from the board's shortlist,
# flagged or fractional section into the rejected list carrying the ledger's
# own status, with a headline line and a source note so the email says what
# the ledger already knew.
#
# Input: the draft the agent returned. $seen: one object, normalized key to
# {id, status, seen, company, title}, built by the entrypoint from ledger.md.
# Output: {draft, dropped}, where dropped is the sweep rows kept out, each
# with the ledger row it collided with under `prior`.

def norm: (. // "") | tostring | ascii_downcase | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ");
def slug: (.company | norm) + " / " + (.role | norm);
def prior: $seen[0][(.key | norm)] // null;
def ordinal: if . == 1 then "One" else tostring end;

(.ledger // []) as $rows
| ($rows | map(select((.key | norm) != "" and prior != null) | . + {prior: prior})) as $dropped
| ($dropped | map(slug)) as $slugs
| ($dropped | length) as $n
| def kept: map(select(slug | IN($slugs[]) | not));
  {
    dropped: $dropped,
    draft: (
      if $n == 0 then .
      else
        .ledger = ($rows | map(select((.key | norm) == "" or prior == null)))
        | .shortlist = ((.shortlist // []) | kept)
        | .flagged = ((.flagged // []) | kept)
        | .fractional = ((.fractional // []) | kept)
        | .rejected = ((.rejected // []) + ($dropped | map({
            company,
            reason: "\(.role): already in the ledger as \(.prior.status), first seen \(.prior.seen) (row \(.prior.id)), reported as new this sweep"
          })))
        | .headline = ((.headline // []) + ["\($n | ordinal) already in the ledger."])
        | .sources = ((.sources // []) + [{
            lead: "\($n | ordinal) sweep row\(if $n == 1 then " was a dedupe miss" else "s were dedupe misses" end).",
            note: ("The runner kept " + ($dropped | map("\(.company) \(.role) (\(.prior.status), first seen \(.prior.seen))") | join("; ")) + " out of the ledger and off the board: the key was already in ledger.md, so the agent scored it without the dedupe step.")
          }])
      end
    )
  }
