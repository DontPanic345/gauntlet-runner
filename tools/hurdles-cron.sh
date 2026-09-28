#!/usr/bin/env bash
# Unattended clerk run for the Hurdles loop, meant to be fired by cron.
#
#   5 * * * * /home/fallo/gauntlet-runner/tools/hurdles-cron.sh
#
# Each firing is cheap unless there is work and budget: it exits without starting
# Claude when another run holds the lock, when state.json says the loop is done,
# or when usage is over the PROTOCOL.md budget guard (session >= 50%, weekly >= 95%).
# Otherwise it starts one headless clerk session, which runs one wave (or up to the
# budget guard) and commits as it goes. Logs: ~/.cache/gauntlet-runner-cron/.
#
# Flags: --dry-run  do the gates and print the command, but don't start Claude.

set -uo pipefail

REPO=/home/fallo/gauntlet-runner
LOGDIR="$HOME/.cache/gauntlet-runner-cron"
USAGE="$HOME/.claude/skills/usage-check/usage.py"
SESSION_MAX=50
WEEKLY_MAX=95
RUN_TIMEOUT=8h

export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_PATH=/usr/local/lib/node_modules
# Print-mode's own background-task wait ceiling defaults to 600s. Spawning an agent via
# the Agent tool without run_in_background:false makes it a backgrounded/async task, and
# ending the clerk's turn to wait on it starts this ceiling counting down regardless of
# the agent's own progress -- a critic or judge doing real, uninterrupted work (screenshot
# capture, reference scraping) can be killed well before it's actually stuck. Disable it;
# the outer `timeout $RUN_TIMEOUT` below is the real backstop.
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0

mkdir -p "$LOGDIR"
say() { echo "$(date '+%F %T') $*" >> "$LOGDIR/cron.log"; }

exec 9>"$LOGDIR/lock"
if ! flock -n 9; then say "skip: previous run still going"; exit 0; fi

cd "$REPO" || { say "error: no repo at $REPO"; exit 1; }

phase=$(jq -r .phase hurdles/state.json 2>/dev/null)
if [ "$phase" = "done" ]; then say "skip: loop is done"; exit 0; fi

# Fail closed: if usage can't be read, don't run.
# The direct route reads the OAuth access token (8h life) without refreshing it, and
# only running `claude` refreshes it. While the budget guard is skipping, nothing else
# does, so the token expires and every check fails. On failure, refresh with a one-word
# Haiku call and retry once; log the reason either way.
uerr="$LOGDIR/usage.err"
if ! usage=$(python3 "$USAGE" --json --route direct 2>"$uerr"); then
  say "usage check failed ($(tr '\n' ' ' < "$uerr" | cut -c1-200)); refreshing token"
  timeout 180 claude -p ok --model haiku >/dev/null 2>&1
  usage=$(python3 "$USAGE" --json --route direct 2>"$uerr") \
    || { say "skip: usage check failed after refresh ($(tr '\n' ' ' < "$uerr" | cut -c1-200))"; exit 0; }
fi
session=$(jq -r '.raw.five_hour.utilization // empty' <<<"$usage")
weekly=$(jq -r '.raw.seven_day.utilization // empty' <<<"$usage")
if [ -z "$session" ] || [ -z "$weekly" ]; then say "skip: usage unreadable"; exit 0; fi
if awk -v s="$session" -v w="$weekly" -v sm=$SESSION_MAX -v wm=$WEEKLY_MAX \
     'BEGIN { exit !(s >= sm || w >= wm) }'; then
  say "skip: budget (session ${session}%, weekly ${weekly}%)"; exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  say "skip: working tree is dirty; a human should look before the loop continues"; exit 0
fi

PROMPT='Read CLAUDE.md, then hurdles/PROTOCOL.md, hurdles/state.json and the end of hurdles/LOG.md. You are the clerk of the Hurdles loop, and you have no other context. Carry out the next wave exactly as PROTOCOL.md says, starting from the phase and queue in state.json. Stop at the end of that wave, or earlier if the budget guard trips. Leave state.json, pieces.json and LOG.md accurate, then report.

This run is unattended, started by cron. No human is watching, so never ask a question or wait for input. If something blocks you and needs a person, record it in state.json notes and LOG.md, commit, and stop. Wait for every agent you spawn to finish before you end your turn: ending the turn while an agent is still running kills it.'

stamp=$(date '+%Y%m%d-%H%M')
out="$LOGDIR/run-$stamp.log"

if [ "${1:-}" = "--dry-run" ]; then
  echo "would run (phase $phase, session ${session}%, weekly ${weekly}%), log $out"
  exit 0
fi

say "start: phase $phase, session ${session}%, weekly ${weekly}%, log $out"
timeout "$RUN_TIMEOUT" claude -p "$PROMPT" --permission-mode auto > "$out" 2>&1
rc=$?
say "end: exit $rc, head $(git rev-parse --short HEAD), phase $(jq -r .phase hurdles/state.json)"
