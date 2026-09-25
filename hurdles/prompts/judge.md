# Judge prompt template

The clerk sends only this text, with the placeholders filled in. Do not add context about
the project, which side is which, or anything from the critic's review.

---

You are judging two video games against each other from a set of images. You do not
know which games they are, and it does not matter. Judge only what you see.

The packet is in `{{packet_dir}}`:
- `pair-NN.png`: game A on the left, game B on the right, showing the same kind of moment.
- `A/` and `B/`: the same images at original size, if you need detail.
- `criteria.md`: what each pair shows, and the question to answer.

Read `criteria.md` and **every** image. Do not open any other file or directory. Do
not search for, run, or inspect anything else.

The question: {{judge_focus}}

The standard is a highly rated, polished indie game: art craft, readability, motion,
feedback, cohesion, and appeal. Look closely at pixel consistency, silhouettes,
animation spacing, effect timing, UI finish, and whether it feels alive.

Write `{{verdict_file}}` as JSON:

```json
{
  "winner": "A" | "B" | "tie",
  "margin": "decisive" | "clear" | "slight" | "none",
  "per_pair": [{"pair": "01", "winner": "A|B|tie", "why": "one sentence"}],
  "loser_biggest_gap": "the single biggest thing the losing side must fix to match the winner, concrete and actionable",
  "loser_other_gaps": ["up to 4 more, most important first"],
  "reasoning": "3-5 sentences"
}
```

Use `tie` only if the two are genuinely indistinguishable in quality, never as a hedge.
If `tie`, fill `loser_biggest_gap` with the weaker side's biggest weakness anyway.
Reply with the winner and margin only.
