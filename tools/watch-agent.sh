#!/bin/sh
# Tail the live transcript of a Hurdles subagent (e.g. the enemies critic)
# spawned by the clerk process, and print a readable stream of its actions.
#
# Usage:
#   tools/watch-critic.sh                 # auto-picks the most recently active subagent
#   tools/watch-critic.sh <agent-id>      # e.g. ab442811469dfed09 (from the .jsonl filename)
#   tools/watch-critic.sh <session-id>/<agent-id>
#
# How it works: each `Agent` (Task) call the clerk makes is logged to its own
# file under .claude/projects/<project>/<clerk-session-id>/subagents/agent-<id>.jsonl.
# This script finds the right one and follows it with `tail -f`, decoding each
# line with jq into a short human-readable event.

set -eu

PROJDIR="$HOME/.claude/projects/-home-fallo-gauntlet-runner"

find_latest_subagent_file() {
  find "$PROJDIR" -path '*/subagents/agent-*.jsonl' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-
}

ARG="${1:-}"
if [ -z "$ARG" ]; then
  FILE=$(find_latest_subagent_file)
else
  case "$ARG" in
    */*)
      SESSION=$(dirname "$ARG"); ID=$(basename "$ARG")
      FILE="$PROJDIR/$SESSION/subagents/agent-$ID.jsonl"
      ;;
    *)
      FILE=$(find "$PROJDIR" -path "*/subagents/agent-${ARG}*.jsonl" 2>/dev/null | head -1)
      ;;
  esac
fi

if [ -z "${FILE:-}" ] || [ ! -f "$FILE" ]; then
  echo "Could not find a subagent transcript for '${ARG:-<latest>}'" >&2
  exit 1
fi

META="${FILE%.jsonl}.meta.json"
if [ -f "$META" ]; then
  echo "== $(jq -r '.description' "$META") ($(jq -r '.agentType' "$META")) ==" >&2
fi
echo "Watching: $FILE" >&2
echo >&2

tail -n 20 -f "$FILE" | jq -r --unbuffered '
  if .type == "assistant" then
    (.message.content[]? |
      if .type == "text" then "[text] " + (.text // "")
      elif .type == "tool_use" then "[tool] " + .name + " " + ((.input.command // .input.file_path // .input.pattern // "") | tostring | .[0:160])
      else empty end)
  elif .type == "user" then
    (.message.content[]? |
      if .type == "tool_result" then
        "[result] " + ((.content | if type=="array" then (map(.text? // "") | join(" ")) else tostring end) | .[0:200])
      else empty end)
  else empty end
' 2>/dev/null
