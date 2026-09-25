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

Running the game: it is served statically from the repo root, with no build step.
Use `node tools/capture.cjs --url "/?showcase=<id>"` to see it (see the file header).
`python3 -m http.server 8173` works for a manual look.
