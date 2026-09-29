#!/usr/bin/env bash
# Clerk run for the Hurdles loop, meant to be fired by cron.
#
#   21,51 * * * * /home/fallo/gauntlet-runner/tools/hurdles-cron.sh
#
# Each firing is cheap unless there is work and budget: it exits without starting
# Claude when another run holds the lock, when state.json says the loop is done,
# or when usage is over the PROTOCOL.md budget guard (session >= 50%, weekly >= 95%).
# Otherwise it starts one interactive clerk session in a detached tmux session named
# `hurdles`, which runs one wave (or up to the budget guard) and commits as it goes.
#
#   tmux attach -t hurdles     watch it, subagents included; detach with Ctrl-b d
#
# You can type into it while attached. This script holds the lock until the session
# ends: when the clerk says it is finished (it touches $HURDLES_RUN/done) and its turn
# then ends (a Stop hook touches $HURDLES_RUN/stopped), it sends /exit. To keep a
# finished session open for questions, `rm` the done marker before the turn ends.
# Logs: ~/.cache/gauntlet-runner-cron/cron.log; the transcript is under ~/.claude/projects.
#
# Flags: --dry-run  do the gates and print the command, but don't start Claude.

set -uo pipefail

REPO=/home/fallo/gauntlet-runner
LOGDIR="$HOME/.cache/gauntlet-runner-cron"
USAGE="$HOME/.claude/skills/usage-check/usage.py"
SESSION_MAX=50
WEEKLY_MAX=95
RUN_TIMEOUT=$((8 * 3600))
TMUX_SESSION=hurdles

export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_PATH=/usr/local/lib/node_modules

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

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  say "skip: tmux session '$TMUX_SESSION' exists but holds no lock; a human should look"; exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  say "skip: working tree is dirty; a human should look before the loop continues"; exit 0
fi

PROMPT='Read CLAUDE.md, then hurdles/PROTOCOL.md, hurdles/state.json and the end of hurdles/LOG.md. You are the clerk of the Hurdles loop, and you have no other context. Carry out the next wave exactly as PROTOCOL.md says, starting from the phase and queue in state.json. Stop at the end of that wave, or earlier if the budget guard trips. Leave state.json, pieces.json and LOG.md accurate, then report.

This run was started by cron. A person may attach and watch, but do not count on it: never ask a question or wait for input. If something blocks you and needs a person, record it in state.json notes and LOG.md, commit, and stop. When you stop for any reason (wave finished, budget guard, or blocked), and every agent you spawned has finished, your last tool call is `touch "$HURDLES_RUN/done"`. Then give your report. The session closes after that turn ends.'

stamp=$(date '+%Y%m%d-%H%M')
run="$LOGDIR/run-$stamp"

if [ "${1:-}" = "--dry-run" ]; then
  echo "would run (phase $phase, session ${session}%, weekly ${weekly}%) in tmux '$TMUX_SESSION', markers in $run"
  exit 0
fi

mkdir -p "$run"
printf '%s' "$PROMPT" > "$run/prompt.txt"
sid=$(python3 -c 'import uuid; print(uuid.uuid4())')
say "start: phase $phase, session ${session}%, weekly ${weekly}%, tmux '$TMUX_SESSION', transcript $sid"
# Pin the model: without --model the clerk (and every agent it spawns) inherits whatever
# default a /model in some interactive session last saved, which once ran waves on Haiku.
# The Stop hook fires at every turn end, including while the clerk waits on background
# agents; only a stop after the done marker means the run is over.
tmux new-session -d -s "$TMUX_SESSION" -x 200 -y 50 -c "$REPO" \
  -e HURDLES_RUN="$run" -e PATH="$PATH" -e NODE_PATH="$NODE_PATH" \
  claude --model opus --effort medium --permission-mode auto --session-id "$sid" \
    --name "hurdles $stamp" \
    --settings '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"touch \"$HURDLES_RUN/stopped\""}]}]}}' \
    "$(cat "$run/prompt.txt")"

end=$((SECONDS + RUN_TIMEOUT)); why=exited
while tmux has-session -t "$TMUX_SESSION" 2>/dev/null; do
  if [ "$run/stopped" -nt "$run/done" ] && [ -e "$run/done" ] && [ "$why" = exited ]; then
    tmux send-keys -t "$TMUX_SESSION" /exit Enter; why=finished
  elif [ $SECONDS -ge $end ]; then
    tmux kill-session -t "$TMUX_SESSION"; why=timeout; break
  fi
  sleep 15
done
say "end: $why, head $(git rev-parse --short HEAD), phase $(jq -r .phase hurdles/state.json)"
