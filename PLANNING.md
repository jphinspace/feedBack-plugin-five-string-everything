# Five-String Everything — bass tuning-remap plugin for feedBack

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
- Fixed 5-string BEADG target tuning — no tuning picker.
- `cent_offset` (RS2014 global pitch-shift field) is ignored, same as it's
  excluded from `lib/song.py`'s own note-pitch formula. Songs with a nonzero
  `cent_offset` will remap incorrectly; document as a known limitation.
- Chord finger-diagram/hand-shape ghosting metadata (`chordTemplates`) will
  not be regenerated for remapped chords — it may show a stale fingering
  inconsistent with the remapped notes. Acceptable for MVP since bass charts
  are mostly monophonic; document as a known cosmetic limitation.
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
     (finger-diagram fret arrays, used for chord-ghost/hand-shape rendering)
     remains the one known, already-documented exception (Phase 3) — fixing
     it would mean synthesizing new templates matching the remapped chord
     notes, out of scope for MVP given bass charts are mostly monophonic.
6. Everything else in the copied file — themes, video backgrounds, camera,
   lighting, particle effects, splitscreen support, hand-shape ghosting,
   lyrics, minimap, event listeners (`highway:visibility`,
   `highway:canvas-replaced`, `notedetect:hit`/`notedetect:skin`) — stays
   byte-for-byte as copied from `highway_3d`.

**Verify:** `diff` our patched `screen.js` against the untouched
`highway_3d/screen.js` copy from Phase 1 and confirm every hunk maps to one
of the five patch points above (plus the Phase 1 identity/route renames) —
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
