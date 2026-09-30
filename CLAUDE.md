# Gauntlet-Runner

A three.js voxel roguelite, built by the **Hurdles** loop: waves of building, then
harsh independent critique with blind A/B judging against highly rated itch.io games,
repeated until every piece wins.

The loop's state is on disk. Nothing else carries over between sessions.

- `hurdles/PROTOCOL.md`: the method. Read this first, always.
- `hurdles/state.json`: where the loop is (wave, phase, queue).
- `hurdles/pieces.json`: the pieces, in build order, with status and history.
- `hurdles/GAME.md`: the design bible every builder follows.
- `hurdles/LOG.md`: what has happened so far.

The loop runs in the cloud as a claude.ai routine, working directly on `master`. Each
run starts with `tools/hurdles-cloud.sh start` and commits only through that script.
See "Cloud runs" in PROTOCOL.md. `tools/hurdles-cron.sh` is the older local runner:
it does not take the lock, so never run it while the routine is enabled.

Running the game: it is served statically from the repo root, with no build step.
Use `node tools/capture.cjs --url "/?showcase=<id>"` to see it (see the file header).
`python3 -m http.server 8173` works for a manual look.
