# Chart Retuner — planning

This file holds **only future / not-yet-implemented work**, in enough detail
to pick up and build from. Everything already shipped — the design rationale,
the (retired) patch-point contract against upstream `highway_3d`, the full
phase log, and the sync log — lives in [`HISTORY.md`](HISTORY.md).

**Since v0.5.0 (2026-07-17)** the plugin is a provider of feedBack's
`chart-transform` capability domain (feedBack#952): `src/main.js` registers
the remap engine via `register-provider`, core substitutes the chart for
the built-in renderer AND scoring consumers, and the old renderer copy +
upstream-sync process are retired. `settings.html` is the former
`settings-waiting-for-feedBack-support.html` (renamed into place).

---

## Post-migration follow-ups

1. ~~**Orphaned storage cleanup**~~ — DONE in v0.5.0: `src/main.js` runs a
   one-time sweep (`chart_retuner_storage_cleanup_v1` guard) deleting every
   `chart_retuner_bg_*` key outside the kept set (`targetTuningId{Bass,
   Rhythm,Lead}`, `customTunings`, `tuningAdjustOverrides`, `activeTuning` —
   the migrated legacy `targetTuningId` and all per-panel `bg_panel<N>_*`
   keys go too) plus all `chart_retuner_viz3d_*` Butterchurn state. Server-
   side leftovers under `{config_dir}/plugin_uploads/chart_retuner/` are NOT
   swept (the plugin no longer has a backend); harmless, delete manually.
2. **minHost bump** — currently `0.3.0-alpha.1` (the local core that ships
   the chart-transform domain). Pin to the first tagged core release that
   includes the domain once it exists; on older hosts the plugin loads but
   the domain dispatches report `no-owner` (remap unavailable, no errors).
3. **Nut labels / capo marker** — pre-0.5.0 affordances with no core
   equivalent yet. If core grows a nut-label or capo-marker surface, feed it
   from the resolved tuning's `labels` / capo (the transform already exports
   `tuning`, `stringCount`, and `capo`).
4. **Per-panel (splitscreen) independent targets** — splitscreen panels DO
   remap: core installs the active provider on every highway instance
   (announced via `highway:created`), and each panel restages against its
   own `songInfo`, so per-panel arrangement classes resolve exactly as
   pre-0.5.0 versions did. What remains future is *different tuning
   targets per panel* beyond the per-class profiles — blocked on core's
   chart-transform per-panel selection follow-up.

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
- `screen.js`: per-panel `_crChordSpan` refreshed at both PATCH POINTs
  (`_primeActiveTargetTuningForInit`, `_bgLoadSettings`) — like `_crMaxFret`,
  it never affects strings/colors, so it must not trigger the palette
  branch.
- `settings.html`: a `<select>` in the tuning editor + a mirrored option
  list (legacy panel only — `settings-waiting-for-feedBack-support.html`
  reads `BUILTIN_PRESET_TUNINGS` and validators from the imported module,
  so a new field there is picked up with no mirror).

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
rendered; the name field flows straight into the chord-diagram HUD).
Decisions to make at build time:
- Marker only for degradation (rung > 0), or also for revoicing (tier ≥ 2,
  same pitches re-fingered)? Recommendation: degradation only — revoiced
  chords still sound the full chord, so flagging them reads as noise.
- Confirm nothing keys off template `name` equality in `screen.js` (grep
  before renaming; chord identity everywhere else is `chord.id`).
- Optional settings toggle if the marker annoys anyone; default on.

**Verify.** Solver test: a degraded rung yields a rebuilt template whose
name carries the marker and whose Tier-0 twin doesn't. Manual: play a chart
known to degrade (Eb-standard chart on a narrow-ceiling target).

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

### 4. Judgment translation for revoiced chords

**Problem.** Scoring (note_detect) keys judgments off the ORIGINAL chart
positions via `_origNote` — correct pitches for Tier-0 output, but a
revoiced (tier ≥ 2) or degraded chord has the player fretting *different
sounding pitches* than the chart expects, so judgments drift from what's
actually played. Documented in the README as a known gap.

**Status: research item, not currently buildable plugin-side.** note_detect
compares detected audio pitch against chart data it reads itself from
`highway.getNotes()`/`getSongInfo()`; this plugin never mutates those (by
design — see HISTORY.md, "scoring unaffected"). A real fix needs a core or
note_detect contract change, e.g. a scorer-side "expected-pitch translation"
hook a viz can register, or pitch-class-tolerant judging. Track alongside
the upstream conversation (feedBack#952). What the plugin *could* do today:
contribute a diagnostics payload counting revoiced/degraded chords per song
so the size of the problem is measurable in the field.
