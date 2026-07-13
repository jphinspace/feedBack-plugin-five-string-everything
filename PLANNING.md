# Chart Retuner — planning

This file holds **only future / not-yet-implemented work**, in enough detail
to pick up and build from. Everything already shipped — the design rationale,
the patch-point contract against upstream `highway_3d`, the full phase log,
and the sync log — lives in [`HISTORY.md`](HISTORY.md).

---

## Ongoing process — syncing from upstream `highway_3d`

Our tuning-remap logic lives entirely in the documented patch points (listed
in `HISTORY.md`); everything else in `screen.js` is `highway_3d`'s own code
and must be periodically re-pulled from the **canonical** upstream
(`github.com/got-feedBack/feedBack`, `plugins/highway_3d/`) rather than
silently drifting.

Repeatable procedure:

1. Shallow-clone the canonical upstream into a scratch directory — never add
   a remote to, or otherwise modify, any local `feedBack` checkout.
2. Diff upstream's `plugins/highway_3d/` against whatever this plugin was
   last synced to (recorded in `HISTORY.md`'s sync log) file-by-file. If only
   `screen.js`/`plugin.json` differ, the sync is just a `screen.js` merge; a
   `settings.html` divergence additionally needs the Phase 7 isolation
   renames (globals, storage keys, DOM ids — see `HISTORY.md`) re-applied to
   whatever's new.
3. For each upstream `screen.js` hunk, locate the equivalent surrounding text
   in our copy (search on a unique line from the hunk, not line numbers —
   line counts have diverged) and apply the same change. If a hunk touches
   anything on the patch-point list (the `CR` retuner block,
   `resolveStringCount`, nut labels, the notes/chords/anchors/templates
   substitution shim, the color palette, note-state provider calls, or any
   renamed `h3d*`/`h3d_bg_`/`viz3d_*` identifier), reconcile it by hand and
   flag it to the user — never copy blindly.
4. Verify: `node --check screen.js`, `node test/retune-engine.test.mjs`,
   `node test/chord-solver.test.mjs`, and extract + `diff` the newly-applied
   region against upstream's to confirm the reapplication was byte-exact.
5. Append a sync-log entry to `HISTORY.md` (upstream version/commit, what
   changed, patch-point overlap or none) and bump this plugin's own version.

---

## Migration goal — retire the forked highway in favor of feedBack's built-in

The fork exists only because core has no hook to transform a chart's
notes/chords/tuning before a renderer reads them (see HISTORY.md, "Settled
design"). Once the main feedBack application supports this plugin natively —
tracked upstream at feedBack#952 — the plugin keeps its pure remap engine
(`src/`) and sheds the rendering fork:

- **`settings-waiting-for-feedBack-support.html`** already exists as the
  post-migration settings panel: JUST the plugin-specific parts (the Target
  Tunings section — profile selects, custom tuning editor with strings/
  colors/max fret/capo/octave, manage list), none of the "3D Highway — …"
  rendering sections that only configure the forked renderer. At migration
  time, point `plugin.json`'s `settings.html` at it (or rename it into
  place). **Until then, keep its Target Tunings MARKUP in lockstep with
  `settings.html`'s** — it was copied verbatim and must stay that way. Its
  inline SCRIPT deliberately diverges: it dynamic-imports the real `src/`
  modules instead of hand-mirroring their constants (the old "mirrored
  constants" backlog item, resolved 2026-07-13 for this file only —
  `settings.html` keeps its mirrors and dies with the fork, so don't port
  script changes blindly in either direction).
- What else goes at migration time: the forked `screen.js` (and with it the
  Phase 7 isolation renames, the upstream-sync process above, the
  `routes.py` video-upload endpoints, Butterchurn assets, and the
  `chart_retuner_bg_*`/`chart_retuner_viz3d_*` storage namespace — plan a
  one-time cleanup/migration for users' saved values where a core
  equivalent exists).
- What stays: everything under `src/` (pitch, target-tuning, retune-engine,
  chord-solver, string-colors), the tests, the tuning-profile settings keys
  (`targetTuningId*`, `customTunings`, `tuningAdjustOverrides`), and the
  player-controls capo/octave widget (already written against the
  documented v3 `playerControlSlot()` contract, not fork internals).

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

### 2. Anchor-donor refinement after revoicing

**Problem.** `remapAnchors` (`src/retune-engine.js:157`) gives each anchor
the fret adjustment (`note.f − note._origNote.f`) of the nearest fretted
remapped note at/after its time. A tier ≥ 2 revoiced donor (octave-shifted
placement) can carry a huge adjustment, lurching the hand-position highlight
band to a nonsense fret for that passage. Cosmetic — gems are unaffected.

**Design.**
- In `createRetuner`, tag every materialized note copy with its solve tier
  (`copy._crTier = solved.tier`, and `0` on the single-note/per-note path) —
  the tier is already in hand at both materialization sites (template branch
  and ad-hoc `solveChord` result, `src/retune-engine.js` around `:373–:423`).
- In `remapAnchors`, when scanning for a donor, prefer the nearest
  **tier-0** fretted note within a small forward window (a few notes or
  ~2 s) before falling back to the current nearest-note rule. Keep the
  existing single forward-scanning-pointer shape — one extra lookahead loop
  bounded by the window, still O(notes) per song, computed once per remap,
  never per frame.

**Verify.** A synthetic chart where the first note after an anchor is a
revoiced chord note (+12 adjustment) and a tier-0 note follows shortly:
anchor takes the tier-0 donor's adjustment. Existing anchor tests unchanged
(all-tier-0 charts behave identically).

### 3. Degraded-chord label marker

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

### 4. Per-string fret floor (banjo drone, short strings)

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

### 5. Judgment translation for revoiced chords

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

### 6. Handle nonzero `cent_offset`

**Problem.** RS2014's global `cent_offset` is ignored (MVP guardrail, noted
in HISTORY.md) — nothing in `src/` or `screen.js` reads it. A chart whose
recording is offset by a semitone or more (some A=432 / half-step-down
masters encode this rather than adjusting `tuning[]`) remaps every note off
by the rounded semitone amount.

**Design sketch.** First, measure: check how `lib/song.py` exposes it
(`songInfo.centOffset` is already in the bundle — Phase 16 saw it in the
`matchesArrangement` songInfo shape) and whether real charts in the wild
carry |offset| ≥ 50 cents. If yes: fold
`Math.round(centOffset / 100)` into the source side of the offset math
(`sourceOpenStringOffset` in `src/retune-engine.js`) and into the retuner's
chart-identity cache key. Sub-semitone offsets stay ignored — the engine is
integer-semitone arithmetic and the player's real instrument is presumably
in tune with itself.

**Verify.** A synthetic chart with `cent_offset: -100` remaps identically to
the same chart with `tuning[]` lowered one semitone; ±50-cent inputs change
nothing.

### 7. Chunk the cold solve across frames

**Contingency only — do not build without a real report.** Cold remap of a
60-template / 2000-note synthetic chart measured ≈ 4 ms (once per song or
tuning switch, inside the whole-remap cache); per-frame apply is ≈ 0.1 µs.
If a pathological chart (thousands of distinct simultaneous-note shapes)
ever visibly hitches on load, split `createRetuner`'s template-solve loop
across rAF ticks behind the existing cache. The bucket-signature cache makes
this scenario unlikely.
