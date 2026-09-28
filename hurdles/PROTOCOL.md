# Hurdles protocol

This file is the whole method. A session that starts cold reads `CLAUDE.md`, then this
file, then `hurdles/state.json`, and does what the state says. Nothing else decides
what happens next. No orchestrator exists, and nothing is remembered between
sessions, except the files on disk.

## Roles and the one rule

**Whoever builds something never judges it.** There are four roles. Each role that
touches a piece is a separate agent with fresh context, spawned with the Agent tool
using the prompt template in `hurdles/prompts/`.

| Role       | Sees                                          | Writes                                          |
|------------|-----------------------------------------------|-------------------------------------------------|
| builder    | code, GAME.md, the piece's history and reviews | code it owns, `waves/wN/build/<id>.md`          |
| integrator | the whole running game                         | cross-piece fixes, `waves/wN/integration.md`    |
| critic     | the running game and the reference, never builder notes | `waves/wN/critic/<id>/`, a blind packet, the key |
| judge      | only the blind packet and the judging criteria | `waves/wN/verdicts/<id>.json`                   |

The session that runs the loop is the **clerk**. It reads state, spawns agents, does the
mechanical resolve step, updates state, and commits. The clerk never edits game code and
never writes an opinion about quality.

Critics know which side is ours, so their review is harsh but not blind. The **judge**
supplies the blind side-by-side verdict the method requires. Keeping these two roles
separate is what makes the comparison actually blind.

## Files

```
CLAUDE.md                 entry point: points here
hurdles/GAME.md           design bible: concept, controls, look, feel rules
hurdles/PROTOCOL.md       this file
hurdles/pieces.json       the pieces, in build order, with status and history
hurdles/state.json        where the loop is: wave, phase, queue
hurdles/LOG.md            append-only: one entry per unit of work, newest last
hurdles/prompts/*.md      prompt templates for builder, integrator, critic, judge
hurdles/waves/wN/
  build/<id>.md           builder's notes (for later builders and the integrator ONLY)
  integration.md          integrator's report
  critic/<id>/review.md   the harsh review
  critic/<id>/ours/       matched captures of our game, 01-*.png ...
  critic/<id>/ref/        matched captures of the reference, same count and order
  blind/<id>/             the packet: A/, B/, pair-NN.png, criteria.md
  keys/<id>.json          which side is ours. Only the clerk opens it, and only at resolve
  verdicts/<id>.json      the judge's verdict
tools/capture.cjs         drive a URL in headless Chromium: key presses, screenshots, bursts, video
tools/sheet.cjs           contact sheets, video/GIF to frame strips, side-by-side pairs
tools/blind.cjs           build a randomised A/B packet and a sealed key
/usr/bin/ffmpeg           full ffmpeg 8.0.1: mp4/h264 decode, spectrograms, audio conversion
```

### pieces.json fields

- `id`, `title`, `goal`, `must_have`, and `owns`: what the piece is and the paths it
  owns. A leading `!` in `owns` excludes a path.
- `judged`: `false` only for `foundation`. The integrator checks it against `must_have`
  instead of a blind comparison.
- `showcase`: the deterministic URL a critic uses to see the piece in isolation. The
  critic must *also* look at the piece in normal play.
- `judge_focus`: what the matched captures show and the question the judge answers.
- `reference_hint`: what to search for. `reference` stays `null` until the first critic
  of that piece pins one (see "References"). Once pinned it does not change without a
  LOG entry giving the reason.
- `status`: one of `unbuilt`, `built`, `won`, or `lost`.
- `history`: appended at resolve, as
  `{wave, verdict: "won"|"lost"|"tie", margin, biggest_gap, review, verdict_file}`.

### state.json fields

- `wave`: the current wave number, starting at 1.
- `phase`: one of `build`, `integrate`, `critique`, `judge`, `resolve`, or `done`.
- `queue`: the piece ids still to process in this phase, in order. The clerk removes an
  id only after that unit's outputs are on disk and committed.
- `notes`: free text for the next session, such as a blocker or a half-finished unit.

## The loop

One begins or continues a wave from its current phase through `resolve`, then stops
and reports. If the budget guard trips, the session stops at a unit boundary, and the next session resumes from
`state.json`.

1. **Start.** Read CLAUDE.md, this file, `state.json`, `pieces.json`, and the tail of
   LOG.md. If the repo has no commits yet, commit everything as the baseline. If
   `node_modules/` is missing, run `npm install`. Run the budget guard.
2. **Handle the phase**, as described below. After each unit: write its outputs, update
   `state.json` and `pieces.json`, append to LOG.md, and commit with a message like
   `hurdles wN build: combat`. Then run the budget guard again.
3. **Advance** the phase when its queue is empty:
   `build -> integrate -> critique -> judge -> resolve -> (next wave build | done)`.

### build

Queue for wave 1: every piece in `pieces.json` order. Queue for a later wave: the
pieces whose status is `lost`, in `pieces.json` order.

Work through the queue **serially**, one builder agent at a time, using
`prompts/builder.md`. Serial matters because pieces share the codebase and later
pieces build on earlier ones. After each builder finishes, the clerk runs the smoke
test. If it fails, send the same builder back once (via SendMessage) with the output.
If it still fails, record that in `notes` and move on. Set the piece's status to `built`.

**Smoke test:** run `node tools/capture.cjs --url "/?showcase=<id>" --out
shots/smoke/<id> --wait-ready`, then the same for `/` (title) and for
`/?scene=run&seed=1`. Each must exit 0, meaning no console errors, and produce a
non-blank screenshot.

### integrate

Spawn one agent with `prompts/integrator.md`. It plays the whole game, from the title
through at least two arenas, a corridor, and the boss via showcase, and smooths seams
across pieces. It may edit any file, and fixes `foundation` defects directly. It verifies `foundation` against its `must_have` list and writes
`waves/wN/integration.md`. The clerk commits.

### critique

Queue: every judged piece whose status is not `won`, plus any `won` piece whose owned
files changed since the commit recorded in its last `won` history entry
(`git diff --stat <commit> -- <owns>`).

Work through the queue **serially, one critic agent at a time**, using
`prompts/critic.md`. A critic writes its review and matched captures, then runs `tools/blind.cjs` to create
the packet and key. Afterwards the clerk checks that the packet, key and `criteria.md`
exist. If `review.md` starts with a `PIN:` line, the clerk copies it into the piece's
`reference` as `{url, rating, why, pinned_wave}`.

### judge

Queue: the same pieces. For each packet, spawn one judge with `prompts/judge.md`,
in parallel batches of up to 4. The judge prompt contains only the packet path
and the piece's `judge_focus`. The prompt must not contain the piece's review, the
word "ours", which side is ours, or the key path.

### resolve (clerk, mechanical)

For each piece in the queue, read `keys/<id>.json` and `verdicts/<id>.json`. If the
winner is ours, the piece has `won`. A `tie` also counts as won, because "at least as
good" is the bar. Otherwise the piece has `lost`, and the verdict's `loser_biggest_gap`
becomes the headline for the next builder. Append to `history` (record the
current commit hash on a win) and set `status`. Then:

- If any piece is `lost`: `wave += 1`, `phase = build`, and `queue` = the lost pieces.
- If every judged piece is `won`: `phase = done`. Write a final LOG entry summarising the run.

Finish with a short report to the user: one line per piece (verdict and the biggest
gap), plus what the next wave will do.

### Filling the prompt templates

- `{{job}}` in wave 1: "Build this piece to a finished state, working from whatever
  already exists." In a later wave: "Close the gap to the reference. Headline, from
  the blind judge: <loser_biggest_gap>. Also address the critic's top problems.
  Everything else in the piece must stay at least as good as it is."
- `{{history_block}}` in wave 1: "No history yet." In a later wave: the paths of this
  piece's earlier `review.md` and verdict files, newest first, with the instruction to
  read them all.
- `{{reference_block}}` if `reference` is set: "Use the pinned reference: <url>. Do
  not substitute another." If it is null: "No reference is pinned yet. Choose the
  strongest fitting one following the References rules, and pin it (see Review)."
- `{{packet_dir}}`: `hurdles/waves/wN/blind/<id>`. `{{verdict_file}}`:
  `hurdles/waves/wN/verdicts/<id>.json`. `{{judge_focus}}`: copied verbatim from
  pieces.json.

## References

A reference must be a real, highly rated game on itch.io that does the same job as
the piece. Prefer one listed at `https://itch.io/games/top-rated` (filter by tag or
genre), or one with at least 4.5 stars from at least 50 ratings. Record its URL and
rating in `reference`.

Prefer games that run in the browser (HTML5). A critic can load the game's iframe
source (`html-classic.itch.zone/html/<id>/index.html`, found in the game page's HTML)
directly with `tools/capture.cjs`, play it with scripted keys, and capture live frames.
Otherwise, use the page's screenshots and GIFs (`img.itch.zone`, downloaded with curl)
and turn GIFs and webm into strips with `tools/sheet.cjs video`. For mp4 trailers,
Chromium can't decode h264, so use the system ffmpeg (`/usr/bin/ffmpeg`, 8.0.1, full
build): `ffmpeg -ss 5 -t 3 -i clip.mp4 -vf "fps=10,scale=320:-1:flags=neighbor,tile=6x5"
-frames:v 1 strip.png`. `yt-dlp` is not installed, so embedded YouTube trailers are out of reach.

Pinning is permanent, so the goalposts cannot move. The first critic of a piece picks
the strongest fitting reference it can find, not an easy one. Later critics must use
the pinned reference.

## Blind comparison rules

- **Matched content.** `ours/` and `ref/` hold the same number of images in the same
  order, each pair showing the same kind of moment: title against title, a hit
  landing against a hit landing, a strip against a strip. Use `NN-<moment>.png` names.
  The moment name is visible only in the critic's folders. The packet renames everything.
- **Same presentation.** Match the aspect ratio and apparent zoom as closely as the
  reference allows. Crop UI chrome such as the itch page frame. Never crop ours
  flatteringly or the reference unflatteringly.
- **Motion** is judged from frame strips (bursts, or `sheet.cjs video`), with the same
  frame rate and count on both sides.
- **Audio** cannot be seen or heard by a judge. For the audio piece, the critic records
  the master bus (MediaStreamDestination plus MediaRecorder) on both sides where
  possible. It exports the recordings, then renders a spectrogram per clip with
`ffmpeg -i clip.webm -lavfi showspectrumpic=s=1024x256:legend=0 spec.png`, and writes a
  `packet/criteria.md` note describing each side in neutral terms, without saying
  which is ours. This comparison is the weakest in the method. Treat an audio win as
  provisional and re-critique audio every wave until the rest are won.
- The judge answers `A`, `B`, or `tie`. A `tie` must be justified as "genuinely
  indistinguishable in quality". It is never a hedge.

## Game contract (every builder must keep this working)

- The game is served statically from the repo root (`index.html` plus ES modules).
  There is no build step, and `three` resolves through the import map to `node_modules/three`.
- URL parameters: `?scene=title|run|boss`, `?seed=<int>`,
  `?showcase=<piece-id>[&...piece params]`, and `?debug=1` (overlay).
- `window.__GR` exposes:
  - `ready` (boolean): the first real frame has been drawn
  - `frame` (sim tick count), `scene` (current scene name), `seed`
  - `state()`: a JSON snapshot of `{scene, hero: {x, z, hp, maxHp}, room, enemies: [...], boons: [...]}`
  - `debug.timeScale(s)`, `debug.god(on)`, `debug.spawn(type, x, z)`, `debug.goto(roomIndex)`,
    `debug.give(boonId)`, `debug.hurt(n)`, `debug.kill()`: add hooks here as pieces need them,
    and never remove one.
- There are no console errors in normal play. A critic treats any console error as a
  defect in the piece that caused it.

## Budget guard

Run the `usage-check` skill at the start and after every unit. If the session window
(5-hourly) is at 50% or more, or the weekly window is at 95% or more, start nothing new. Make
sure state is consistent and committed, then stop and tell the user the reset time.
Never leave a phase half-recorded. Either a unit's outputs and state update are both
committed, or the unit is left in `queue` to redo.

## Stopping

The loop is done when every judged piece's latest verdict is won or tie. Integration
always runs before critique, so the verdicts are about the integrated game. There is
no round limit.
