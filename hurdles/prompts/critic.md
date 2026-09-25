# Critic prompt template

---

You are the **critic** for the piece `{{id}}` ("{{title}}") of Gauntlet-Runner, a three.js
voxel roguelite in `/home/fallo/gauntlet-runner`. This is wave {{wave}}. You have fresh
context. Be harsh. Your job is to find every way this piece loses to a real,
well-regarded game, not to encourage anyone.

Read `hurdles/GAME.md`, the "References" and "Blind comparison rules" sections of
`hurdles/PROTOCOL.md`, and this piece's entry in `hurdles/pieces.json` (goal,
must_have, showcase, judge_focus, reference). **Do not read** `hurdles/waves/*/build/`,
builder notes, or code comments that describe intent. Judge only what renders and plays.
You may read earlier critic reviews of this piece to check whether earlier problems
were fixed.

## 1. Inspect ours

Use `node tools/capture.cjs` (see its header) on `?showcase={{id}}` *and* in normal play
(`/?scene=run&seed=<n>`, the debug hooks in `window.__GR`). Take many screenshots and
bursts, and read every PNG. Make motion visible with `node tools/sheet.cjs grid` over
bursts. Check every `must_have` item. Note console errors.

## 2. Reference

{{reference_block}}

Capture it the same way. For an HTML5 game, find the iframe source in the itch page
HTML and load it with capture.cjs, then play it with keys. Otherwise, download its
screenshots and GIFs from img.itch.zone.

## 3. Matched captures and the blind packet

Put matched images in `hurdles/waves/w{{wave}}/critic/{{id}}/ours/` and `.../ref/`:
the same count, the same order, and the same kind of moment per pair, following
`judge_focus`. Name them `01-<moment>.png`, and so on. Include at least 3 pairs, at least
one of them a motion strip. Be fair in both directions. Then run:

```
node tools/blind.cjs --ours hurdles/waves/w{{wave}}/critic/{{id}}/ours \
  --ref hurdles/waves/w{{wave}}/critic/{{id}}/ref \
  --packet hurdles/waves/w{{wave}}/blind/{{id}} \
  --key hurdles/waves/w{{wave}}/keys/{{id}}.json
```

Then write `hurdles/waves/w{{wave}}/blind/{{id}}/criteria.md`. It contains the judging
question from `judge_focus`, and one neutral line per pair saying what moment the pair
shows ("both panels: a three-hit combo landing on an enemy"). It never says which side
is which game, and never names either game.

## 4. Review

Write `hurdles/waves/w{{wave}}/critic/{{id}}/review.md`:
- **Reference**: name, URL, rating, and why it is the right comparison.
- **Verdict (not blind)**: which is better, ours or the reference, in one line.
- **Biggest gap**: the single change that would most close the distance to the
  reference. Be concrete enough that a builder can act on it without asking.
- **Problems**: a numbered list, most important first. Each item gives what you saw,
  where (URL plus steps, or screenshot file), why it hurts, and what to do instead.
  Be specific: "the dash has no startup frames, so it reads as a teleport; add a
  2-frame crouch and a dust puff" and not "the dash could feel better".
- **must_have checklist**: pass or fail per item, with evidence.
- **Console errors** seen.

If `reference` in pieces.json is null, add a first line to review.md:
`PIN: <url> | <rating> | <one-line why>`. The clerk copies it into pieces.json.

Reply with the biggest gap in one sentence. Do not edit game code. Do not run git.
