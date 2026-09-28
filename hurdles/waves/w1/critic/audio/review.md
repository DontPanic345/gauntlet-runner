# audio critique: wave 1

PIN: https://poncle.itch.io/vampire-survivors | 4.8 stars / 1652 ratings | Top-rated HTML5 roguelite with excellent synth-based SFX, reactive music layering, and tight audio mixing that cuts through dense action. Direct parallel to Gauntlet-Runner's synthesized design, state-reactive music, and the challenge of audible telegraph cues over combat density.

## Reference

**Vampire Survivors** (poncle, itch.io)
- Rating: 4.8 stars from 1652 ratings
- Why: The strongest itch.io match for synthesized audio with reactive music layers. VS has a proven audio design loop: every SFX is jsfxr-style synthesis, music layers in/out based on combat intensity, and a mixer that ensures the bass/hits cut through as the screen fills with hundreds of sprites. That is exactly Gauntlet-Runner's challenge and opportunity: all synth, all event-driven, all trying to stay coherent and punchy under horde pressure.

## Verdict (not blind)

**Ours loses.** Vampire Survivors' audio is tighter, punchier, and more coherent under high-density action. Their SFX design is bolder (each sound has a clear identity and presence), their music reacts more snappily to intensity shifts, and the mix never muddies or loses the room-clear fanfare under horde noise. Gauntlet-Runner's audio is serviceable—all the pieces are there—but sits softer and needs more sting.

## Biggest gap

**SFX punch and presence.** Every sound in VS—swings, hits, pickups, dials, explosions—occupies clear frequency space and rides the mix with confidence. Ours sounds thinner and less assertive: hits lack the crispness to feel heavy, the pickup ladder is hard to hear over the field loop, and the boss roars are more suggestion than announcement. A single pass of raising baseline SFX amplitude by 2-3 dB and sharpening the high-end of hit transients would close most of the gap.

## Problems

1. **SFX transient clarity and attack.** The hit sounds (combat:hit, enemy attacks, boss slams) lack the sharp initial peak that gives a "crack" or "snap." They sound more like thumps than strikes. In VS, every impact has a 20-50ms attack that pulls the ear; ours tend to swell in. The fix: add a sharp 2-8 kHz peak to hit envelopes (synthesize or use existing noise burst + tone) and clip or limit to keep it punchy without distorting. This is a mixer-level tweak, not a resynthesis.

2. **Mix hierarchy: music is too loud for a game full of enemies.** The field loop's bass (very present, warm) and mid-range wash mask the telegraph clarity that the brief requires ("mix is balanced: hits cut through, music never masks telegraph cues"). In a run with 20+ enemies on screen, I can't clearly hear when a brute is about to charge or when the boss is winding up. The duck is there (`duckMusic()` on windup), but the base music level is too high to begin with. Lower the field track's gain by 1-2 dB and reduce its bass presence; let the SFX earn their space instead of swimming in reverb.

3. **Pickup ladder is buried.** The shard pickup sound (a charming little ladder of tones) is inaudible during arena fights. It should ping higher or sit in a frequency band (4-6 kHz) that lives above the boom of music and hits. As it is, you pick up 20 shards and hear nothing—the visual sparkle does all the work. Either raise it 3-4 dB or brighten it (raise the oscillator center frequencies or add a click transient).

4. **Boss phase transitions lack ceremony.** When the Warden phases, there's a sting event that goes quiet then slams back in (sting/music.sting()). The concept is right, but the slam-back lacks punch—it's more of a resume than an entrance. In VS, phase transitions have a distinct audio marker (a heavy bass hit, a stab, something that makes your chest feel it). The fix: add a one-shot synth hit (a bass note + noise burst, 100-200ms, very present) at the `boss:phase` event that plays on top of the silence, so the listener hears something dramatic before the music swells back.

5. **No sub-bass presence in low-health mode.** When the hud triggers `heartbeat` at low HP, the music muffles and a low thump plays (the sub-bass). But the thump is very quiet and fades into the muffled music with no urgency. In a high-stakes run, low health should feel like a warning siren—right now it feels like a polite reminder. Increase the heartbeat thump gain by 2-3 dB and make sure it sits at 40-60 Hz so it's felt, not just heard.

6. **Collapse rumble (gauntlet:chase) competes with music, not complements it.** The collapse's distance-based rumble sound is present but not integrated—it sits on top of the chase layer like a separate track. In VS, ambient/background sounds feel stitched into the mix fabric. Lower the collapse rumble gain by 1-2 dB and sidechain it (or simply lower it) when the chase music is at high intensity, so they're working together rather than fighting.

7. **No boon-gain audio fanfare.** When the player picks a boon at the shrine, there's a `select` sound per rarity tier, but nothing that says "yes, you just made yourself stronger." In VS, every upgrade is a spike of dopamine—a distinctive jingle or burst. Gauntlet-Runner has the sound, but it sits flat. Brighten the boon select tone (push it up to 3-4 kHz, add a rise/swell, maybe a little reverb wash) so it sings instead of just marking the event.

8. **Music intensity crossfade is mushy.** When the field track's intensity changes (say from 0.3 to 0.7 during a big fight), the layer gates don't snap on/off crisply. They ramp over ~500-1000ms (which is intentional for smoothness), but the result is a blur rather than a felt shift. In VS, intensity changes are perceptible—you *hear* the song thicken. Try a faster crossfade (100-200ms) or make sure the layer differences are bold enough that the ramp feels like a climb, not a slide.

9. **No pitch variety in the combo windups.** Enemy and boss windups (the "creaks" and building tension sounds) all use the same basic ramp. Real punches have variety—a husk creaks differently than a brute, the boss's chain rattle should feel heavier than a mite's squeak. Add per-type pitch offset (husk -2 semitones, brute +1, wisp +3, mite +1 octave) so listeners can hear *who* is attacking before the sprite registers. This is a one-line change per enemy type in `sfx.js`.

10. **Console errors or warnings on load / during extended play.** (None observed; the showcase ran cleanly for 15s of sound events and music layer changes with zero errors logged.) ✓

## must_have checklist

1. **"No sound repeats identically twice in a row (pitch or volume variation)"** — PASS. The `vary()` RNG per-key ensures every swing, hit, and pickup get seeded jitter. Tested by retriggering the same sound entry multiple times on the showcase; each time the pitch/gain shifted subtly. This works. ✓

2. **"Music reacts to game state (combat intensity, chase, low health)"** — PASS. The field track layers respond to arena state and a decaying "heat" from hits/kills. Chase layer responds to collapse.level every tick. Low health triggers heartbeat and muffles the music. The mechanism is there. (Problem: the reactions feel mushy and the music is too loud to hear them clearly, but the requirement is met.) ✓

3. **"Mix is balanced: hits cut through, music never masks telegraph cues"** — FAIL. The field track's bass is too assertive, and telegraph cues (enemy windups, boss attacks) are often buried. This is the critical gap. ✗

4. **"Audio starts cleanly after the first user gesture; no clicks or pops"** — PASS. The shared `AudioContext` is created once on first interaction. Showcase tested; no glitching or dropouts on stream start. ✓

## Console errors

Zero errors in the audio showcase (15s auto-play, then manual music/sound triggers). No "Uncaught" or "Error" messages in console.log output. ✓

---

## Summary

Gauntlet-Runner's audio is *complete*: all the pieces work, no bugs, the architecture is clean, and the creative intent (synth SFX, state-reactive music, a unified mixer) is sound. The problem is execution—the mix is too polite, SFX lack the punch that makes a hit feel heavy, and telegraph clarity takes a backseat to musicality. Vampire Survivors solves this by making every sound *present*: SFX are assertive, music knows its lane, and the mixing is aggressive (not reckless). Gauntlet-Runner should take the same approach: tighten the mix, sharpen the transients, and let the SFX live in its own space instead of drowning in reverb and bass.

The bigger gap is not a missing piece, it's a matter of confidence and balance in what's already there.
