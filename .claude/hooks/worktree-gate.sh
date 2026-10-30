#!/usr/bin/env bash
# Worktree gate: BLOCK mutating git on a repo's primary checkout, forcing all
# session work into a dedicated worktree so concurrent sessions never collide.
# Denies via the PreToolUse permissionDecision. Two deliberate carve-outs:
#   1. `merge` is allowed on primary (landing a branch into main is a landing step).
#   2. Prefix a command with WT_GATE_BYPASS=1 to override for genuine primary work
#      (a landing step, or committing symlinked homebase config like GC itself).
# A typed command is judged against the session cwd, and also against the
# directory a leading `cd <path> &&` moves to; no other typed cd is followed.
# Scripts are judged too: a shell script the command runs (`./s.sh`, `bash s.sh`,
# `source s.sh`, `bash -c ./s.sh`, `bash < s.sh`, after any `cd`, env assignment,
# or wrapper) is read line by line, and each git call in it gets the same test as
# a typed one, so wrapping `git -C <primary> commit` in a scratchpad script no
# longer walks around the gate. Inside a script a plain `cd <path>` line moves
# the fallback directory, and quoted text is dropped (a -C path is unquoted
# first), so `echo "then git commit"` is data, not a command.
# Limits: one level deep (a script a script calls is not read); shell scripts
# only (a .sh, .bash, or .zsh name, or a sh, bash, or zsh shebang, under 256 KB);
# a script merely read (cat, grep) is not judged; a script piped into a shell
# (`cat s.sh | bash`) is not read; paths with spaces are not parsed.
# Fails OPEN: any resolution error exits 0, never worse than an ungated command.
# That includes a path the hook cannot resolve, like `git -C "$REPO"` or
# `cd "$DIR"` inside a script; only ~, $HOME, and ${HOME} are expanded.
# Changing this hook: merge on no regression against main (pipe the same input
# into main's hook and this one; nothing main denies may pass here). Prefer a
# narrow check that only adds a deny over a general shell parser (ATE-634).
set -uo pipefail
unset CDPATH

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)
[[ -z "$cmd" ]] && exit 0
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
[[ -z "$cwd" ]] && cwd=$PWD

# Explicit escape hatch. Prefix the command with WT_GATE_BYPASS=1 to allow a
# genuine primary-checkout mutation (landing step, symlinked-config commit).
grep -qE '(^|[[:space:]])WT_GATE_BYPASS=1([[:space:]]|$)' <<<"$cmd" && exit 0

deny() {
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Worktree gate: this mutating git command targets a repo PRIMARY checkout. Per GC, session work must run in a dedicated worktree (EnterWorktree) so concurrent sessions never collide. Cut a worktree and rerun there. For another repo, cut one from its primary with `git -C <repo> worktree add <path> -b <branch> origin/main`, never a fresh clone, which reads as a primary here. For a genuine landing step or a symlinked-config commit that must run on primary, prefix the command with WT_GATE_BYPASS=1."}}
JSON
  exit 0
}

expand_home() {
  local p=$1
  p=${p/#\~/$HOME}
  p=${p//\$\{HOME\}/$HOME}
  p=${p//\$HOME/$HOME}
  printf '%s' "$p"
}

strip_quotes() {
  local w=$1
  w=${w#[\"\']}
  w=${w%[\"\']}
  printf '%s' "$w"
}

# Resolve a path against a base directory. Prints nothing when the path still
# holds a variable or the base is unknown, which callers treat as fail open.
resolve() {
  local p base=$2
  p=$(expand_home "$(strip_quotes "$1")")
  [[ -z "$p" || "$p" == *'$'* ]] && return
  if [[ "$p" == /* ]]; then
    printf '%s' "$p"
  elif [[ -n "$base" ]]; then
    printf '%s/%s' "$base" "$p"
  fi
}

# Only mutating git operations (working tree or branch state changers).
# `merge` is intentionally EXCLUDED from the blocked set: it is the landing step
# that runs on the primary checkout. Tolerates global options between git and
# the subcommand. Read only stash invocations (list/show) are stripped first.
GIT_PREFIX="(^|[;&|[:space:]])git([[:space:]]+-[cC][[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:]]+)|[[:space:]]+--?[^[:space:]]+)*[[:space:]]+"
is_mutating() {
  local filtered
  filtered=$(sed -E "s/${GIT_PREFIX}stash[[:space:]]+(list|show)([^;&|]*)/ /g" <<<"$1")
  grep -qE "${GIT_PREFIX}(commit|checkout|switch|rebase|cherry-pick|reset|restore|stash|revert|am)([[:space:]]|\$)" <<<"$filtered"
}

# Linked worktrees have git-dir != git-common-dir; a primary checkout matches.
is_primary() {
  local dir=$1 git_dir common_dir
  git_dir=$(git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null) || return 1
  common_dir=$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null) || return 1
  common_dir=$(cd "$dir" 2>/dev/null && cd "$common_dir" 2>/dev/null && pwd -P) || return 1
  [[ "$git_dir" == "$common_dir" ]]
}

# Judge one line: succeeds when it runs mutating git against a primary. The repo
# is the line's git -C <path> (quoted or not), else the fallback directory.
judge() {
  local line=$1 fallback=$2 raw dir
  is_mutating "$line" || return 1
  raw=$(sed -nE "s/.*git[[:space:]]+-C[[:space:]]+(\"([^\"]+)\"|'([^']+)'|([^[:space:]]+)).*/\\2\\3\\4/p" <<<"$line" | head -1)
  if [[ -n "$raw" ]]; then
    dir=$(resolve "$raw" "$fallback")
  else
    dir=$fallback
  fi
  [[ -z "$dir" ]] && return 1
  is_primary "$dir"
}

is_script() {
  local f=$1
  [[ -f "$f" && -r "$f" ]] || return 1
  [[ $(wc -c <"$f" 2>/dev/null || echo 999999) -le 262144 ]] || return 1
  case "$f" in
    *.sh|*.bash|*.zsh) return 0 ;;
  esac
  head -n1 "$f" 2>/dev/null | grep -qE '^#!.*[/[:space:]](ba|z)?sh([[:space:]]|$)'
}

# Judge every line of a script, starting from the directory it runs in.
shopt -s extglob
judge_script() {
  local line probe fallback=$2
  local cd_re='^cd[[:space:]]+([^;&|[:space:]]+)[[:space:]]*($|[;&|])'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line#"${line%%[![:space:]]*}"}
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ $cd_re ]]; then
      fallback=$(resolve "${BASH_REMATCH[1]}" "$fallback")
    fi
    # A line that cannot contain git once its quoted spans are dropped (the
    # sed below drops them, so gi""t becomes git) can never be denied and skips
    # the subprocesses; setup.sh ran past the hook's 10 second timeout without
    # this. Same span removal, done in bash.
    probe=${line//\"*([^\"])\"/}
    probe=${probe//\'*([^\'])\'/}
    [[ "$line" == *git* || "$probe" == *git* ]] || continue
    # Quoted text is data, not a command (echo "then git commit"), so it is
    # dropped before judging, after unquoting a -C path so the repo survives.
    line=$(sed -E -e "s/-C[[:space:]]+\"([^\"]*)\"/-C \\1/g" -e "s/-C[[:space:]]+'([^']*)'/-C \\1/g" \
      -e "s/\"[^\"]*\"|'[^']*'//g" <<<"$line")
    judge "$line" "$fallback" && return 0
  done <"$1"
  return 1
}

# The typed command itself, judged as a whole against the session cwd.
judge "$cmd" "$cwd" && deny

# A command that opens by moving into a primary is judged there too, so
# `cd <primary> && git commit` from a worktree is denied. Only a leading,
# unquoted cd to an existing directory, followed by &&, counts; this check only
# ever adds a deny. Any other cd in a typed command is not followed: commit in a
# worktree with `git -C <worktree> commit`, not `cd <worktree> && git commit`.
lead_re='^[[:space:]]*cd[[:space:]]+(-[LP][[:space:]]+)*([^[:space:];&|]+)[[:space:]]*&&(.*)$'
if [[ "$cmd" =~ $lead_re ]]; then
  lead_target=${BASH_REMATCH[2]}
  lead_rest=${BASH_REMATCH[3]}
  if [[ "$lead_target" != *[\"\'\$\(\)\`]* ]]; then
    lead_dir=$(resolve "$lead_target" "$cwd")
    [[ -n "$lead_dir" && -d "$lead_dir" ]] && judge "$lead_rest" "$lead_dir" && deny
  fi
fi

# The scripts the command runs. Split it into simple commands, follow `cd`,
# skip env assignments and wrappers, and read the script in command position
# (or the first operand of sh, bash, zsh, source, or `.`).
segments=$cmd
for op in '&&' '||' ';' '&' '|' '`' '$(' '(' ')'; do
  segments=${segments//"$op"/$'\n'}
done
base=$cwd
while IFS= read -r segment; do
  read -ra words <<<"$segment"
  i=0
  while (( i < ${#words[@]} )); do
    case "${words[i]}" in
      *=*|env|exec|nohup|time|command) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  (( i < ${#words[@]} )) || continue
  first=$(strip_quotes "${words[i]}")
  if [[ "$first" == cd ]]; then
    base=$(resolve "${words[i + 1]:-$HOME}" "$base")
    continue
  fi
  case "${first##*/}" in
    sh|bash|zsh|source|.)
      i=$((i + 1))
      # Options are skipped; `-c <string>` and `< file` both name the script
      # by the word that follows (the string's first word, for -c).
      while (( i < ${#words[@]} )) && [[ "${words[i]}" == -* || "${words[i]}" == '<' ]]; do
        if [[ "${words[i]}" == '<' || ( "${words[i]}" == *c* && "${words[i]}" != --* ) ]]; then
          i=$((i + 1))
          break
        fi
        i=$((i + 1))
      done
      (( i < ${#words[@]} )) || continue
      target=${words[i]}
      ;;
    *) target=$first ;;
  esac
  script=$(resolve "$target" "$base")
  [[ -n "$script" ]] && is_script "$script" && judge_script "$script" "$base" && deny
done <<<"$segments"
exit 0
