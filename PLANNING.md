# Chart Retuner — bass & guitar tuning-remap plugin for feedBack

*Note: this plugin and repo were originally named "Five-String Everything"
(internal abbreviation `FSE` / `fse-retune.js`); renamed to Chart Retuner in
v0.2.0. The phase log below is preserved as written and still refers to the
old name and file paths where it describes historical state.*

## Context

feedBack charts are authored for one specific instrument tuning. A player with a
5-string BEADG bass currently has to retune their instrument (or own a bass in
every tuning a chart calls for) to play songs authored in Drop D, C standard,
Eb standard, etc. This plugin removes that friction for bass charts: it displays
each note at the correct string/fret position **for a BEADG bass**, so the
player can play any bass chart, in any source tuning, on one BEADG-tuned
instrument — as long as the note falls within a 20-fret BEADG bass's range
(open B, string 0, up to fret 20 on the G string, string 4).

**This is pure string/fret offset arithmetic, not a pitch/frequency
calculation.** One fret = one half-step. Target strings (BEADG) are each a
perfect fourth apart = 5 half-steps. Moving a note to a different target
string by `k` positions and adjusting its fret by the right number of
half-steps is a closed-form integer calculation — see Phase 2. The only
external numbers involved are: each source string's known half-step offset
from its instrument's standard tuning (already present in every chart as
`tuning`/`capo`), and the small set of standard open-string half-step
positions needed to compare source and target strings against each other,
i.e. the same fixed constants `lib/song.py`'s `_TUNING_BASE_MIDI` table
already uses (mirrored here purely as reference numbers for the offset
arithmetic — nothing about frequency/Hz is ever computed).

**Why this has to be its own renderer, not a hook or a data mutation.**
Research into feedBack's plugin contracts turned up two hard platform
constraints:

1. There is **no hook anywhere (backend or frontend) to transform a chart's
   notes/chords/tuning** before a renderer or the scorer reads them.
2. **`stringCount` is a private primitive** inside core's `highway.js`
   closure (`static/highway.js:178`, read-only via `getStringCount()` at
   `:3981`) with no setter, and `highway_3d`'s own fretboard lane count and
   `validString()` gate (`plugins/highway_3d/screen.js:4524-4533`) are driven
   by it. We can't make the *existing, installed* `highway_3d` plugin show 5
   lanes for a chart authored with a different string count without either a
   core code change or an undocumented hack (spoofing a fake WebSocket
   message to override that closure variable) — which we're avoiding.

**Resolved approach, confirmed with the user:** this plugin is its own
independent `setRenderer`-contract visualization plugin (the same pattern
`keys_highway_3d`/`drum_highway_3d` already use to coexist with `highway_3d`
without editing it) — built by **forking `highway_3d/screen.js` verbatim**
into this repo and patching it minimally. Because our copy is a fully
independent plugin, we own its internals outright: we can hardcode its string
count to 5 with zero risk to the installed `highway_3d`. **The rendering must
match `highway_3d` in every way — themes, video backgrounds, hand-shape
ghosting, everything — with note gem position being the only difference.**
Forking, not reimplementing, is exactly what makes that achievable for an
MVP: copy the file wholesale, then make one small, auditable patch at the
point where note/chord data is read each frame, rather than re-deriving 15,000+
lines of Three.js rendering.

**Why scoring is unaffected by a purely-visual remap.** Confirmed via research
into the (externally-installed) `note_detect` scorer: judgment compares the
player's *detected audio pitch* (mic/pickup input) against an expected pitch
computed from the chart's real, untouched tuning/capo/string/fret data
(`highway.getSongInfo()`/`getNotes()`). Our plugin never mutates
`bundle.notes`/`.chords`/`.songInfo` — it only draws its own visual copy. A
player physically fretting what our renderer shows on their real BEADG bass
produces the exact note the chart already expects, so scoring "just works"
with zero coordination with the scorer.

**Decisions locked in with the user:**
- Fork `highway_3d` and patch minimally; match it in every visual respect
  except gem position.
- Chord note collisions (two chord notes mapping to the same target string):
  keep only the lower-pitched of the two notes assigned to that string, drop
  the other. Per colliding string, not the whole chord.
- No enabled/disabled toggle setting. Instead, a placeholder settings panel
  showing only the plugin name and version (no controls). The plugin
  registers a `matchesArrangement` predicate (bass arrangements only) so
  feedBack's "Auto (match arrangement)" viz mode adopts it automatically for
  bass songs. The user "disables" it by picking a different renderer from the
  viz picker, or by uninstalling the plugin.
- **The transformation must be one general algorithm with no tuning-specific
  special cases.** In particular: a chart already in standard 4-string EADG,
  or in standard 4-string BEAD, must come out of the *same* transformation
  function with every note landing on the identical string and fret as the
  original chart — not because those tunings are detected and short-circuited,
  but because the general offset math naturally reduces to zero adjustment for
  them (worked out precisely in Phase 2).

**Plugin identity:** id `five_string_everything`, matching this repo's name.
This repo *is* the plugin's own git repo (per feedBack's convention — see
`plugins/pitchshift` as an example of a plugin-as-submodule), so all plugin
files live at the repo root, not nested under a `plugins/` directory.

**Scope guardrails for MVP** (explicitly out of scope, can revisit later):
- Bass arrangements only (`matchesArrangement` gates on `/bass/i`, same as
  the is-bass assumption baked into the offset engine).
- Fixed 5-string BEADG target tuning — no tuning picker. **Lifted
  post-MVP:** the target string COUNT stays fixed at 5, but which pitches
  those 5 strings are tuned to is now user-configurable (settings' Bass
  Tuning section — BEADG remains the built-in default). See
  `FSE.resolveTargetTuning` / `FSE.parseTargetNote` in `src/fse-retune.js`.
- `cent_offset` (RS2014 global pitch-shift field) is ignored, same as it's
  excluded from `lib/song.py`'s own note-pitch formula. Songs with a nonzero
  `cent_offset` will remap incorrectly; document as a known limitation.
- Settings UI is a static placeholder (plugin name + version only, no
  controls).

---

## Phase 1 — Fork highway_3d, scaffold, register

1. Write this phase breakdown to `PLANNING.md` at the repo root.
2. Copy `plugins/highway_3d/` from a feedBack checkout into this repo's root
   wholesale: `screen.js`, `assets/` (including `viz-worklet.js`,
   `vendor/butterchurn*`, `plugin.css`/`_plugin.src.css`/tailwind config),
   `tour.json`, `routes.py`, `settings.html` is **replaced** (see step 4),
   `NOTICE`/`README.md` carried forward for attribution.
3. Update `plugin.json` (copied from `highway_3d/plugin.json`) with our own
   identity: `"id": "five_string_everything"`, `"name": "Five-String
   Everything"`, `"version": "0.1.0"`. Keep `"type": "visualization"`,
   `"script": "screen.js"`, `"styles"`, `"routes"`, `"tour"` fields pointing
   at the copied files. Add a `settings` block pointing at our own
   `settings.html`.
4. Replace `settings.html`'s contents with a static placeholder: just the
   plugin name and version number, no controls, no other text (per the user's
   explicit direction — this plugin has no configurable settings for MVP).
5. In the copied `routes.py`, rename any `/api/plugins/highway_3d/...` route
   paths to `/api/plugins/five_string_everything/...` (the video-background
   upload/serve/delete endpoints) so they don't collide with the installed
   `highway_3d` plugin's own routes.
6. In `screen.js`, rename the registered global from
   `window.feedBackViz_highway_3d` to `window.feedBackViz_five_string_everything`
   (and its `.contextType`/`.panelControls`/`.__test` statics), and narrow
   `.matchesArrangement` from highway_3d's broad
   `/\b(?:lead|rhythm|bass|combo|guitar)\b/i` to `/bass/i` only — this is the
   MVP bass-only gate.
7. Confirm the plugin loads in a local feedBack checkout (appears in the
   plugin list / viz picker) with no backend errors, rendering identically to
   `highway_3d` (still reading real `bundle.stringCount`/notes at this point —
   no patch applied yet).

**Verify:** side-by-side comparison with `highway_3d` on a bass song shows
pixel-identical output (same file, different id/routes so far). Settings panel
shows our plugin's name + version and nothing else.

---

## Phase 2 — String/fret offset transformation engine

A **pure, general** function, with no per-tuning special cases, implemented as
a standalone module (loaded before `screen.js`'s patch point uses it):

```js
// Reference half-step positions of each standard string, index 0 = lowest
// string, per string count. These are fixed constants for comparing tunings
// against each other — not a pitch/frequency computation. Same numbers as
// lib/song.py's _TUNING_BASE_MIDI (kept in sync with that table; MVP treats
// every source as bass, so the guitar-borrows-6-string-base branch in
// lib/song.py's base_open_string_midis is not needed here).
const STANDARD_OPEN_STRING_HALFSTEPS = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

// Fixed target: 5-string bass, standard BEADG, no capo, no per-string offset.
const TARGET_OPEN_STRING_HALFSTEPS = [23, 28, 33, 38, 43]; // B0 E1 A1 D2 G2
const TARGET_MAX_FRET = 20;

function standardOpenStringHalfsteps(stringCount) {
    return STANDARD_OPEN_STRING_HALFSTEPS[stringCount] || STANDARD_OPEN_STRING_HALFSTEPS[6];
}

// Half-step offset of source string `s`'s open note from a fixed reference
// point, given the chart's own tuning/capo. This is source-string-count-aware
// (a 4-string chart's string 0 and a 5-string chart's string 0 are different
// physical strings) but otherwise just arithmetic on the numbers already on
// the chart (tuning[] + capo).
function sourceOpenStringOffset(sourceBase, tuningOffsets, capo, s) {
    if (!(s >= 0 && s < tuningOffsets.length) || !sourceBase) return null;
    const root = s < sourceBase.length ? sourceBase[s] : sourceBase[sourceBase.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0);
}

// Per-arrangement "natural" string shift: the single k (target string =
// source string + k) that best aligns the WHOLE source string family with
// the target — most exact (zero-adjustment) string matches wins; ties
// broken by smallest total |adjustment|, then smallest |k|. Compute once
// per song, not per note.
function computeArrangementShift(sourceStringCount, sourceBase, tuningOffsets, capo) {
    let bestK = 0, bestExact = -1, bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= TARGET_OPEN_STRING_HALFSTEPS.length - 1; k++) {
        let exact = 0, totalAbs = 0, counted = 0;
        for (let s = 0; s < sourceStringCount; s++) {
            const j = s + k;
            if (j < 0 || j >= TARGET_OPEN_STRING_HALFSTEPS.length) continue;
            const off = sourceOpenStringOffset(sourceBase, tuningOffsets, capo, s);
            if (off === null) continue;
            const adjustment = off - TARGET_OPEN_STRING_HALFSTEPS[j];
            counted++;
            totalAbs += Math.abs(adjustment);
            if (adjustment === 0) exact++;
        }
        if (counted === 0) continue;
        if (exact > bestExact
            || (exact === bestExact && totalAbs < bestTotalAbs)
            || (exact === bestExact && totalAbs === bestTotalAbs && Math.abs(k) < Math.abs(bestK))) {
            bestExact = exact; bestTotalAbs = totalAbs; bestK = k;
        }
    }
    return bestK;
}

// For one note (source string's open offset + source fret `f`), returns
// { s: targetString, f: targetFret } on the fixed BEADG target, or null if
// unplayable on every reachable target string. Starts from the
// arrangement's NATURAL target string for this source string
// (naturalTargetString = s + shiftK) and steps in whichever direction the
// out-of-range fret demands: fret < 0 -> lower string (a lower target open
// note needs a larger fret for the same pitch), fret > 20 -> higher string.
// Fret moves monotonically away from the violated bound as the string steps
// in that direction (target open-string half-steps are strictly
// increasing), so this always converges or exhausts the target's strings.
//
// This — NOT a global "smallest |adjustment| across all 5 strings" search —
// is the correct algorithm. An earlier version of this engine used the
// global-search form and it shipped a real bug: it happened to reproduce
// the Drop D example correctly (a 2-half-step drop) but broke on Drop C#
// (a 3-half-step drop), where it started preferring the extra B string as
// the DEFAULT for nearly the whole dropped string, rather than only for the
// frets that actually fall below what the string's natural (undropped)
// target could reach. The failure mode: comparing |adjustment| to ALL 5
// target strings flips its preference as soon as a single string's drop
// exceeds half the 5-half-step spacing between adjacent target strings —
// an artifact of the global comparison, unrelated to whether the note is
// actually reachable on its natural string. Anchoring on the natural
// (majority-fit) string first and only stepping away when the fret is
// truly out of range on it avoids that failure mode entirely, and still
// reproduces every identity case below (the natural string for EADG/BEAD/
// already-BEADG never needs to step away, by construction).
function remapStringFret(sourceOpenOffset, naturalTargetString, f) {
    let j = Math.max(0, Math.min(TARGET_OPEN_STRING_HALFSTEPS.length - 1, naturalTargetString));
    while (j >= 0 && j < TARGET_OPEN_STRING_HALFSTEPS.length) {
        const adjustment = sourceOpenOffset - TARGET_OPEN_STRING_HALFSTEPS[j];
        const targetFret = f + adjustment;
        if (targetFret < 0) { j -= 1; continue; }
        if (targetFret > TARGET_MAX_FRET) { j += 1; continue; }
        return { s: j, f: targetFret };
    }
    return null;
}
```

Per song load, precompute `sourceOpenStringOffset` and the natural target
string (`s + shiftK`, using one arrangement-wide `computeArrangementShift`
call) once per distinct source string index — not per note, both are
constant for the whole song — then call `remapStringFret` per note using
those cached values and the note's own `f`.

**Fret-numbering convention — confirmed against `highway_3d`, load-bearing for
every calculation above.** Fret `0` means the open string; fret `1` is one
half-step above the open note; etc. Confirmed directly in the forked source:
`highway_3d/screen.js` treats `n.f === 0` as the open-string case throughout
(e.g. `screen.js:10951` comment "Open-string notes (`f === 0`) do not...",
and the open-note lane-width branches at `:11103-11158`), and the backend's
`note_to_wire`/`Note.slide_to` (`lib/song.py:20,236`) store frets as plain
integers with no off-by-one offset. So on a string open-tuned to B: fret 0 =
B, fret 1 = C, fret 2 = C#, fret 3 = D, fret 4 = D#/Eb — this is what makes
the original worked example (Eb at fret 1 of a Drop-D low string → Eb at
**fret 4** of the target B string) and the string-count/base tables in
`STANDARD_OPEN_STRING_HALFSTEPS`/`TARGET_OPEN_STRING_HALFSTEPS` line up
consistently everywhere they're used (Phase 2 engine, Phase 4's patch, and
any place frets get displayed/compared). Any implementation that introduces
a fret offset-by-one anywhere would silently desync from this.

**Required test cases** (run as a small standalone console/Node script before
wiring into rendering — no test framework needed for MVP):
1. **Drop-D worked example, full chart** (not just the one note from the
   original request — every string's behavior must be checked, since a
   partial check would miss regressions on the other three strings): 4-string
   bass, `tuning = [-2, 0, 0, 0]`, `capo = 0` (string 0 dropped from E to D;
   strings 1–3 — A, D, G — untouched):
   - Source string 1 (A, untouched) → **unchanged** for every fret 0–20:
     `{s: 0, f} → {s: 2, f}` (lands on the target A string, same fret).
   - Source string 2 (D, untouched) → **unchanged** for every fret 0–20:
     `{s: 2, f} → {s: 3, f}` (target D string, same fret).
   - Source string 3 (G, untouched) → **unchanged** for every fret 0–20:
     `{s: 3, f} → {s: 4, f}` (target G string, same fret).
   - Source string 0 (the dropped string) is where behavior actually
     changes, because it now covers two different pitch ranges that the
     target's B and E strings split between them:
     - `{s: 0, f: 0}` (D, open) → `{s: 0, f: 3}` (target B string, fret 3 —
       matches the fret-numbering convention above: B,C,C#,D = frets 0,1,2,3).
     - `{s: 0, f: 1}` (Eb) → `{s: 0, f: 4}` (target B string, fret 4 — the
       original worked example).
     - `{s: 0, f: 2}` (E) → `{s: 1, f: 0}` (target E string, open) — this is
       the crossover point: from fret 2 upward the dropped string is just
       playing standard E-and-above notes, which the algorithm now correctly
       routes to the target's own E string instead of stacking them onto B.
     - `{s: 0, f}` for every `f >= 2` → `{s: 1, f: f - 2}` (target E string,
       fret shifted down by 2 — the exact size of the drop).
   - This confirms, with a full chart rather than one note, the plugin's own
     stated example from the original request: "some note gems will switch
     strings" (the dropped string's notes split across two *different*
     target strings depending on fret) while notes on untouched strings don't
     move at all — and none of this required detecting "this is Drop D" as a
     special case; it's the general algorithm's natural output.
2. **Real Drop C#** (feedback found and then precisely confirmed against an
   actual chart in manual testing): open strings low-to-high are C#, G#, C#,
   F# — `tuning = [-3, -1, -1, -1]`, `capo = 0`. Unlike Drop D, this is
   **not** "only the lowest string modified" — the whole tuning sits a
   half-step below standard, plus the lowest string drops an *additional*
   whole step. `computeArrangementShift` still picks `k = +1` (same shift
   as EADG — 4 of 4 strings are closer to that alignment than to `k = 0`),
   but now *every* string's own natural target carries a nonzero adjustment
   (+2 for string 0, +4 for strings 1–3), so every string needs its own
   one-fret cascade at the very bottom of its range before settling onto its
   natural target for everything else:
   - String 0 (C#, natural target E, adjustment +2): frets 0,1,2 (C#,D,Eb)
     cascade down to B (frets 2,3,4); fret 3 upward (E and above) stays on
     the natural E target (`{s: 1, f: f - 3}`).
   - String 1 (G#, natural target A, adjustment +4): fret 0 (G#) cascades
     down to E (fret 4); fret 1 upward (A and above) stays on the natural A
     target (`{s: 2, f: f - 1}`).
   - String 2 (C#, natural target D, adjustment +4): fret 0 (C#) cascades
     down to A (fret 4); fret 1 upward (D and above) stays on the natural D
     target (`{s: 3, f: f - 1}`).
   - String 3 (F#, natural target G, adjustment +4): fret 0 (F#) cascades
     down to D (fret 4); fret 1 upward (G and above) stays on the natural G
     target (`{s: 4, f: f - 1}`).
   This is the same general algorithm as Drop D — nothing here is a special
   case for this tuning — it's just that a uniform whole-tuning offset makes
   every string (not only the lowest) need its own cascade, whereas Drop D's
   uniform-zero offset on strings 1–3 meant only the lowest string needed
   one. An earlier draft of this test used an unrealistic `tuning = [-3, 0,
   0, 0]` (only the lowest string modified) and, separately, an earlier
   *algorithm* draft briefly (never shipped) mis-selected `k = 0` for this
   case by over-weighting "how many strings need zero cascade" — both were
   wrong turns corrected once the actual chart's tuning was pinned down.
3. **EADG identity**: 4-string bass, `tuning = [0, 0, 0, 0]`, `capo = 0`. For
   every fret 0–20 on every source string 0–3, the remapped result must be
   `{s: sourceString + 1, f: sourceFret}` — i.e. every note lands on the
   *same fret*, just shifted up one string index (since EADG's string family
   sits exactly on BEADG's top 4 strings). This must fall out of the general
   algorithm, not a special case for this tuning.
4. **BEAD identity**: 4-string bass, `tuning = [-5, -5, -5, -5]`, `capo = 0`
   (BEAD is EADG shifted down a full fourth). For every fret 0–20 on every
   source string 0–3, the remapped result must be `{s: sourceString, f:
   sourceFret}` — completely unchanged, same string, same fret. Also derived
   from the general algorithm, not detected/special-cased.
5. **Already-BEADG identity**: 5-string bass, `tuning = [0,0,0,0,0]`, `capo =
   0` → every note unchanged.
6. **Out-of-range drop**: a pitch one half-step below open B on every target
   string, and a pitch one half-step above fret 20 on the G string, both
   return `null`.

**Verify:** all cases above pass via direct function calls (console or a
throwaway Node script) before touching any rendering code.

### Slide notes (`sl`/`slu`)

A note can carry `slide_to`/`slide_unpitch_to` (wire fields `sl`/`slu`,
`lib/song.py:20-21,236`) — a second fret number on the *same string*, meaning
the gem slides continuously from the note's own fret to that fret rather than
being a discrete second note. Naively remapping `s`/`f` per Phase 2's function
and leaving `sl`/`slu` untouched would desync the slide's destination fret
from whatever string the start note actually landed on. Both endpoints must
resolve to the **same** target string, which isn't guaranteed if each fret is
resolved independently starting from the natural target string (a fret near
the natural string's own range boundary can step away while the other
endpoint doesn't).

Algorithm, applied per sliding note in addition to Phase 2's base function:
1. Take `lowFret = min(f, slideToFret)`, `highFret = max(f, slideToFret)`.
2. Resolve the target string using **`lowFret`** only (Phase 2's
   `remapStringFret`, starting from this source string's natural target) —
   the lower fret is the one most likely to land in-range, so anchoring on
   it is the stable choice. If `lowFret` is unplayable on every reachable
   string, retry anchored on `highFret` instead; if neither fret resolves,
   drop the note (same as an ordinary unplayable note).
3. Apply that one target string's adjustment to **both** `f` and
   `slideToFret` (or `slideUnpitchToFret`).
4. Per the user's explicit direction — unlike an ordinary out-of-range note,
   **do not drop a slide for exceeding fret 20** — clamp the resulting fret
   to `20` instead. (The anchor fret, chosen in step 2, is already guaranteed
   `>= 0` by construction, so in practice only the non-anchor endpoint ever
   needs clamping, and only on the high side.) This covers both directions
   described: a low-to-high slide whose far end would overflow past fret 20
   gets its end fret capped at 20; a high-to-low slide is anchored on its
   (lower) destination fret so the whole slide sits on that fret's correct
   target string, with the (higher) start fret capped at 20 if needed.
5. `slu` (unpitched slide-to) has no real destination pitch to preserve, but
   still needs a fret number on the resolved target string for display — feed
   it through the same string's adjustment + clamp as `sl`, since there's no
   more principled alternative for MVP.

**Verify:** a synthetic low-to-high slide (`f: 15, sl: 22` on a source string
whose adjustment is `+3`) confirms the far end clamps to `20` rather than
being dropped; a synthetic high-to-low slide confirms both ends land on the
target string chosen by the (lower) destination fret.

---

## Phase 3 — Chord note collision resolution

Extend Phase 2's engine to a chord's simultaneous notes:

1. Remap each note in the chord independently via Phase 2's function
   (dropping any note that returns `null`).
2. Group survivors by assigned target string `s`.
3. For any target string with more than one note assigned, keep only the
   lower-pitched original note (compare via `sourceOpenStringOffset(s) + f`
   for each candidate — this ordering is the same half-step arithmetic
   already computed, no new pitch concept introduced) and drop the rest.
   Strings with a single assigned note are unaffected.
4. A chord that ends up with zero surviving notes is simply omitted.

Note: `chordTemplates[chord.id]` (finger-diagram metadata) will not be
regenerated to match — per the scope guardrails, document this as a known
cosmetic gap for chord ghosting/hand-shape overlays specifically (the actual
note gems remain correct).

**Correction (feedback found this in manual testing): this collision
resolution must ALSO apply to `bundle.notes`, not just `bundle.chords`' own
`.notes` array.** `arr.notes` and `arr.chords` are separate lists in
`lib/song.py` — nothing requires two genuinely-simultaneous notes (a bass
"double stop" in particular is often encoded this way rather than wrapped in
a `Chord` object) to appear as one `Chord`. The original Phase 4/5
implementation remapped `bundle.notes` one note at a time with no awareness
of other notes sharing the same onset, so two independently-remapped flat
notes could still land on the same target string — the exact "same chord,
same string, different frets" symptom this phase exists to prevent, just via
a path that bypassed it. Fixed by grouping `bundle.notes` by exact onset
time before remapping and running every group — including ordinary
singleton groups, which pass through unchanged — through the same
collision-resolution function used for real `Chord` objects, rather than
maintaining two separate code paths for what is structurally the same
problem (one or more notes sharing an instant, needing distinct target
strings).

**Verify:** a synthetic chord (3+ notes at the same `t`, chosen so two of them
collide onto the same target string after remap) shows only the lower-pitched
of the colliding pair surviving; the third, non-colliding note is untouched.
Separately, the same scenario constructed as plain `bundle.notes` entries
(no `Chord` wrapper) must resolve identically — verified as its own test
case, not just inferred from the chord case.

---

## Phase 4 — Patch the forked screen.js (surgical, auditable diff)

The guiding rule: **preserve `highway_3d`'s copied code verbatim wherever
possible**; every behavioral difference should trace to one of these specific
patch points (identified from the earlier research pass over
`plugins/highway_3d/screen.js`):

1. **Note/chord substitution shim**, at the point where `update(bundle)`
   reads `bundle.notes`/`bundle.chords` into local variables (originally
   `screen.js:10281-10300`). Instead of using the raw arrays directly, build
   (and cache — see Phase 5) shallow-copied note/chord objects with `s`/`f`
   overwritten to their Phase 2/3 remapped values, and — for any note
   carrying `sl`/`slu` — those fields overwritten per Phase 2's slide
   sub-algorithm (both must land on the same target string as the note's own
   `s`/`f`, never left pointing at a stale same-source-string fret). Every
   other field (`t`, `sus`, all other technique flags) spreads through
   unchanged. Feed *these* copies into the rest of the untouched file. This
   means every
   downstream consumer in the 15,000+ line file — gem drawing, sustains, combo
   effects, minimap, everything — automatically uses the remapped position
   without hunting down individual `n.s`/`n.f` usage sites.
2. **String count**, at `resolveStringCount()` (originally
   `screen.js:782-788`). Replace its body to unconditionally return `5` —
   we own this copy outright, so there's no closure-variable obstacle here
   (that obstacle only applied to influencing the *installed*, separate
   `highway_3d` plugin or core's shared `highway.js`).
3. **Open-string tuning labels**, at `_baseOpenStringMidis`/
   `_openStringPitchLabelsForTuning`/`_syncOpenStringPitchLabels` (originally
   `screen.js:790-850`, `:5426+`) — hardcode the label set to
   `['B', 'E', 'A', 'D', 'G']` rather than deriving it from the chart's
   (original, not our target) tuning, since the fretboard now always
   represents the fixed BEADG target.
4. **Per-string color palette** (feedback found this in manual testing, in
   two rounds — see both corrections below): `highway_3d` colors gems by raw
   string index (`activePalette[s]`, `S_COL`/`PALETTES.default` — index 0 =
   red, 1 = yellow, 2 = blue, 3 = orange, 4 = green, ...), with no
   instrument-aware adjustment. Under our target's B/E/A/D/G indexing
   (0..4), that reuses red — the color players associate with E on any
   4-string chart — for B instead, and shifts every other string's color up
   a slot. The result reads as "a new high string added on top" rather than
   "a new low string added below," exactly backwards from the intent.
   **First correction, superseded by the second:** an initial fix reused
   slot 4 (green) for B, reasoning that it's "the color a 6-string guitar's
   own B string gets." That's the wrong "B" — a guitar's 2nd string (between
   G and high E) is an unrelated string sharing the name by coincidence.
   **Second, correct fix:** core already has a dedicated, name-based color
   system for exactly this situation — an *added low extension string*, the
   same role a 7-string guitar's lowest string plays below standard low E.
   `static/app.js`'s `HWC_SLOTS`/`HWC_DEFAULT_FALLBACK` names that slot
   `low7` ("Low B, 7-string"), default `#cc00aa` — that's B's correct color,
   not the guitar-B-string green. Two parts:
   - E/A/D/G (target indices 1-4) need no reorder table at all: they pass
     through `newPalette[0..3]` **unchanged** — core's own 4-string-bass
     slot order (`lowE, A, D, G`) already lines up 1:1 with those indices.
   - B (target index 0) is looked up independently via a small helper
     (`_fseLowBColor()`) that reads the user's own "Low B" customization
     directly from the same storage core's Highway String Colors settings
     panel writes (`localStorage['highwayStringColors'].low7`), falling back
     to `0xcc00aa` (`HWC_DEFAULT_FALLBACK.low7`) otherwise. This has to be a
     direct, independent lookup rather than routed through core's normal
     per-chart translation (`_hwcSlotKeysForChart` in `app.js`) because that
     translation keys off `highway.getStringCount()` — the chart's *true*
     string count — so it never assigns a color to a string our renderer
     synthesizes that core doesn't know exists. Known limitation: a user's
     "Low B" customization intended for real 7-string guitar charts will
     also apply to our synthesized B string, and there's no way to give
     them independent values without deeper core plumbing than an MVP
     patch — acceptable since both represent the same "extra added low
     string" role.
   Apply both at the three points where a palette array is actually
   consumed by string index, not by chasing the ~20 individual
   `activePalette[s]` reads scattered through the file:
   - Where `activePalette` is assigned from the user's palette selection
     (named or custom) — build it as `[_fseLowBColor(), newPalette[0],
     newPalette[1], newPalette[2], newPalette[3]]` instead of assigning
     `newPalette` directly.
   - `activePalette`'s initial value (before any settings load) — same
     construction applied to `PALETTES.default`, so the very first frame
     isn't briefly wrong.
   - `_recolorGemGradients()`'s stock-vs-custom gradient lookup: index 0 (B)
     always takes the derived-from-base lighten/darken path (there's no
     stock "Low B" entry in `DEFAULT_GEM_GRADIENTS` — that array only
     covers the original 6-string palette), while indices 1-4 read
     `DEFAULT_GEM_GRADIENTS[s - 1]`/`PALETTES.default[s - 1]` directly (one
     slot down, since index 0 is B-only now). The "is this actually a
     custom palette" check (previously `activePalette === _customPalette`)
     must compare against the *pre-remap* source palette reference instead,
     since `activePalette` is now always a freshly-derived array that's
     never `===` anything it was built from.
5. **Anchors** (feedback found this in manual testing — "highlighted lanes,
   usually 4 frets... indicate hand position... inaccurate now with this
   plugin enabled"): RS2014 `<anchor>` markers (`lib/song.py`'s `Anchor`
   dataclass — `{time, fret, width}`, no string field) drive the fretboard's
   hand-position highlight band, consumed in exactly one place
   (`const anchors = bundle.anchors;`) and fanned out from there into
   `getChartAnchorAt`/`laneBoundsFromAnchor`/`anchorPlayedFretInclusiveSpan`/
   `fretColumnMarkersForAnchor`/etc. — the same "one substitution point"
   shape as the note/chord shim, so reassigning `bundle.anchors` once fixes
   every downstream reader without touching ~20 call sites individually. The
   only real design question is *which* adjustment to apply to a bare fret
   number that has no string of its own — different strings can carry
   different adjustments (Drop C# gives all four a different one), so
   there's no single "the" shift for the arrangement. Resolved by
   `FSE.remapAnchors`: `getChartAnchorAt` treats an anchor's fret/width as
   governing the passage of notes *from its own time onward until the next
   anchor* (i.e. it's authored to describe hand position for whatever notes
   come next), so each anchor borrows the adjustment of the first
   already-remapped note at or after its own time (falling back to the
   nearest note before it, or passing the anchor through unchanged if the
   chart has no surviving notes at all). One shared forward-scanning pointer
   over both time-sorted arrays, computed once per song alongside notes/
   chords, not per frame.
   - Checked whether anything else in the file reads fret data independent
     of `bundle.notes`/`.chords`/`.anchors` and needs the same treatment:
     `n.sd` (the scale-degree teaching-mark label, `screen.js` around
     `_drawTeachMark`) is pitch-based, not tuning-position-based — it's
     computed server-side from the note's actual sounding pitch
     (`lib/song.py`'s `note_pitch_midi`), which our remap always preserves
     exactly, so it stays correct unmodified. `chordTemplates[chord.id]`
     was flagged here as a known, accepted exception (Phase 3) — **since
     superseded by patch point 6 below**, which fixes it properly rather
     than leaving it as a documented gap.
6. **Chord templates** (feedback found this in manual testing — "chords can
   have multiple notes on the same string... same chord same string
   different frets" — traced with a real chart the user supplied for
   testing, Black Veil Brides "In the End"). Two compounding findings:
   - That chart has **zero real `Chord` objects** — every bass note is a
     flat `Note`. The visible "chord indicator" is entirely synthesized by
     `mergeHandShapeSynthChords`/`chordNotesFromTemplate` from a hand-shape
     span + a `chordTemplates` entry (`frets: [6, 7, -1, -1, -1, -1]`,
     `si` = original string index used directly as `{s: si, f}`) — a path
     that reads `chordTemplates` directly and had never gone through our
     remap at all. Confirmed by extracting the chart's own `bass.json`:
     `num chords: 0`, one template `[6, 7, -1, -1, -1, -1]`, and real notes
     `(s:0,f:6)`/`(s:1,f:7)` at the same moment the hand-shape covers — under
     Drop C# (`tuning=[-3,-1,-1,-1]`), the REAL note `(s:0,f:6)` correctly
     remaps to `{s:1(E),f:3}` (Phase 2's test 1b), while the un-remapped
     synth chord showed target string 1 (`si=1`, misread as our E slot) at
     the *original* fret 7 — two gems, same target string, different frets,
     exactly the reported symptom.
   - Fix: `chordTemplates[id].frets`/`.fingers` are indexed by *original*
     string, structurally identical in shape to a chord's own `.notes`
     array (one fret per string, `-1` = unused) — so reuse
     `resolveChordCollisions` verbatim: build a `{s, f}` list from the
     non–`-1` frets, resolve collisions, scatter survivors into fresh
     `TARGET_STRING_COUNT`-length `frets`/`fingers` arrays indexed by
     *target* string (`chord_id` indexing into the `chordTemplates` array
     itself is untouched — only each entry's own per-string content
     changes). Fingers relocate to their note's new index unchanged in
     value; there's no principled way to recompute "correct" fingering
     when the remap can turn two adjacent frets on adjacent strings into a
     wide stretch across different strings entirely, so this is a
     best-effort carry-forward, not a claim of ergonomic accuracy.
   - `bundle.chordTemplates` is read directly (no single local alias) from
     ~15 call sites — reassigning it once in `_fseApplyRetune`, the same
     pattern as notes/chords/anchors, fixes every one of them, including
     `chordNotesFromTemplate` (the actual bug) and, as a direct consequence,
     the chord-ghost/finger-diagram rendering this section previously
     flagged as an accepted gap — no longer a known limitation.
7. Everything else in the copied file — themes, video backgrounds, camera,
   lighting, particle effects, splitscreen support, hand-shape ghosting,
   lyrics, minimap, event listeners (`highway:visibility`,
   `highway:canvas-replaced`, `notedetect:hit`/`notedetect:skin`) — stays
   byte-for-byte as copied from `highway_3d`.

**Verify:** `diff` our patched `screen.js` against the untouched
`highway_3d/screen.js` copy from Phase 1 and confirm every hunk maps to one
of the six patch points above (plus the Phase 1 identity/route renames) —
nothing else should differ.

---

## Phase 5 — Caching and note-state passthrough

- Detect a chart change via reference identity on `bundle.notes`/
  `bundle.chords` (array fields swap reference when chart data changes, per
  the bundle's documented invariant) or a change in `bundle.songInfo.tuning`/
  `.capo`/`bundle.stringCount`. On change, rebuild the remapped-copy arrays
  (Phase 2 + 3) once; don't recompute the offset math every frame.
- When calling `bundle.getNoteState(note, chartTime)` (the hit/miss/active
  lighting contract, already present in the copied `highway_3d` code), pass
  the **original**, un-remapped note object and time — that's the key the
  external scorer plugin uses — even though the gem is drawn at the remapped
  position. This should already fall out naturally if the substitution shim
  (Phase 4, point 1) keeps a reference from each remapped copy back to its
  original note object.

**Verify:** play the Drop-D worked example end to end — the Eb note at fret 1
of the dropped (low) string visually renders as fret 4 on lane 0 (B string,
per the fret-numbering convention in Phase 2 — fret 0 = open, so B,C,C#,D,Eb
= frets 0,1,2,3,4) at the right time, and if a provider is registered,
hit/miss lighting still applies correctly to that
gem.

---

## Phase 6 — Auto-mode integration, lifecycle, diff audit

- Confirm `matchesArrangement` (Phase 1, narrowed to `/bass/i`) correctly wins
  the Auto-mode "first match wins" tiebreak against the installed
  `highway_3d`'s broader bass-matching regex. **Correction from manual
  testing:** this plan originally (and incorrectly) assumed the tiebreak
  follows the `id` field declared in `plugin.json`. The actual mechanism
  (`static/app.js` `_autoMatchViz`, confirmed by reading the source directly)
  evaluates candidates in viz-picker DOM order, which mirrors `/api/plugins`'
  order, which is `sorted(plugins_base_dir.iterdir())` in
  `plugins/__init__.py` — i.e. **sorted by the on-disk plugin *directory*
  name**, not by `plugin.json`'s `id`. `highway_3d` is bundled with core at
  `plugins/highway_3d/`, so whether we win the tiebreak depends entirely on
  what directory name this plugin gets installed under locally — it must
  sort alphabetically before `"highway_3d"` (e.g. `five_string_everything`
  or `feedBack-plugin-five-string-everything`, both of which start with a
  character before `h` — but a differently-named install directory could
  easily lose the tiebreak). This is a deployment-time consideration, not
  something the plugin's own code can guarantee — confirm the actual
  installed directory name sorts correctly, and document that requirement
  wherever install instructions live. **Follow-up:** the user installs via
  feedback-desktop's plugin manager
  (`feedBack-desktop/src/main/plugin-manager.ts`), which — confirmed by
  reading that source — installs under the git URL's last path segment
  verbatim (`feedBack-plugin-five-string-everything` for this repo), with
  no sanitization/reordering and no explicit override given. That name
  already sorts before `highway_3d` (`f` < `h`), so directory naming likely
  *isn't* the actual cause of the reported "Auto mode didn't take over"
  behavior. The much more likely explanation: `_autoMatchViz` only runs when
  the viz picker is on `'auto'` — a *manual* pick from an earlier session
  persists to `localStorage.vizSelection` and is restored on load,
  permanently bypassing Auto-mode evaluation regardless of directory naming
  or `matchesArrangement` correctness until the picker is explicitly set
  back to "Auto (match arrangement)". Check the picker's actual value
  before assuming a tiebreak problem.
- Confirm manual picker selection still works, and that switching away from
  our renderer via the picker is the "disable" mechanism, per the locked-in
  decision (no settings toggle).
- Confirm the `init()`→`destroy()`→`init()` cycle (song-to-song navigation)
  works without leaking Three.js resources or double-registering event
  listeners — this is inherited from `highway_3d`'s own idempotent-`destroy()`
  pattern, so it should just work, but verify directly since our
  patch touches the code path that reads notes/chords each cycle.
- Re-run the Phase 4 diff-audit check after any later changes to keep the
  patch minimal and auditable over time.

**Verify:** manual playthrough of at least one real Drop-D (or similarly
non-standard-tuning) bass chart from load to a hit note, confirming Auto-mode
pickup, correct gem positions and full visual parity with `highway_3d`
throughout the song, and clean teardown when navigating back to the library
and picking a different song.

---

## Phase 7 — Restore highway_3d's full settings UI

Phase 1 shipped a placeholder `settings.html` (plugin name + version, no
controls) to keep MVP scope small. Before release, restore the real thing —
`highway_3d`'s settings.html is ~1800 lines covering Fretboard, Background +
Butterchurn, Camera + Nut/Headstock, Notes, Sections, Tone Changes, and Chord
Diagram. Since we forked `screen.js` wholesale, all the supporting JS for
every one of these controls is already present in our copy — this phase is
about the settings.html markup and, critically, an isolation problem the
audit turned up before any markup was copied.

**Found during audit, before writing any settings.html content: two
architectural collision risks, both confirmed (not hypothetical) by reading
how core actually loads plugins.**

1. **Global function names collide.** `highway_3d`'s `screen.js` exposes
   ~60 functions as bare `window.h3dSetXxx`/`window.h3dBgSetXxx` globals
   (fret spacing, background style, camera, nut/headstock, notes, sections,
   tone HUD, chord diagram, an internal aspect-tuning debug bridge — every
   settings.html control other than Highway String Colors calls one of
   these). Confirmed via `static/app.js`: **every installed plugin's
   `screen.js` loads unconditionally on the same page**, regardless of
   which renderer is "active" — plugin scripts aren't scoped per-selection.
   Since our fork defines the exact same global names, whichever plugin's
   `<script>` executes *last* silently overwrites the other's function
   definitions — a settings control could end up driving `highway_3d`'s
   internal state instead of ours, or vice versa, depending on load order
   neither plugin's code controls.
2. **Storage keys collide too, more deeply.** Nearly everything above
   (background, camera, nut/headstock, notes, sections, tone HUD, chord
   diagram) persists through a **hardcoded literal prefix**,
   `'h3d_bg_' + key`, not scoped to the plugin id at all — confirmed by
   reading `_bgReadSetting`/`_bgWriteGlobal`. Same story for the Butterchurn
   preset browser (`'viz3d_settings'`/`'viz3d_favorites'`/`'viz3d_banned'`/
   `'viz3d_seeded'`) and two internal debug-only keys
   (`'h3d_full_sus'`, `'h3d_aspect_tune2'`). Both plugins installed
   together would silently **share** this state — a background/camera/etc.
   change made via one plugin's settings panel would also change the
   other's, and vice versa.
3. **A third, narrower collision: `Highway String Colors` can't be
   duplicated at all, even with renaming.** Confirmed by reading
   `static/app.js`'s `hwcRenderPickers`/`hwcInitSettingsUI`: this section's
   rendering code queries **un-scoped global DOM ids** (`#hwc-pickers`,
   `#hwc-color-<slot>`, ...), and — confirmed by reading how plugin
   settings snippets are actually injected — every installed plugin's
   settings.html is fetched and its `<script>` tags individually
   re-executed into **one shared Settings-page DOM**, all simultaneously
   present (a `<details>` accordion per plugin, not lazy-loaded). If both
   plugins' settings.html contained this section, only whichever loads last
   would have working color pickers — `getElementById` finds the first
   match in document order, unconditionally.

**Decisions, confirmed with the user:**
- Fully isolate our copy's settings state: rename every `window.h3dXxx` /
  `window.h3dBgXxx` global to `window.fse3dXxx` / `window.fse3dBgXxx`
  throughout `screen.js` (defines **and** call sites — including a few
  internal calls that used the bare, non-`window.`-prefixed name, which a
  naive `window.h3d` → `window.fse3d` text replace would silently miss and
  leave pointing at whichever plugin's script defines the old name).
  Rename the storage prefix `h3d_bg_` → `fse_bg_`, and the Butterchurn/
  debug keys → `fse_viz3d_settings`/`fse_viz3d_favorites`/
  `fse_viz3d_banned`/`fse_viz3d_seeded`/`fse3d_full_sus`/
  `fse3d_aspect_tune2`. The internal aspect-tuning debug bridge
  (`window.__h3dAspectTune`/`__h3dAspectPanes`/`__h3dAspectReadout`/
  `__h3dAspectPanelOpen` — a double-underscore-prefixed global, a *different*
  naming pattern the first rename pass missed) gets the same treatment.
- **One deliberate exception: `window.__h3dCamCtl`/`__h3dCamCtlPanels` stay
  unrenamed.** These aren't internal settings state at all — they're a
  documented public integration point for a real third-party tool, "Camera
  Director" (`github.com/nimuart/cameradirector_feedback`), confirmed via
  `highway_3d`'s own `FREECAM_BRIDGE.md` (copied into this repo for the same
  reason). That tool *writes* `window.__h3dCamCtl`; any compatible 3D
  highway renderer *reads* it once per frame to let the tool drive the
  camera. Renaming this one would silently break Camera Director
  compatibility for our renderer specifically — the opposite of what
  isolation is for. If both plugins are ever simultaneously active
  (splitscreen) with Camera Director installed, both renderers correctly
  respond to it — that's the intended behavior for a camera-control tool
  that doesn't know or care which specific renderer is active.
- Don't duplicate the `Highway String Colors` section in our settings.html
  at all. It's genuinely global, shared, core-owned data
  (`window.feedBack.highwayColors`) — our plugin's whole premise already
  depends on `highway_3d` staying installed alongside it, both renderers
  already correctly read from that one shared source (`_fseLowBColor()`,
  Phase 4 patch point 4), and `highway_3d`'s own settings panel remains the
  one place to edit it.

**Construction, once the isolation rename above was done:** copy
`highway_3d/settings.html` verbatim minus its `Highway String Colors`
section (its first ~78 lines), then apply the same renames throughout the
copied markup — `window.h3dXxx` → `window.fse3dXxx`, every `id="h3d-...")`/
`for="h3d-..."`/`aria-labelledby="h3d-..."`/`getElementById('h3d-...')` →
the `fse3d-` prefix (DOM ids need this too, for the identical "both
settings.html snippets share one page" reason as the String Colors
finding — a control with a colliding id would end up wired to whichever
plugin's element happens to be first in the DOM), `h3d_bg_` → `fse_bg_`,
`viz3d_settings` → `fse_viz3d_settings`, `highway_3d.fretSpacing` →
`five_string_everything.fretSpacing` (already the key our fork uses, per
Phase 1), and the hardcoded video-upload URL `/api/plugins/highway_3d/
files` → `/api/plugins/five_string_everything/files` (matching the routes
Phase 1 already renamed on the backend). Prepended our existing plugin
name/version header from the Phase 1 placeholder.

**Reviewed every remaining section against our tuning-remap patches
specifically** (not just the mechanical rename) for anything that reads
chart tuning/string/fret data directly rather than through a setting we
already know is compatible: found one — the Nut & Headstock section's
description text said tuning labels are shown "from the chart tuning",
which is stale for us now (Phase 4 patch point 3 hardcodes them to the
fixed BEADG target, `B/E/A/D/G`, always — never the original chart's) —
corrected the copy. No other section reads tuning/string/fret data directly
(confirmed by grepping the copied settings.html for `stringCount`/`tuning`/
`capo`/`arrangement` — the only hit was the tuning-label *visibility toggle*
itself, a boolean flag, not a data dependency). Everything else (fret
spacing, background/Butterchurn, camera, note display toggles including the
slide-direction arrows — which correctly read our already-remapped `sl`/
`slu` values, Phase 2 — section/tone HUDs, chord diagram sizing/position,
and the fret-column marker cadence which reads our already-remapped
`bundle.anchors`, Phase 4 patch point 5) is either purely cosmetic or
already covered by an existing, verified patch point.

**Verify:** `diff` against `highway_3d/screen.js` and confirm every hunk
traces to a rename covered above (61 hunks, up from 23 before this phase —
expected, given ~60 scattered function renames plus ~20 storage-key sites
across a 15,000-line file). Load the Settings page with both `highway_3d`
and this plugin installed; confirm each section's controls affect only the
renderer whose settings panel they're in (change a value in one plugin's
panel, confirm the other plugin's copy of the same control is unaffected).
Confirm Highway String Colors still works normally from `highway_3d`'s own
panel and visibly affects both renderers (shared by design). If Camera
Director is available to test with, confirm it can still drive this
renderer's camera.

---

## Phase 8 — Sync with upstream highway_3d

Since our own tuning-remap logic lives entirely in the small set of
documented patch points, and everything else in `screen.js` is
`highway_3d`'s own code, this fork needs to periodically re-pull upstream
fixes/features rather than silently drifting from a snapshot taken at fork
time (feedback: explicitly requested a sync against
`github.com/got-feedBack/feedBack/tree/main/plugins/highway_3d`, the
canonical upstream, not the `jphinspace/feedBack` fork this plugin was
originally forked from — that fork was a commit behind canonical).

**Process** (repeatable for future syncs):
1. Shallow-clone the canonical upstream (`got-feedBack/feedBack`) into a
   scratch directory — never add a remote to or otherwise modify the
   existing local `feedBack` checkout this plugin was forked from.
2. Diff upstream's `plugins/highway_3d/` against whatever this plugin was
   last synced to (see the version note below) file-by-file. If only
   `screen.js`/`plugin.json` differ (as they did this time — every other
   file, including `settings.html`, was byte-identical), the sync is
   just a `screen.js` merge; a `settings.html` divergence would additionally
   need Phase 7's rename treatment re-applied to whatever's new.
3. For each upstream `screen.js` hunk, locate the equivalent, unrenamed
   surrounding text in our copy (search on a unique line from the hunk,
   not line numbers — our copy has diverged in line count from every prior
   phase's patches) and apply the same change. Confirm the hunk doesn't
   touch anything on our patch-point list (FSE block, `resolveStringCount`,
   tuning labels, the note/chord/anchor/template substitution shim, the
   color palette, note-state provider calls, or any renamed
   `window.h3d*`/`h3d_bg_*` identifier) before applying — if it does, that
   specific hunk needs manual reconciliation rather than a direct copy, and
   should be flagged to the user rather than silently merged.
4. Verify: `node --check screen.js`, `node test/retune-engine.test.mjs`,
   and confirm the newly-applied section is byte-identical to upstream's
   (extract the equivalent region from both files and `diff` them directly)
   as a sanity check that the manual reapplication was exact, not just
   "close enough."

**This sync (2026-07-10):** local reference `feedBack` checkout
(`jphinspace/feedBack`) was one commit behind canonical
(`highway_3d/plugin.json` `3.31.4` vs. `3.31.5`; last commit touching
`plugins/highway_3d/` was `14d116d8` locally vs. `b3215694` on canonical
upstream at sync time). Diffing canonical upstream against the local
reference showed exactly one substantive change, confined to the
Butterchurn background visualizer's canvas-sizing code (`ctrl.viz =
bc.createVisualizer(...)`'s initial sizing, and a new shared
`_bcApplySize(cssW, cssH)` helper replacing duplicated sizing logic in
`render()`/`resize()`) — a fix for the visualizer's drawing buffer staying
at Butterchurn's 300×150 default and only being stretched via CSS, which
showed as a stretched lower-left corner instead of a full-panel fill. Zero
overlap with any of our patch points (a wholly separate subsystem), so this
was a direct, unmodified merge — verified byte-identical to upstream's
version of that code region after applying. **Bumped this plugin's own
`version` to `0.1.1`** to reflect the change (independent of
`highway_3d`'s own version numbering — the two plugins version separately).

**Verify:** same as every other phase — `node --check screen.js`, the test
suite, and the diff-audit against `highway_3d/screen.js` (now diffing
against the canonical upstream copy, not the possibly-stale local
reference) confirming every hunk still traces to a documented patch point.

---

## Phase 9 — Extract the retune engine into its own module (2026-07-11)

Every phase above grew the FSE logic (Phase 2/3's pure engine, Phase 4's
note/chord/anchor/template substitution shim, the Low-B color helper)
directly inline in `screen.js`, alongside `highway_3d`'s own copied
rendering code. That kept `_fseApplyRetune`/`_fseLowBColor`/the `FSE` IIFE
auditable as *patch points* (Phase 4's explicit goal), but it also meant
`test/retune-engine.test.mjs` carried a hand-maintained duplicate of the
whole pure engine ("Keep this in sync with screen.js's FSE block if that
logic changes" — exactly the kind of drift risk CLAUDE.md's plugin
guidelines warn about) and the file-level diff against upstream
`highway_3d/screen.js` mixed new logic in with the mechanical Phase 7
renames.

**Change:** moved everything that is genuinely new logic (not a rename of
copied `highway_3d` code) into its own ES module, `src/fse-retune.js`:
- The full Phase 2/3 pure engine (previously the inline `const FSE = (function () {...})();` IIFE at the top of the file).
- `_fseApplyRetune` → `FSE.createRetuner()`, a factory returning `{ apply(bundle) }` that owns its own per-instance cache state internally (still called once per `createFactory()` instance, so splitscreen panels still don't cross-contaminate — same guarantee as before, just encapsulated in the module instead of loose closure vars in `screen.js`).
- `_fseLowBColor()` → `FSE.lowBColor()` (self-contained; duplicates the ~4-line hex-parsing helper rather than importing `screen.js`'s `_h3dHexToInt`, since that helper is unrelated `highway_3d` code used elsewhere and pulling it into the module would create a dependency in the wrong direction).
- `_TARGET_OPEN_STRING_LABELS` → `FSE.TARGET_OPEN_STRING_LABELS`.

`screen.js` now imports the module (`import { FSE } from './src/fse-retune.js';`, top of file, outside the IIFE — `import` must be top-level) and every existing `FSE.xxx` call site is unchanged; only the four PATCH POINTs above shrank to a handful of lines each. `resolveStringCount()` (Phase 4 #2) and the anchors/chord-template PATCH POINTs (Phase 4 #5/#6, `FSE.remapAnchors`/`FSE.remapChordTemplates`) were already thin call-throughs into `FSE` and needed no change.

**Loader mechanism:** this relies on a real host capability, not a hack —
feedBack core's plugin loader supports `plugin.json`'s `"scriptType":
"module"` (`static/app.js`'s loader injects `<script type="module">`
instead of a classic script when set) plus a dedicated
`/api/plugins/<id>/src/{path}` route that serves a plugin's `src/` subtree
(mirrors the existing `assets/` route; confirmed by reading
`plugins/__init__.py`'s `plugin_src` handler and `static/app.js`'s
"Module-migration (R0)" loader comment). `plugin.json` gained
`"scriptType": "module"`; the classic `(function () { 'use strict'; ...
})();` IIFE body of `screen.js` is otherwise unchanged (`import` works
identically whether the rest of the file is an IIFE or top-level code).

**Node/test wiring:** `src/fse-retune.js` is real ESM (`export const FSE =
{...}`, required for the browser's native module loader to parse it — a
UMD/dual-format wrapper would not satisfy `<script type="module">`).
Node's default module type is CommonJS with no root `package.json`, so
`src/package.json` and `test/package.json` (both just `{ "type": "module"
}`) scope only those two subtrees to ESM — the standard "nested
package.json" pattern for mixed CJS/ESM in one repo — so the repo root
(and critically `tailwind.config.js`, which still uses `module.exports =`
for `build-tailwind.sh`'s `npx tailwindcss` loader) is untouched.
`test/retune-engine.test.mjs` now does `import { FSE } from
'../src/fse-retune.js';` and destructures what it needs — no more
duplicated engine code, so the module and its test can never drift.

**What deliberately stayed in `screen.js`:** the Phase 7 settings-isolation
renames (`window.h3dXxx` → `window.fse3dXxx`, `window.h3dBgXxx` →
`window.fse3dBgXxx`, the `h3d_bg_`/`viz3d_*`/`h3d_full_sus`/
`h3d_aspect_tune2` storage-key renames, ~80 call sites across the file) are
*not* new logic — they're mechanical renames of `highway_3d`'s own copied
background/camera/nut-headstock/notes/sections/tone-HUD/chord-diagram code,
required only to avoid colliding with the real, separately-installed
`highway_3d` plugin (Phase 7's isolation problem). That code reads and
mutates dozens of Three.js scene objects, materials, and camera state that
live in `createFactory()`'s closure — extracting it into a module would
mean either passing that whole closure across a module boundary (no real
separation, just indirection) or duplicating large swaths of `highway_3d`'s
own rendering code into a second file, which would work directly against
Phase 8's sync goal (a smaller, more mechanical diff against upstream) by
splitting upstream's own code across two files instead of one. Those
renames remain the only source of "our changes" still living inline in
`screen.js`, and they're exactly the *mechanical, auditable* kind Phase 7
already scoped and documented — not hidden new behavior.

**Verify:** `node --check screen.js`, `node --check src/fse-retune.js`,
`node test/retune-engine.test.mjs` (482 assertions, unchanged pass/fail
behavior — same test cases, now run against the real module instead of a
duplicate), and the diff-audit against `highway_3d/screen.js` confirming
hunk count is unchanged (61) and every hunk still traces to a documented
patch point or a Phase 7 rename.

**Bumped this plugin's own `version` to `0.1.2`** (`plugin.json`, which
also gained `"scriptType": "module"`) to reflect the change.

---

## Phase 10 — Configurable target tuning (2026-07-11)

Lifts the MVP guardrail noted in Phase 1 ("Fixed 5-string BEADG target
tuning — no tuning picker"): the target string COUNT stays fixed at 5 (the
whole point of the plugin), but which pitches those 5 strings are tuned to
is now user-configurable — some bassists tune AEADG, others a
half-step-flat BbEbAbDbGb, and the engine needs to support any 5-string
tuning, not just BEADG.

**`src/fse-retune.js`:** added `parseTargetNote(spec)` (note-name + octave
parser, e.g. `"B0"`, `"Bb1"`, `"F#2"`, scientific pitch notation) and
`resolveTargetTuning(spec)` (5-entry spec → `{ midiTuning, labels }`,
falling back per-string to the BEADG default on anything malformed or
missing — a corrupt/partial custom tuning degrades one string at a time,
never breaks the whole render). Every remap function
(`resolveTargetForFret`, `remapNote`, `remapSlide`, `remapNoteEntry`,
`resolveChordCollisions`, `remapChordTemplate(s)`, `computeArrangementShift`,
`createRetuner().apply()`) gained an optional trailing `targetMidiTuning`
parameter, defaulting to the BEADG constant (`DEFAULT_TARGET_MIDI_TUNING`)
so every pre-existing call site keeps working unchanged. `createRetuner()`
cache-invalidates on a target-tuning signature in addition to its existing
chart-identity keys, so a tuning switch forces a full from-scratch remap of
the chart's raw (unfiltered) data — not an incremental patch — which is
also what makes a previously-dropped-as-unplayable note transparently
reappear if it's in range under the new target. The algorithm makes no
assumption that target strings are evenly spaced (a fourth, a fifth, or
anything else apart); every lookup is `target[j]`, not an assumed interval.
Duplicate note+octave across strings (e.g. an intentional unison pair) is
allowed — nothing keys off pitch uniqueness, only target string index.

**`screen.js`:** new per-panel state `_activeTargetTuning` (`{ midiTuning,
labels }`), refreshed by `_bgLoadSettings()` off two new global-only
settings keys (`targetTuningId`, `customTunings` — global because the
active tuning describes the player's real physical instrument, not a
per-panel aesthetic). `window.fse3dSetActiveTuning` / `fse3dSaveCustomTuning`
/ `fse3dDeleteCustomTuning` / `fse3dListCustomTunings` are the settings.html
bridge (same `_bgWriteGlobal`/`_bgEmitChange` pub-sub plumbing every other
live-updating setting already uses), so switching tunings mid-playthrough
takes effect on the very next rendered frame of the CURRENT song, not just
the next song load. The nut/headstock open-string-pitch labels read
`_activeTargetTuning.labels` instead of a hardcoded BEADG array. Per-string
colors were already keyed by target string INDEX (0-4), never by note name
(the dedicated "Low B" slot for index 0 predates this phase), so BEADG's
color layout is preserved automatically for every tuning with no change
needed there.

**`settings.html`:** new "Bass Tuning" section — an active-tuning dropdown
(BEADG + saved custom profiles) and an add/edit/delete form (name + 5
note+octave fields, each showing the standard BEADG value as a reference
underneath). Client-side regex validation mirrors
`FSE.parseTargetNote`'s pattern for immediate field feedback; the
authoritative validation is still `window.fse3dSaveCustomTuning`, which
calls the real parser.

**Verify:** `node test/retune-engine.test.mjs` (899 assertions — the
existing suite plus new cases for AEADG/BbEbAbDbGb full round-trips, the
un-drop-on-tuning-switch behavior, duplicate-note-across-strings, and an
irregular (non-fourth/fifth) interval target), `node --check screen.js`,
`node --check src/fse-retune.js`, and `bash build-tailwind.sh` to pick up
the new settings.html markup's Tailwind classes.

**Bumped this plugin's own `version`** from `0.1.2` to `0.1.3` (the new
settings.html markup's Tailwind classes) and then to **`0.1.4`** (the
BEADG-reference-hint markup added in a follow-up pass) — the version now
declared in `plugin.json`.

---

## Phase 11 — Configurable target string count (2026-07-12)

Lifts the remaining MVP guardrail from Phase 1/10: the target string
**count** was still hardcoded at 5 everywhere (`FSE.TARGET_STRING_COUNT`);
users can now add/remove strings from a saved tuning profile, top or
bottom only, min 4 / max 8. Bass-only scope, and the built-in default
profile (5-string BEADG), are both unchanged.

**Bounds: `[4, 8]`.** 4 matches `highway_3d`'s own minimum (explicit product
decision — fewer than 4 is rare enough to punt on unless requested later).
8 is `MAX_RENDER_STRINGS` (`screen.js`, sized from `PALETTES.default`'s 8
entries) — a real structural limit of the copied rendering arrays
(materials/gradients are only allocated up to that count), not an arbitrary
choice.

**`src/fse-retune.js`:** every function that bounded/sized itself against
the fixed `TARGET_STRING_COUNT` constant (`computeArrangementShift`,
`resolveTargetForFret`, `remapChordTemplate`, `createRetuner().apply()`)
now reads the actual resolved target array's `.length` instead — each
already threaded `targetMidiTuning` through from Phase 10, so the length
was always available at the call site. `resolveTargetTuning(spec)` now
resolves to `spec.length` entries (honoring the spec's own length exactly,
rather than always padding/truncating to 5), falling back per malformed
index to `DEFAULT_TARGET_TUNING[i]` for `i<5` or the new
`EXTENDED_DEFAULT_TARGET_TUNING`/`EXTENDED_CORE_INDEX` chain
(`['C#0','F#0','B0','E1','A1','D2','G2','B2','E3']`, index 2 = `'B0'`) for
longer specs. `TARGET_STRING_COUNT` itself is removed from the `FSE`
export; `MAX_TARGET_STRING_COUNT`/`MIN_TARGET_STRING_COUNT` (8/4) take its
place. Two new pure helpers — `midiToNoteLabel` (inverse of
`parseTargetNote`'s pitch math) and `defaultExtensionNote(direction,
edgeMidi)` — implement the stateless default-note rule a settings.html
"+ Add string" click uses: low extensions always drop a perfect fourth (5
half-steps) from the current edge string; high extensions rise a major
third (4 half-steps) *only* when extending from exactly the BEADG default
G2 (43) — matching the standard convention of a high B string above G, the
same interval guitar's own G→B uses — otherwise a perfect fourth, same as
low. Both are pure functions of "whatever note currently sits at the edge
being extended" — no session state, no persisted history, per explicit
product direction (a removed string's value is never remembered for a
later re-add).

**Color defaulting (`screen.js`, not `src/fse-retune.js` — this module
stays free of `PALETTES`/Three.js per its own header comment):** a fixed
note→color lookup table (`_fseDefaultColorForNote`), keyed by the *note
value* `defaultExtensionNote` produces, not array position or history: B0→
`FSE.lowBColor()` (the existing dedicated "Low B" slot), E1/A1/D2/G2→
`PALETTES.default[0..3]` (today's existing slots), B2/E3→
`PALETTES.default[4]`/`[5]` (guitar's own B/high-E slots — unused by this
plugin before this phase), F#0/C#0→`PALETTES.default[6]`/`[7]` (already
commented as "supplementary slots used for 7/8-string arrangements" —
already earmarked for exactly this). Any note outside this table (3rd+
extension in either direction, or extending a non-default/custom tuning)
defaults to light gray (`0xd3d3d3`) — an accepted edge case (two added
strings can look identical) per explicit product direction, not a bug; the
user can always repaint via the new per-string color picker.

**Tuning profile shape:** `{ id, name, strings: string[4..8], colors:
string[4..8] }` — `colors` is always fully populated with concrete resolved
hex, never a "track the live global palette" sentinel, for **custom**
profiles. The **built-in BEADG profile is untouched**: not a
`customTunings` entry, still resolves colors live off `FSE.lowBColor()` +
`PALETTES.default[0..3]` every frame, exactly as before this phase.
Growing it to 6+ strings happens by clicking "Add a tuning" (which now
pre-seeds the editor with BEADG's 5 defaults, snapshotted to concrete hex
the moment the editor opens) and saving as a new named profile — no change
to "the built-in is immutable." Pre-existing saved custom profiles (always
exactly 5 strings, no `colors` field) are lazily migrated the first time
they're read: backfilled with `[lowBColor(), default[0..3]]` (index-based,
reproducing their exact prior rendering — *not* a note-based lookup, so a
profile like AEADG whose index 0 isn't literally B keeps rendering
pixel-identical) and persisted without emitting a change event (mirrors the
existing `hwTheme` backward-compat backfill pattern).

**`screen.js` runtime:** `resolveStringCount(targetStringCount)` (the
PATCH POINT from Phase 4) now returns the active tuning's own string count
instead of a hardcoded 5 — the ONLY change needed on the rendering side,
because the copied `highway_3d` pipeline (materials, string meshes, fret
lanes, `nStr` reassignment + `_resetStringDependentCaches()` on a string-
count change) is **already** variable-string-count-capable up to
`MAX_RENDER_STRINGS`: that machinery exists to handle real 4-8 string
guitar/bass arrangements, and this plugin had simply never fed it anything
but a fixed 5 before now. `_bgLoadSettings` resolves `{ strings, colors }`
via the renamed `_fseResolveActiveTuning()` and branches exactly once on
"is this the built-in tuning" to build `activePalette` (built-in: today's
exact 5-wide `[lowB, default[0..3]]`; custom: `colors.map(_h3dHexToInt)`,
N-wide). `_recolorGemGradients`'s `isCustom` gate — previously "is the
*global palette selector* set to custom" — now also fires whenever a
custom *tuning* is active (new `_fseCustomTuningActive` panel flag), since
a custom tuning's colors can land anywhere (extension slots, a picker
override, a shorter/reordered tuning like 4-string EADG) and can't be
assumed to line up positionally with `DEFAULT_GEM_GRADIENTS` the way the
fixed built-in BEADG shape did; the existing `base !== PALETTES.default[s
- 1]` content check (unchanged) still only derives a custom gradient for
slots that actually differ from the stock color.

**New bridge functions:** `window.fse3dDefaultStringFor(direction,
edgeNoteSpec)` (wraps `FSE.defaultExtensionNote` + the color table) and
`window.fse3dResolveDisplayColor(strings, colors, index)` (resolves one
string's display color, `null`/missing colors falling back to the same
index-based built-in mapping) — both pure, stateless, called by
settings.html's editor.

**`settings.html`:** the fixed `grid-cols-5` 5-field block is replaced by a
dynamic vertical list of string rows (position label, note input, `<input
type="color">` swatch), built/re-rendered from local JS state (`rows`) on
every add/remove rather than static markup. "+ Add string below (low)" /
"+ Add string above (high)" buttons prepend/append a row (disabled at the
8-string ceiling); a "Remove" button appears only on the current top/bottom
row (disabled at the 4-string floor). A brand-new "Add a tuning" session
seeds from BEADG's 5 defaults (via `window.fse3dResolveDisplayColor`, so
swatches show real resolved colors, not placeholders); editing an existing
profile seeds straight from its own stored `strings`/`colors`. Local
`MIN_STRINGS`/`MAX_STRINGS` (4/8) and a full local reimplementation of
`defaultExtensionNote`'s note math + the color table mirror the
authoritative `src/fse-retune.js`/`screen.js` logic for the narrow pre-load
window before `window.fse3d*` registers (same established pattern as the
existing `NOTE_RE` mirror) — only used for the very first suggested
default in that race window, never for anything persisted.

**Verify:** `node test/retune-engine.test.mjs` (1053 assertions — the
existing suite plus new cases for `defaultExtensionNote`/
`midiToNoteLabel`, an explicit unplayable-low-note-drop regression test
against a reduced 4-string EADG target — both a direct
`resolveTargetForFret`/`remapNote` call and end-to-end through
`createRetuner`, mirroring the exact scenario described in the request —
variable-length target round-trips (4-string and 6-string), and
`remapChordTemplate` sizing at non-5 target lengths), `node --check
screen.js`, `node --check src/fse-retune.js`, and `bash build-tailwind.sh`
to pick up the new settings.html markup's Tailwind classes (the row list,
color swatches, and disabled-button states).

**Bumped this plugin's own `version`** from `0.1.4` to **`0.1.5`**
(`plugin.json`).

**Follow-up extraction (same day):** the first pass above put a fair amount
of genuinely new logic directly in `screen.js` (a fixed note→color lookup
table, tuning-profile validation, the legacy-colors migration/backfill) —
exactly the kind of thing Phase 9 established should live in
`src/fse-retune.js` instead, to keep `screen.js`'s own diff against
upstream `highway_3d/screen.js` as small/mechanical as possible. Moved out
everything that doesn't need `PALETTES`/Three.js:
- `colorRoleForNote(midi)` — the note→color lookup, but returning a
  *symbolic role string* (`'lowB'`/`'e'`/`'a'`/`'d'`/`'g'`/`'highB'`/
  `'highE'`/`'lowExt1'`/`'lowExt2'`/`'gray'`) rather than an actual color,
  since the real palette (`PALETTES.default`, `FSE.lowBColor()`'s live
  lookup) is `screen.js`/Three.js-owned data the module has no business
  embedding. `screen.js` keeps a small `_fseColorForRole(role)` switch
  (the only piece that still has to live there) mapping each role to its
  current actual color.
- `BEADG_COLOR_ROLES` — the same idea, but INDEX-based (not note-based),
  for the 5 BEADG core positions specifically: colors there are pinned to
  string POSITION, not note identity, by longstanding design (an AEADG
  tuning's position 0 isn't literally B, but still gets the "low string"
  role) — this is why it's a separate table from `colorRoleForNote` rather
  than the same lookup applied per-position.
- `isValidTuningStringsArray(strings)` — the bounds (4-8) + per-note
  `parseTargetNote` check, previously duplicated (with a latent
  opportunity to drift) between the storage-read filter and
  `fse3dSaveCustomTuning`'s validation; both now call the one function.
- `resolveColorsArray(colorsIn, length, defaults)` — collapses what were
  three near-identical hand-rolled loops (missing colors entirely, wrong
  length, individually-invalid entries) into one: any input shape that
  isn't a valid hex at a given index falls back to `defaults[i]`, so
  "migrate a legacy profile with no colors at all" and "patch one bad
  entry in an otherwise-fine array" are the same code path.
- `intToHex`/`LIGHT_GRAY_COLOR` — trivial, but genuinely pure (no
  `screen.js` dependency), so they moved alongside the above rather than
  staying as one-off duplicates.

Net effect in `screen.js`: `_fseDefaultColorForNote`'s 10-case switch
collapsed into a single `_fseColorForRole` switch (still ~10 cases, but now
just role→color, reused by every caller instead of baking note→color
directly into each one); the three colors-validation loops in
`_fseReadCustomTunings`/`fse3dSaveCustomTuning` collapsed to one
`FSE.resolveColorsArray` call each. Nothing touching `activePalette`
itself, `_bgLoadSettings`'s `isBuiltinTuning` branch, or
`_recolorGemGradients`'s `_fseCustomTuningActive` gate moved — those
mutate Three.js materials / per-panel closure state directly, the same
category Phase 9 already established stays in `screen.js`.

**Verify:** `node test/retune-engine.test.mjs` (1081 assertions — adds
direct coverage for `colorRoleForNote`/`BEADG_COLOR_ROLES`/
`isValidTuningStringsArray`/`resolveColorsArray`/`intToHex`, previously
only reachable indirectly through a browser-only `window.fse3d*` call),
`node --check screen.js`, `node --check src/fse-retune.js`. No
`settings.html` changes in this pass, so no `build-tailwind.sh` re-run
needed.

**Second follow-up (same day): split `src/fse-retune.js` into four
modules.** By the end of the two passes above, the single file had grown
to ~650 lines mixing several genuinely distinct concerns (note-name
parsing, tuning-spec resolution, chart-remap math, per-string color
handling) — user feedback: "fse-retune.js is starting to grow large, and
has a bunch of different types of logic in it." Split along those exact
lines, one file per concern, each small and independently readable:

- **`src/pitch.js`** — note-name ⇄ MIDI conversion (`parseTargetNote`,
  `midiToNoteLabel`). Zero internal dependencies.
- **`src/target-tuning.js`** — what a target tuning IS and how to
  resolve/default one (`resolveTargetTuning`, `defaultExtensionNote`,
  `isValidTuningStringsArray`, `computeArrangementShift`, the
  `DEFAULT_TARGET_TUNING`/`EXTENDED_*`/`MIN`/`MAX_TARGET_STRING_COUNT`
  constants). Depends on `pitch.js`.
- **`src/retune-engine.js`** — the chart-remap MATH itself (`remapNote`,
  `remapSlide`, `resolveChordCollisions`, `remapAnchors`,
  `remapChordTemplate(s)`, `createRetuner`). Depends on
  `target-tuning.js` for the BEADG default target and the fret ceiling.
- **`src/string-colors.js`** — per-string color role + hex handling
  (`colorRoleForNote`, `BEADG_COLOR_ROLES`, `lowBColor`, `intToHex`,
  `resolveColorsArray`). Depends on `pitch.js` and `target-tuning.js`.

Dependency direction is one-way (`pitch` ← `target-tuning`/`string-colors`
← `retune-engine`); nothing depends back on the barrel or on
Three.js/screen.js's closure state. One small correctness improvement fell
out of the split for free: `colorRoleForNote`'s note→role table was
previously a second hardcoded switch duplicating the exact MIDI numbers
`target-tuning.js`'s `EXTENDED_DEFAULT_TARGET_TUNING` already encodes (a
latent two-places-to-update-in-lockstep risk); it's now built once at
module load by parsing `EXTENDED_DEFAULT_TARGET_TUNING` itself, so the two
literally cannot drift apart.

`src/fse-retune.js` itself is now a ~35-line barrel: `import * as X from
'./x.js'` from all four, spread into the same `export const FSE = {...}`
shape as before. **Zero external API change** — `screen.js`'s `import {
FSE } from './src/fse-retune.js'` and every existing `FSE.xxx` call site,
plus `test/retune-engine.test.mjs`'s `import { FSE } from
'../src/fse-retune.js'`, are byte-for-byte unchanged; only the internal
file layout moved. `src/package.json`'s `{"type":"module"}` already scopes
the whole `src/` directory, so the new files need no additional Node/ESM
wiring.

**Verify:** `node --check` on all five files in `src/`
(`pitch.js`/`target-tuning.js`/`retune-engine.js`/`string-colors.js`/
`fse-retune.js`), `node test/retune-engine.test.mjs` (1081 assertions,
unchanged pass/fail behavior — same test cases, now exercised through the
barrel's re-exports), and a direct check that
`Object.keys(FSE)` is still the same 33 keys as before the split (no
name collisions across the four modules, nothing accidentally dropped).

---

## Phase 12 — Guitar arrangements: per-class tuning profiles (2026-07-12)

Widens scope from bass-only to bass + guitar (Lead/Rhythm/Combo/plain
"Guitar"). The string/tuning machinery was already general (Phases 10-11);
what guitar needed was (a) its own tuning defaults, (b) profile routing by
arrangement, and (c) chord-aware remapping (Phase 13).

**Three tuning profiles, one pool.** Settings grow from one global
`targetTuningId` to three GLOBAL-only keys — `targetTuningIdBass` /
`targetTuningIdRhythm` / `targetTuningIdLead` — each a pointer into the
SAME pool of built-in presets + saved custom tunings, so any profile may
use any tuning (a bass tuning on a guitar arrangement is legal, per
explicit product direction). Bass defaults to `eadg` (unchanged); rhythm
and lead default to the new built-in **EADGBE** preset (`E2 A2 D3 G3 B3
E4`, MIDI 40/45/50/55/59/64). A one-time idempotent migration
(`_crMigrateLegacyTuningProfile`, screen.js) copies a pre-existing
`targetTuningId` into the Bass key without emitting a change event
(hwTheme-backfill pattern); rhythm/lead deliberately do NOT inherit the
bass pick. `cr3dSetActiveTuning` now takes `(arrClass, id)`;
`cr3dDeleteCustomTuning` resets every profile pointing at the deleted id
to its own class default. settings.html's "Bass Tuning" section became
"Target Tunings" with three selects sharing one dropdown pool + the single
shared editor; its mirrored constants gained `eadgbe`, per-class defaults,
and per-class localStorage keys (bass reads the legacy key as a pre-load
fallback).

**Routing (`CR.arrangementClassFor`)**: word-bounded, case-insensitive —
`bass` → bass (checked first: "Lead Bass" is bass), `lead` → lead,
anything else guitar-ish (rhythm/combo/guitar/unknown non-empty) → rhythm
(product decision: combos are chord-heavy). Empty/missing arrangement →
bass, preserving pre-guitar behavior for hosts that never populate
`songInfo.arrangement`. Per-PANEL state (`_crArrClass`): splitscreen
panels may show different arrangements simultaneously, so draw() tracks
the class per panel and calls `_bgLoadSettings()` on change; the class is
NOT folded into `_crTuningSig` — the sig compares *resolved*
strings+colors, so two profiles pointing at one tuning correctly no-op on
an arrangement flip, and the existing rebuild path fires when they differ.

**EADGBE colors.** Guitar-octave notes sit outside the bass-octave
note-identity chain (`colorRoleForNote` would return 'gray'), so the
preset carries an explicit per-position `roles` array
(`['e','a','d','g','highB','highE']`) that `resolveActiveTuning` passes
through and `_bgLoadSettings`'s live-tracked branch prefers over
note-identity derivation. The chain itself is deliberately NOT extended
with guitar MIDIs — `defaultExtensionNote` and the editor's color
suggestions key off the bass chain, and extending it would silently change
what a user adding an E2/A2/... string to a custom bass tuning is offered.
`_crColorForRole` and `GEM_GRADIENT_ROLE_INDEX` already had highB/highE
slots (4/5), so no palette plumbing changed.

**Deliberate behavior change:** `resolveActiveTuning`'s unknown/deleted-id
fallback moved from the hardcoded BEADG shape to the *class default
preset* (EADG for bass, EADGBE for guitar classes) — more predictable (it
matches a fresh install) and right for guitar profiles. Auto-mode's
`matchesArrangement` widened from `/\bbass\b/i` back to highway_3d's own
`/\b(?:lead|rhythm|bass|combo|guitar)\b/i`.

**More presets (same session):** three further built-ins — **BEADGBE**
(7-string guitar, MIDI 35..64; live-tracked, low string on the dedicated
`lowB` role since core's "Low B" swatch is literally the 7-string low-B
color), **Baritone BEADF#B** (standard guitar down a fourth, MIDI
35,40,45,50,54,59; live-tracked with roles position-parallel to EADGBE —
colors pinned to string position per the plugin-wide rule), and **Violin
GDAE** (MIDI 55,62,69,76; concrete colors like Cello — no live role fits
a fifths instrument — reusing Cello's note-parallel G/D/A hues plus a red
E). All three mirrored into settings.html's `BUILTIN_PRESETS`.

Five more in the same batch: **Upright bass solo F#BEA** (EADG up a whole
step, MIDI 30,35,40,45; live-tracked, bass-position roles
`['e','a','d','g']`), **Viola CGDA** (Cello an octave up, MIDI
48,55,62,69, Cello's colors), **Banjo 4-string CGBD** (plectrum, MIDI
48,55,59,62; family hues, B adds `#1096e6`), **Banjo 5-string gDGBD**
(open G, MIDI **67**,50,55,59,62 — string 0 is deliberately the HIGH G4
drone, matching banjo tab's bottom-line-is-5th-string convention and the
drone-first way the tuning is written; the engine/solver make no
ascending-pitch assumption so a non-monotonic target is legal; the drone
string's short neck is NOT modeled — see Future enhancements), and
**Mandolin GGDDAAEE** (four paired courses, MIDI 55/62/69/76 doubled —
exactly `MAX_TARGET_STRING_COUNT`; one color per course pair, a course
being one logical string).

**Debt note:** settings.html's mirrored constants grew again (3 profile
keys, 2 class defaults, 9 new presets). If it grows further, consider
serving the constants as JSON from `routes.py` so the panel stops
duplicating `src/target-tuning.js` — out of scope here.

**Verify:** `node test/retune-engine.test.mjs` (EADGBE preset resolution,
`arrangementClassFor` routing incl. word-boundary/empty cases, per-class
defaulting + fallback, roles passthrough). Browser: legacy
`chart_retuner_bg_targetTuningId` migrates to Bass; a Lead chart renders a
6-string board with guitar palette slots; splitscreen bass+lead panels get
4 and 6 strings simultaneously; deleting a custom tuning assigned to two
profiles resets both to their class defaults.

---

## Phase 13 — Chord-aware remapping (2026-07-12)

Guitar charts are full of open/barre chords that don't survive per-note
pitch-exact remapping across tunings (an open shape under a -1 tuning
shift drops its open strings to fret −1). New pure module
**`src/chord-solver.js`** (fifth module in the `CR` barrel; depends only
on `pitch.js`/`target-tuning.js` — never on `retune-engine.js`, keeping
the Phase-9 one-way dependency graph) plus routing inside
`createRetuner().apply()`.

**Priorities (product direction, in order):** (1) playable — fretted
stretch within a 4-fret box (`MAX_CHORD_SPAN = 3` as max−min) unless the
source chord itself stretched further, ≤ 4 fretting fingers with barre /
contiguous-run (mini-barre) grouping; (2) hand shape comparable — chord
identity is the pitch-class set + root ("revoice near position"): exact
sounded pitches strongly preferred, but openness / position / no-new-barre
similarity wins over pitch fidelity when they conflict; (3) root in the
bass — weakest term, inversions/triads acceptable.

**Tier ladder** (`solveChord`): Tier 0 = the existing per-note remap,
accepted when drop/collision-free AND playable, or when it IS the source
voicing verbatim (chart-given = playable by definition) — this is what
keeps bass output identical wherever today's path was clean. Tier 2 =
position-windowed DFS revoicing search (`solveVoicingSearch`,
branch-and-bound on the exact-pitch partial cost, positions visited
nearest-to-source-position first; voicing size hard-capped at the source
note count). No "Tier 1": the search enumerates every exact-pitch voicing
anyway, so a strong `EXACT_PITCH_MISS` weight subsumes it. Tier 3 =
degradation ladder (full pcs → triad → root+5th dyad → bare root), rungs
compared on cost + rung × `DEGRADE_RUNG`. Weights live in
`SOLVER_WEIGHTS` (starting points, pinned by tests): shape terms
collectively outweigh `ROOT_NOT_IN_BASS`, encoding priority 2 > 3.

**Integration (`createRetuner`, PATCH POINT (chord solver)):** templates
solve FIRST (per remap run, cached by ordered s/f/slide signature +
name), so chord instances — including difficulty-filtered SUBSETS, applied
per source string — and the hand-shape chords screen.js synthesizes
straight from `bundle.chordTemplates` follow the same voicing by
construction. Flat same-onset buckets of ≥ 2 notes route through the same
solver; single notes keep the per-note path byte-for-byte. Materialized
notes keep source fields + `_origNote` (scorer contract); Tier-0
placements reuse the engine entry (incl. remapped slide endpoints),
revoiced ones re-apply the source slide delta clamped to fret 20.
Template fingers: carried per string on Tier 0 (pre-solver behavior)
unless a note crossed the open/fretted boundary; otherwise
`computeChordFingers` derives plausible ones (canonical per-note first,
barre + run grouping when needed, all −1 when ambiguous).

**Deliberate behavior changes (bass):** a bucket whose notes collide on
one target string no longer silently loses a pitch — the solver revoices
(pinned in tests); an exactly-mapped group that is *unplayable as a chord*
(span/finger blowout from non-uniform per-string adjustments) also
revoices now. Everything drop/collision-free and playable is Tier 0 =
unchanged. Template `fingers` may now be a generated array where the
source had none.

**Cost:** cold remap of a 60-template / 2000-note synthetic chart ≈ 4 ms
(once per song/tuning switch, inside the existing whole-remap cache);
per-frame cache-hit apply ≈ 0.1 µs. Labels are NOT rewritten when a chord
degrades (an "Am7" diagram may show a simplified voicing) — accepted for
now; revisit if feedback wants a marker. Scoring still keys on the
ORIGINAL chart positions via `_origNote` — revoiced chords widen the gap
between what's judged and what's fretted; documented in the README.

**Verify:** `node test/chord-solver.test.mjs` (root parsing, barre/run
finger heuristics, playability, spec/ladder construction, search identity
+ revoicing cases, plus end-to-end `createRetuner().apply()`: E-std→EADGBE
identity, E→Drop-D Tier 0, capo-2 shape shift, Eb-std→E-std revoice with
template/subset consistency, Drop-D flat-bucket, chord slides, bass
double-stop regression + collision-improvement pin, 7-string GP
degradation, mid-run target switch). `node test/retune-engine.test.mjs`
passes with zero changes to the pre-existing engine-function assertions.

---

## Future enhancements (backlog, no phase yet)

Collected from Phase 12/13 work and the preset expansion — none blocking,
all candidates for their own phase later:

- **Wider stretch allowance for short-scale / high-register targets.**
  `MAX_CHORD_SPAN` (4-fret box) encodes a guitar-scale hand. Violin/viola/
  mandolin scale lengths make wider reaches normal (and fifths tunings
  need them); consider a per-preset span allowance, or deriving it from
  the target's register.
- **Anchor-donor refinement after revoicing.** `remapAnchors` borrows the
  fret adjustment of the nearest remapped note; an octave-revoiced
  (tier ≥ 2) donor can lurch the hand-position ghost. Prefer tier-0 /
  single-note donors when one is nearby. Cosmetic.
- **Chunk the cold solve across frames** if a pathological chart
  (thousands of distinct simultaneous-note shapes) ever hitches on song
  load — the bucket-signature cache makes this unlikely (measured ≈4 ms
  for a 60-template chart), so wait for a real report.
- **Degraded-chord label marker.** After the ladder simplifies a chord,
  the diagram still shows the chart's original name ("Am7" over a power
  chord). Consider a displayName suffix on the rebuilt template.
- **Serve settings.html's mirrored constants from routes.py** as JSON —
  the panel duplicates presets/defaults/keys from `src/target-tuning.js`
  (can't import modules there) and the mirror keeps growing.
- **Judgment translation for revoiced chords.** Scoring (note_detect)
  keys on `_origNote` — the ORIGINAL chart positions — so revoiced chords
  are judged against frets the player isn't fretting. Documented in the
  README; a deeper core integration could translate judgments to the
  remapped positions.
- **Instrument quirks presets can't express.** A 5-string banjo's drone
  string is short (nothing below its 5th fret) and never barred; the
  solver has no per-string fret floor, so it may place low fretted notes
  on the drone lane. A per-string min-fret field on presets would model
  it if banjo targets see real use.

---

## Phase 14 — Post-review fixes (2026-07-13)

An xhigh-effort `/code-review` over the Phase 12/13 diff surfaced 11
findings (3 confirmed bugs, 3 plausible, 5 cleanup). All fixed:

1. **Pitch-ordered string walk** (`resolveTargetForFret`,
   retune-engine.js): the old walk stepped by INDEX (j±1), assuming
   ascending pitch — banjo5_gdgbd's drone-first layout broke that (29 of
   126 swept guitar-chart notes wrongly dropped: overflow marched away
   from the high drone at index 0). The walk now moves in PITCH order via
   per-target rank tables (WeakMap-cached by array identity; ascending
   arrays — the common case — skip the tables entirely and behave
   byte-identically). A direction lock doubles as a termination
   guarantee: reversing direction proves the note fits nowhere. That also
   fixes a PRE-EXISTING hard hang — two pitch-adjacent strings more than
   TARGET_MAX_FRET semitones apart (any user custom tuning like
   E1+high-E5) made the old walk oscillate forever on the render thread.
   The new walk is complete (finds a placement iff one exists), pinned by
   a full-chart sweep test asserting zero wrongly-dropped notes and exact
   pitch preservation on banjo5.
2. **Null chord id** (createRetuner): `Number(null) === 0` let a chord
   with `id: null` alias template index 0's solved voicing. Guarded with
   the same `== null` check screen.js's chord-ghost helpers use.
3. **Duplicate-source-string dedup** (createRetuner, template-first
   branch): a malformed chord doubling a string emitted two notes stacked
   on one target string/fret; now first-wins deduped, matching the
   one-note-per-slot invariant of every other path.
4. **Sliding chords skip the template shortcut** (createRetuner): the
   template solution is solved from PLAIN frets and can't reproduce
   remapSlide's lower-endpoint anchoring, so chords carrying sl/slu now
   route ad-hoc (whose Tier 0 goes through remapNoteEntry/remapSlide).
   Pinned with a case where the two paths pick different strings.
5. **Degenerate span no longer empties the search** (solveVoicingSearch):
   `allowedSpan` is clamped to TARGET_MAX_FRET-1 so a 20+-fret source
   span (extreme GP import) widens the window instead of skipping the
   position loop — which also gated the open-string candidates — and
   silently dropping the chord.
6. **Non-array `template.fingers` passthrough** (createRetuner): charts
   that omit finger data entirely keep the omission (no fabricated
   digits), restoring the pre-solver invariant; GP's all--1 ARRAYS still
   get plausible fingers on revoiced shapes as designed.
7. **Per-frame classifier guard** (screen.js draw()): the arrangement
   class is re-derived only when the raw arrangement STRING changes; the
   steady-state per-frame cost is one strict compare.
8. **Shared pitch-class parsing**: pitch.js gains `notePitchClass`
   (letter+accidental -> 0..11), used by both parseTargetNote and
   chord-solver's parseChordRootFromName — the duplicated note-letter
   table is gone.
9. **One fret clamp**: `_clampFret` is the module's single clamp;
   remapSlide's local duplicate removed.
10. **One profile-key source of truth** (screen.js):
    `_CR_PROFILE_KEY_BY_CLASS` / `_CR_PROFILE_CLASSES` / `_CR_PROFILE_KEYS`
    drive the GLOBAL-only exclusion, the change-listener case,
    `_crProfileKeyFor`, and `cr3dDeleteCustomTuning`'s loop.

**Verify:** `node test/retune-engine.test.mjs` (315 assertions — banjo5
pitch-walk completeness sweep, drone-reach, termination cases) and
`node test/chord-solver.test.mjs` (107 — null-id routing, duplicate
dedup, slide anchoring, degenerate span, fingers passthrough);
`node --check` on screen.js + all src modules.

## Phase 15 — Per-tuning max fret (2026-07-13)

Replaces the engine's blanket hardcoded 20-fret ceiling (`TARGET_MAX_FRET`)
with a per-tuning-profile `maxFret`, selectable from a fixed option list
(12, 14, 20, 21, 22, 24) rather than free-typed — matches how the rest of
the tuning editor avoids free-text validation. Charts rarely carry data
above fret 20 (usually a transcribed solo passage), so 24 is a safe,
generous default for anything not deliberately narrower.

1. **`src/target-tuning.js`**: `TARGET_MAX_FRET` renamed
   `DEFAULT_MAX_FRET` (still the engine's fallback when no profile-specific
   value is threaded through — deep safety net, not a real code path since
   screen.js always resolves one). New `MAX_FRET_OPTIONS` +
   `isValidMaxFret`. Every `BUILTIN_PRESET_TUNINGS` entry gets a `maxFret`:
   EADG (bass default) keeps the historical 20; the 5-string bass and
   every guitar preset (EADGBE, 7-string, baritone) get 24; Violin and
   Mandolin — genuinely short-necked/fretless instruments — get 14; the
   remaining orchestral/folk presets (upright bass solo, Cello, Viola,
   both banjos) don't have a settled real-world fret-equivalent, so they
   also default to 24 rather than a guessed narrower number.
   `resolveActiveTuning` returns `maxFret` alongside
   `strings`/`colors`/`roles`; a custom tuning's own `maxFret` is validated
   via `isValidMaxFret` and falls back to `DEFAULT_MAX_FRET` when
   missing/invalid (covers tunings saved before this feature existed).
2. **`src/retune-engine.js` / `src/chord-solver.js`**: every function that
   used to read the `TARGET_MAX_FRET` constant now takes `maxFret` as a
   trailing parameter defaulting to `DEFAULT_MAX_FRET` — backward
   compatible by construction, so the entire existing test suite kept
   passing unchanged except for the constant rename.
   `createRetuner().apply(bundle, targetMidiTuning, maxFret)` threads it
   through the whole remap (templates, chord instances, flat-note buckets,
   anchors), and folds it into the internal `targetSig` cache key — two
   profiles sharing the same strings but a different ceiling must not
   cache-hit each other's remap.
3. **screen.js**: new per-panel `_crMaxFret`, refreshed in lockstep with
   `_activeTargetTuning` at both PATCH POINTs
   (`_primeActiveTargetTuningForInit`, `_bgLoadSettings`) and threaded into
   the per-frame `_crRetuner.apply()` call. Tracked independently of
   `_bgLoadSettings`'s `tuningSig` (which gates the palette-recompute
   branch) since `maxFret` doesn't affect colors — a maxFret-only edit
   shouldn't force an unrelated palette re-derivation.
   `cr3dSaveCustomTuning` validates/defaults the saved `maxFret`;
   `_crReadCustomTunings` passes it through as read, relying on
   `CR.resolveActiveTuning` as the single source of truth for the
   missing/invalid fallback.
4. **settings.html**: new "Max fret" `<select>` in the custom-tuning
   editor (12/14/20/21/22/24), seeded from the tuning being edited (or
   `BUILTIN_PRESETS[0]`/EADG's 20 for a brand-new tuning) and saved
   alongside strings/colors. Mirrored `MAX_FRET_OPTIONS`/
   `DEFAULT_MAX_FRET`/`isValidMaxFret` (same mirror-debt tradeoff as the
   rest of this panel — see the routes.py-served-constants backlog item
   below). The manage list shows each saved tuning's max fret alongside
   its strings.

**Verify:** `node test/retune-engine.test.mjs` (335 assertions — adds
`resolveActiveTuning`/preset `maxFret` coverage plus engine-level ceiling
tests: a fret drops at the default 20, resolves once widened to 24, drops
again at a narrower 14; `createRetuner` end-to-end widen/narrow +
cache-invalidation) and `node test/chord-solver.test.mjs` (113 — a
root pitch-class reachable only past a narrow ceiling is unsolvable there
and solvable once the ceiling widens, for both `solveVoicingSearch` and
`solveChord`); `node --check` on screen.js + all src modules; the four
inline `<script>` blocks in settings.html syntax-checked individually
(not covered by `node --check` on an .html file).
