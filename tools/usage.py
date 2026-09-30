#!/usr/bin/env python3
"""Read the Claude Code subscription usage percentages (/usage) programmatically.

Two routes, tried in order:

  1. direct  - GET https://api.anthropic.com/api/oauth/usage using the OAuth
               access token in ~/.claude/.credentials.json. No model call, no
               cost, gives the per-model weekly breakdown (Opus).
  2. probe   - run `claude -p` with a one-word prompt on Haiku and read the
               `rate_limit_event` frame from --output-format stream-json.
               Costs well under a cent and ~2s, needs no credential handling.

Usage:  usage.py [--json] [--route direct|probe|auto]
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import time
import urllib.request

CREDS = os.path.expanduser("~/.claude/.credentials.json")


def _token():
    with open(CREDS) as fh:
        d = json.load(fh)
    oauth = d.get("claudeAiOauth") or {}
    tok = oauth.get("accessToken")
    exp = oauth.get("expiresAt")
    if not tok:
        raise RuntimeError("no accessToken in %s" % CREDS)
    if exp and exp / 1000 < time.time():
        raise RuntimeError("OAuth token expired; run any `claude` command to refresh")
    return tok


def route_direct():
    req = urllib.request.Request(
        "https://api.anthropic.com/api/oauth/usage?at_wall=1&skip_spend=1",
        headers={
            "Authorization": "Bearer %s" % _token(),
            "Content-Type": "application/json",
            "anthropic-beta": "oauth-2025-04-20",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def route_probe():
    out = subprocess.run(
        ["claude", "-p", "ok", "--model", "haiku",
         "--output-format", "stream-json", "--verbose"],
        capture_output=True, text=True, timeout=180,
    ).stdout
    for line in out.splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "rate_limit_event":
            return d["rate_limit_info"]
    raise RuntimeError("no rate_limit_event in stream-json output")


def windows(raw):
    """Normalise either route's payload to a list of (label, percent, resets_at).

    The two routes differ: the direct API reports utilization already in percent
    with an ISO `resets_at`, the probe route reports a 0-1 fraction with an epoch
    `resetsAt`. Both are folded to (percent, datetime|None) here.
    """
    def when(v):
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return datetime.datetime.fromtimestamp(v, datetime.timezone.utc)
        return datetime.datetime.fromisoformat(v)

    uw = raw.get("unifiedWindows")
    if uw:  # probe route: fractions, epoch seconds
        return [(k, v["utilization"] * 100, when(v.get("resetsAt")))
                for k, v in uw.items()]

    if raw.get("limits"):  # direct route: the same rows /usage renders
        rows = []
        for l in raw["limits"]:
            # Per-model weekly rows (Opus, Sonnet) share a kind and are told
            # apart only by scope.model, so fold that into the label.
            model = ((l.get("scope") or {}).get("model") or {}).get("display_name")
            label = "%s/%s" % (l.get("kind"), model) if model else l.get("kind")
            rows.append((label, l.get("percent"), when(l.get("resets_at"))))
        return rows

    return [(k, v["utilization"], when(v.get("resets_at")))
            for k, v in raw.items()
            if isinstance(v, dict) and v.get("utilization") is not None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--route", default="auto", choices=["auto", "direct", "probe"])
    a = ap.parse_args()

    raw, used, err = None, None, None
    for name in (["direct", "probe"] if a.route == "auto" else [a.route]):
        try:
            raw = {"direct": route_direct, "probe": route_probe}[name]()
            used = name
            break
        except Exception as e:  # fall through to the next route
            err = "%s: %s" % (name, e)
    if raw is None:
        sys.exit("could not read usage (%s)" % err)

    if a.json:
        print(json.dumps({"route": used, "raw": raw}, indent=2))
        return
    for label, pct, reset in windows(raw):
        stamp = reset.astimezone().strftime("%a %d %b %H:%M") if reset else "?"
        print("%-14s %5.1f%%   resets %s" % (label, pct, stamp))


if __name__ == "__main__":
    main()
