#!/usr/bin/env bash
# Run the Hurdles clerk from a cloud session (a claude.ai routine), safely re-entrant.
#
# Every firing of the routine starts a fresh VM with a fresh clone, so nothing local
# survives between runs, and runs can overlap: a wave can take longer than the hourly
# schedule. The only shared state is origin/master, so the lock lives there too.
#
#   hurdles/lock.json   {"holder", "session", "since", "heartbeat"}, holder null when free
#
# A push to master only succeeds as a fast-forward, which makes it a compare-and-swap:
# two runs that both see the lock free both commit an acquire, and only one push lands.
# Every unit commit renews the heartbeat. A lock whose heartbeat is older than
# LOCK_TTL is stale (the VM died) and the next run takes it over; the old holder, if it
# is somehow still alive, finds the lock is no longer its own at its next commit and
# stops without pushing. Uncommitted work is never shared, so a lost run costs at most
# the unit in progress, which state.json still lists in its queue.
#
# Subcommands:
#   start           the gates from tools/hurdles-cron.sh (lock, done, budget, clean
#                   tree), then take the lock, then provision the VM. Prints GO or SKIP.
#   budget          PROTOCOL.md budget guard. Prints the numbers; exit 3 means stop.
#   commit <msg>    check we still hold the lock, renew it, commit everything, push.
#   release <why>   free the lock (commits only lock.json) and push.
#   status          who holds the lock.
#   hook-start|hook-stop|hook-end   called by .claude/settings.json hooks
#
# Exit codes: 0 ok/GO, 3 SKIP or budget over, 4 lock lost (stop now, push nothing),
# 5 push conflict a person must resolve, 1 other error.

set -uo pipefail

SESSION_MAX=50
WEEKLY_MAX=95
LOCK_TTL=${HURDLES_LOCK_TTL:-$((4 * 3600))}
LOCK=hurdles/lock.json
GIT_NAME="Alan Falloon"
GIT_EMAIL="falloonalan@gmail.com"

cd "$(dirname "$0")/.." || exit 1

# Commit as the repo owner, not the VM's default "Claude" identity, so pushes to master
# pass the proxy's authorship check. Set here as well as in hook-start, because hooks
# only load from the branch the session was cloned on.
if [ "${CLAUDE_CODE_REMOTE:-}" = true ]; then
  export GIT_AUTHOR_NAME="$GIT_NAME" GIT_AUTHOR_EMAIL="$GIT_EMAIL"
  export GIT_COMMITTER_NAME="$GIT_NAME" GIT_COMMITTER_EMAIL="$GIT_EMAIL"
fi
ME_FILE="$(git rev-parse --git-dir)/hurdles-run"

say() { echo "$*" >&2; }
now() { date -u +%FT%TZ; }
if [ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ]; then ME=$CLAUDE_CODE_REMOTE_SESSION_ID
elif [ -s "$ME_FILE" ]; then ME=$(cat "$ME_FILE")
else ME="local-$(hostname)-$$-$(date +%s)"; fi
me() { echo "$ME"; }
session_url() {
  [ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ] && echo "https://claude.ai/code/${CLAUDE_CODE_REMOTE_SESSION_ID/#cse_/session_}"
}
holding() { [ -s "$ME_FILE" ]; }   # this clone took the lock

# The lock as origin/master has it (not the working copy).
remote_lock() { git show origin/master:"$LOCK" 2>/dev/null || echo '{"holder":null}'; }
lock_field() { jq -r ".$1 // empty"; }
age_of() {  # seconds since an ISO time; a missing or bad time counts as ancient
  local t; t=$(date -u -d "${1:-x}" +%s 2>/dev/null) || t=0
  echo $(( $(date -u +%s) - t ))
}

write_lock() {  # holder since
  jq -n --arg h "$1" --arg s "$(session_url)" --arg since "$2" --arg hb "$(now)" \
    'if $h == "" then {holder: null, released: $hb}
     else {holder: $h, session: $s, since: $since, heartbeat: $hb} end' > "$LOCK"
}

# Explicit refspec: cloud clones are single-branch (the default branch), so a plain
# `git fetch origin master` would not update origin/master.
fetch() { git fetch -q origin +refs/heads/master:refs/remotes/origin/master; }

# Push HEAD to master. On a non-fast-forward, re-check the lock and rebase onto
# whatever a person pushed meanwhile.
push() {
  git push -q origin HEAD:refs/heads/master 2>/dev/null && return 0
  fetch || { say "fetch failed"; return 1; }
  [ "$(remote_lock | lock_field holder)" = "$(me)" ] || { say "LOCK LOST while pushing"; return 4; }
  if ! git rebase -q --autostash origin/master >/dev/null 2>&1; then
    git rebase --abort 2>/dev/null
    say "CONFLICT: master moved under the clerk and does not rebase cleanly"; return 5
  fi
  git push -q origin HEAD:refs/heads/master || { say "push failed after rebase"; return 1; }
}

check_holder() {
  fetch || { say "fetch failed"; exit 1; }
  local h; h=$(remote_lock | lock_field holder)
  if [ "$h" != "$(me)" ]; then
    say "LOCK LOST: origin/master says the lock is held by '${h:-nobody}', not this run."
    say "Stop now. Do not push. The work in progress here is discarded; the queue still has it."
    exit 4
  fi
}

usage_numbers() {  # prints "session weekly" as percentages, or fails
  local raw
  raw=$(python3 tools/usage.py --json 2>/dev/null) || return 1
  jq -r '.raw as $r
    | if $r.unifiedWindows then [$r.unifiedWindows.five_hour.utilization * 100, $r.unifiedWindows.seven_day.utilization * 100]
      else [$r.five_hour.utilization, $r.seven_day.utilization] end
    | map(. // empty | . * 10 | round / 10) | select(length == 2) | "\(.[0]) \(.[1])"' <<<"$raw" | grep .
}

cmd_budget() {
  local u s w
  u=$(usage_numbers) || { echo "BUDGET UNREADABLE: treat as over budget (fail closed)"; return 3; }
  read -r s w <<<"$u"
  if awk -v s="$s" -v w="$w" -v sm=$SESSION_MAX -v wm=$WEEKLY_MAX 'BEGIN { exit !(s >= sm || w >= wm) }'; then
    echo "BUDGET OVER: session ${s}%, weekly ${w}% (limits ${SESSION_MAX}/${WEEKLY_MAX}). Start nothing new."; return 3
  fi
  echo "budget ok: session ${s}%, weekly ${w}%"
}

skip() { echo "SKIP: $*"; exit 3; }

cmd_start() {
  fetch || skip "cannot fetch origin/master"

  # Cloud clones start on GitHub's default branch, which need not be master.
  if [ "$(git branch --show-current)" != master ]; then
    [ -z "$(git status --porcelain)" ] || skip "working tree is dirty; a human should look"
    git checkout -q -B master origin/master || skip "cannot check out master"
  else
    git merge -q --ff-only origin/master 2>/dev/null || skip "local master has diverged from origin/master; a human should look"
  fi

  local lock holder hb
  lock=$(remote_lock); holder=$(lock_field holder <<<"$lock"); hb=$(lock_field heartbeat <<<"$lock")
  local takeover=""
  if [ -n "$holder" ] && [ "$holder" != "$(me)" ]; then
    local age; age=$(age_of "$hb")
    [ "$age" -ge $LOCK_TTL ] || skip "lock held by $holder ($(lock_field session <<<"$lock")), heartbeat ${age}s ago"
    takeover=" (took over stale lock from $holder, heartbeat ${age}s ago)"
  fi

  local phase; phase=$(jq -r .phase hurdles/state.json 2>/dev/null)
  [ "$phase" != done ] || skip "loop is done"

  local b; b=$(cmd_budget) || skip "$b"

  [ -z "$(git status --porcelain)" ] || skip "working tree is dirty; a human should look"

  if [ "$holder" != "$(me)" ]; then
    local id; id=$(me)
    write_lock "$id" "$(now)"
    git add "$LOCK"
    git commit -q -m "hurdles lock: acquire$takeover" -m "Run: ${id}${CLAUDE_CODE_REMOTE_SESSION_ID:+ $(session_url)}" \
      || skip "could not commit the lock"
    if ! git push -q origin HEAD:refs/heads/master 2>/dev/null; then
      git reset -q --hard origin/master
      skip "another run took the lock first"
    fi
    echo "$id" > "$ME_FILE"
  fi

  if [ "${CLAUDE_CODE_REMOTE:-}" = true ]; then
    local log="$(git rev-parse --git-dir)/cloud-setup.log"
    if ! bash tools/cloud-setup.sh >"$log" 2>&1; then
      tail -5 "$log" >&2
      cmd_release "setup failed; see the session log" >/dev/null
      skip "VM setup failed (tools/cloud-setup.sh), lock released"
    fi
  fi

  echo "GO: lock held by $(me)$takeover. wave $(jq -r .wave hurdles/state.json), phase $phase, queue $(jq -c .queue hurdles/state.json). $b"
}

cmd_commit() {
  [ -n "${1:-}" ] || { say "usage: commit <message>"; exit 1; }
  holding || { say "this clone does not hold the lock; run start first"; exit 4; }
  check_holder
  write_lock "$(me)" "$(jq -r '.since // empty' "$LOCK")"
  git add -A
  git commit -q -m "$1" || { say "commit failed"; exit 1; }
  push; local rc=$?
  [ $rc = 0 ] && echo "committed and pushed $(git rev-parse --short HEAD): $1"
  exit $rc
}

cmd_release() {
  holding || { echo "not holding the lock"; return 0; }
  fetch || { say "fetch failed"; return 1; }
  if [ "$(remote_lock | lock_field holder)" != "$(me)" ]; then
    rm -f "$ME_FILE"; echo "lock was not ours any more; nothing to release"; return 0
  fi
  write_lock "" ""
  git commit -q -m "hurdles lock: release" -m "${1:-}" -- "$LOCK" || { say "commit failed"; return 1; }
  push || return $?
  rm -f "$ME_FILE"
  echo "lock released: ${1:-}"
}

cmd_status() {
  fetch
  local lock; lock=$(remote_lock)
  jq . <<<"$lock"
  local hb; hb=$(lock_field heartbeat <<<"$lock")
  [ -n "$hb" ] && echo "heartbeat $(age_of "$hb")s ago (stale after ${LOCK_TTL}s)"
  holding && echo "this clone holds it as $(me)"
  true
}

# SessionStart: in the cloud, commit as the repo owner rather than the VM's default
# identity, so pushes to master pass the proxy's authorship check.
hook_start() {
  [ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    printf 'export GIT_AUTHOR_NAME=%q GIT_AUTHOR_EMAIL=%q GIT_COMMITTER_NAME=%q GIT_COMMITTER_EMAIL=%q\n' \
      "$GIT_NAME" "$GIT_EMAIL" "$GIT_NAME" "$GIT_EMAIL" >> "$CLAUDE_ENV_FILE"
  fi
  git config user.name "$GIT_NAME"; git config user.email "$GIT_EMAIL"
  exit 0
}

# Stop: while this run holds the lock, refuse to end the turn once, with the reason.
# Ending the turn in a routine ends the session and kills any running subagents.
hook_stop() {
  local input; input=$(cat)
  holding || exit 0
  [ "$(jq -r '.stop_hook_active // false' <<<"$input")" = true ] && exit 0
  local why=""
  [ -n "$(git status --porcelain)" ] && why="the working tree has uncommitted changes; "
  [ -n "$(git log --oneline origin/master..HEAD 2>/dev/null)" ] && why="${why}there are unpushed commits; "
  jq -n --arg r "This run still holds the Hurdles lock (${why:-no pending changes}). Ending the turn ends the session and kills any running agents. If agents are still running, wait for them. Otherwise: commit each finished unit with tools/hurdles-cloud.sh commit \"<msg>\" (unfinished work is discarded; its unit stays in the queue), then run tools/hurdles-cloud.sh release \"<why you stopped>\", then give your report." \
    '{decision: "block", reason: $r}'
}

# SessionEnd: release the lock if the clerk did not, so the next run need not wait out
# the TTL. Only lock.json is committed; anything else uncommitted dies with the VM.
hook_end() {
  holding || exit 0
  cmd_release "session ended while holding the lock" >&2
  exit 0
}

case "${1:-}" in
  start) cmd_start ;;
  budget) cmd_budget ;;
  commit) shift; cmd_commit "$*" ;;
  release) shift; cmd_release "$*" ;;
  status) cmd_status ;;
  hook-start) hook_start ;;
  hook-stop) hook_stop ;;
  hook-end) hook_end ;;
  *) sed -n '2,30p' "$0"; exit 1 ;;
esac
