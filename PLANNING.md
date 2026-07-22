# Chart Retuner — planning

This file holds **only future / not-yet-implemented work**, in enough detail
to pick up and build from. Everything already shipped — the design rationale
and the full phase log — lives in [`HISTORY.md`](HISTORY.md).

---

## Future enhancements

None blocking; each is a candidate for its own phase. Ordered roughly by
expected user-visible value.

### 1. Per-preset chord stretch allowance

**Problem.** `MAX_CHORD_SPAN = 3` (`src/chord-solver.js:48`, max−min fretted
frets, i.e. a 4-fret box) encodes a guitar-scale hand. Short-scale /
high-register targets (violin, viola, mandolin, ukulele) make wider reaches
normal — and fifths tunings *need* them — so the solver revoices or degrades
chords a real player would just stretch for.

**Design.** Follow the Phase 15 `maxFret` pattern exactly — it threaded a
per-profile value through the same layers this needs:
- `src/target-tuning.js`: optional `chordSpan` field on
  `BUILTIN_PRESET_TUNINGS` entries and custom-tuning profiles; a fixed
  option list (e.g. 3/4/5/6, matching how maxFret avoids free-text) +
  `isValidChordSpan`/fallback-to-3 in `resolveActiveTuning`, which returns
  it alongside `maxFret`/`capo`/`octaveOffset`. Candidate presets: violin /
  viola / mandolin / ukulele get 5 (a fifth-tuned instrument's "one finger
  per diatonic step" hand covers more frets); everything guitar/bass-shaped
  keeps 3.
- `src/chord-solver.js`: `isPlayable` (`:161`) and `solveVoicingSearch`'s
  `allowedSpan` (`:304`) take a `span` parameter defaulting to
  `MAX_CHORD_SPAN`; the existing `Math.max(span, spec.span)` source-stretch
  escape hatch stays.
- `src/retune-engine.js`: `createRetuner().apply(bundle, targetMidiTuning,
  maxFret, chordSpan)` threads it into every solver call **and folds it
  into the internal `targetSig` cache key** (two profiles sharing strings
  but different spans must not cache-hit each other — same rule as maxFret).
- `screen.js`: thread the resolved profile's `chordSpan` into the
  `_transform()` call alongside `maxFret` — it never affects strings/colors,
  so it doesn't touch the tuning/capo output fields.
- `settings.html`: a `<select>` in the tuning editor — it reads
  `BUILTIN_PRESET_TUNINGS` and validators from the imported module, so a
  new field there is picked up with no mirror.

**Verify.** Solver-level: a chord solvable only at span 5 degrades at span 3
and solves at 5; `createRetuner` end-to-end with a mandolin-style target +
cache-invalidation on a span-only change. Existing suites must pass
unchanged (defaulting keeps every current call site byte-identical).

**Alternative considered:** deriving span from the target's register
(higher median open-string MIDI → shorter scale → wider span). Rejected as a
default because it guesses wrong for e.g. a high-tuned guitar; an explicit
per-preset value with a sane fallback is more predictable. Could be revisited
as the *default* the editor pre-fills.

### 2. Degraded-chord label marker

**Problem.** When the degradation ladder simplifies a chord (rung > 0), the
diagram still shows the chart's original name — "Am7" over a power chord.

**Design.** `solveChord` already returns `{ placements, tier, rung }`.
Where `createRetuner` rebuilds a `chordTemplates` entry from a solved
voicing, append a marker to the rebuilt template's display name when
`rung > 0` (e.g. `"Am7 ▾"` or `"Am7 (simplified)"` — pick after seeing it
rendered; the name field flows straight into a consuming renderer's chord
diagram). Decisions to make at build time:
- Marker only for degradation (rung > 0), or also for revoicing (tier ≥ 2,
  same pitches re-fingered)? Recommendation: degradation only — revoiced
  chords still sound the full chord, so flagging them reads as noise.
- Optional settings toggle if the marker annoys anyone; default on.

**Verify.** Solver test: a degraded rung yields a rebuilt template whose
name carries the marker and whose Tier-0 twin doesn't. Manual: play a chart
known to degrade (Eb-standard chart on a narrow-ceiling target) and confirm
the marker shows in a chord-diagram-capable renderer.

### 3. Per-string fret floor (banjo drone, short strings)

**Problem.** A 5-string banjo's drone string physically starts at the 5th
fret and is never barred; the solver and per-note walk have no per-string
floor, so they can place low fretted notes on the drone lane that don't
exist on the instrument.

**Design.**
- Preset/profile field `fretFloors: number[]` (per target string, default
  all 0). Model playable frets on a floored string as `f === 0` (the open
  drone) **or** `f >= floor` — the region in between doesn't exist.
  banjo5_gdgbd: `[5, 0, 0, 0, 0]` (string 0 is the drone).
- `resolveTargetForFret` (the pitch-ordered walk): treat a placement that
  violates the floor as out-of-range on that string and keep walking —
  needs care with the direction lock so a floored middle string doesn't
  falsely prove "fits nowhere" (skip, don't reverse).
- `chord-solver.js`: `isPlayable` rejects floored placements; the search's
  per-string candidate enumeration skips the dead fret range. "Never
  barred" is a separate, softer constraint — probably fold into
  `computeChordFingers`' barre grouping (drone never joins a barre run)
  rather than the cost function, and only if real banjo usage materializes.
- Thread through `resolveActiveTuning` → `apply()` → `targetSig`, same as
  maxFret/chordSpan.

**Verify.** Re-run the Phase-14 banjo5 full-chart sweep with floors on:
zero placements in the dead range, drone still used for reachable notes,
notes that only fit the dead range drop (or land elsewhere) rather than
rendering impossible positions.

**Priority note:** wait for evidence banjo targets see real use — the field
touches every remap layer.

### 4. Judgment translation for revoiced chords — mostly resolved by the chart-transform migration

**Original problem.** Scoring (note_detect) used to key judgments off the
chart's ORIGINAL positions — correct for a Tier-0 exact remap, but a
revoiced (tier ≥ 2) or degraded chord had the player fretting *different
sounding pitches* than a note-for-note reading of the chart implied.

**Status since the chart-transform migration (see HISTORY.md).** The notes
this plugin now hands back through `getNotes()`/`getChords()` already carry
the FINAL (possibly revoiced) string/fret assignment, paired with
`getTuning()`/`getCapo()` describing the same target. A scorer computing
expected pitch from those — the standard `base + tuning + capo + fret`
formula every chart-transform-aware consumer uses — gets the correct
pitch for whatever is actually being played, revoiced or not. The
remaining dependency is entirely on the scorer's own implementation
(note_detect, out of this repo) reading chart data through the
transform-aware getters rather than a private snapshot — not something
this plugin can verify or fix from here. No further plugin-side work is
planned unless a scorer is found not to follow the standard getters.
