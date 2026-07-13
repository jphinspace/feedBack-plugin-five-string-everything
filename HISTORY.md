# Chart Retuner — development history

A condensed record of completed work. Future/unimplemented work lives in
[`PLANNING.md`](PLANNING.md), which also carries the repeatable upstream-sync
procedure; the sync **log** (what was actually synced, when) is at the bottom
of this file.

*Note: this plugin and repo were originally named "Five-String Everything"
(internal abbreviation `FSE` / `fse-retune.js`); renamed to Chart Retuner in
v0.2.0 (globals `fse3d*` → `cr3d*`, barrel export `FSE` → `CR`). Entries below
use whichever name was current at the time.*

## Settled design (why the plugin is shaped this way)

- **Own renderer, not a hook.** feedBack has no hook to transform a chart's
  notes/chords/tuning before a renderer or scorer reads them, and core's
  `stringCount` is a private closure primitive with no setter. So this plugin
  is an independent `setRenderer`-contract visualization built by **forking
  `highway_3d/screen.js` verbatim** and patching it minimally — we own the
  copy outright. Rendering matches `highway_3d` in every respect except note
  gem position (and everything derived from it).
- **Pure string/fret offset arithmetic** — one fret = one half-step; no
  frequency/Hz ever computed. One general algorithm, **no tuning-specific
  special cases**: identity tunings (EADG→BEADG's top 4, BEAD→BEADG, etc.)
  fall out of the math, not detection.
- **Fret-numbering convention (load-bearing):** fret 0 = open string,
  confirmed against both `highway_3d` and `lib/song.py`. Any off-by-one
  anywhere silently desyncs everything.
- **Scoring is unaffected by a purely-visual remap.** The plugin never
  mutates `bundle.notes`/`.chords`/`.songInfo`; note_detect judges detected
  audio pitch against the original chart data. Remapped note copies carry an
  `_origNote` back-reference so `getNoteState` lighting keys correctly.
- **Chord collisions:** two notes landing on one target string keep only the
  lower-pitched one (per string, not per chord) — later superseded by the
  chord solver revoicing instead (Phase 13).
- **No enable/disable toggle** — `matchesArrangement` + the viz picker are
  the on/off mechanism.
- **Known limitation:** RS2014 `cent_offset` is ignored (same as
  `lib/song.py`'s note-pitch formula); charts with a nonzero value remap
  incorrectly. Backlogged in PLANNING.md.

## Patch points — the auditable diff against upstream `highway_3d/screen.js`

Every behavioral difference from the upstream copy must trace to one of
these (plus the mechanical isolation renames below). This list is the
contract the sync procedure audits against.

1. **Note/chord substitution shim** — `CR.createRetuner().apply(bundle,
   targetMidiTuning, maxFret)` builds cached, shallow-copied note/chord
   arrays with `s`/`f`/`sl`/`slu` remapped; everything downstream consumes
   the copies.
2. **`resolveStringCount()`** — returns the active target tuning's string
   count instead of the chart's.
3. **Open-string nut labels** — from the active tuning's labels (capo
   re-spells them to sounding pitch), never the chart tuning.
4. **Per-string color palette** — target-indexed; the low-B extension slot
   reads core's shared "Low B, 7-string" (`low7`) Highway String Color.
5. **Anchors** — `bundle.anchors` reassigned via `CR.remapAnchors` (each
   anchor borrows the fret adjustment of the nearest remapped note).
6. **Chord templates** — `bundle.chordTemplates` reassigned; entries
   re-indexed to target strings (fixes hand-shape–synthesized chords).
7. **Chord solver routing** — chords/same-onset buckets route through
   `src/chord-solver.js`'s tier ladder inside the retuner.

**Isolation renames (Phase 7):** all `window.h3d*`/`h3dBg*` globals,
`h3d_bg_`/`viz3d_*`/debug storage keys, and settings.html DOM ids renamed to
plugin-scoped equivalents — required because every installed plugin's
`screen.js` and settings snippet load unconditionally into shared
page/storage scope alongside the real `highway_3d`. **One deliberate
exception:** `window.__h3dCamCtl`/`__h3dCamCtlPanels` stay unrenamed — a
public integration bridge for the third-party Camera Director tool (see
`FREECAM_BRIDGE.md`). The core-owned Highway String Colors section is *not*
duplicated in our settings panel (shared by design; `highway_3d`'s panel
edits it).

## Phase log

**Phase 1 — Fork, scaffold, register.** Copied `plugins/highway_3d/`
wholesale; own plugin identity and renamed backend routes; placeholder
settings panel; `matchesArrangement` narrowed to `/bass/i` (MVP bass-only,
fixed 5-string BEADG target).

**Phase 2 — Remap engine.** Per-arrangement natural string shift
(`computeArrangementShift`: most exact string matches wins, then smallest
total adjustment, then smallest |k|), then a per-note walk anchored on the
natural target string, stepping away only when the fret is genuinely out of
range. (An earlier "globally smallest adjustment" form shipped a real bug:
right on Drop D, wrong on Drop C#.) Slides: both endpoints resolve to one
target string (anchored on the lower fret), overflow clamps to the max fret
instead of dropping. Pinned by full-chart tests: Drop D, real Drop C#
(`[-3,-1,-1,-1]`), EADG/BEAD/already-BEADG identities, out-of-range drops.

**Phase 3 — Chord collisions.** Lower-pitched note wins per colliding target
string. Correction from manual testing: also applies to same-onset **flat
notes** (bass double stops are often not `Chord` objects) — grouped by onset
and run through the same resolution.

**Phase 4 — Patch the fork.** All patch points above landed here, three of
them found via manual-testing feedback: the palette fix (low B must use
core's `low7` color `#cc00aa`, not the guitar-B green — that's a different
"B"), anchors (hand-position highlight band was stale), and chord templates
(a chart with **zero** real `Chord` objects synthesizes its visible chords
from hand-shape spans + `chordTemplates`, a path that had bypassed the remap
entirely). Verified by diffing the whole file against upstream — every hunk
traces to a patch point.

**Phase 5 — Caching + note-state passthrough.** Remap rebuilds only on chart
identity / tuning-signature change, never per frame; `getNoteState` receives
the original note object via `_origNote`.

**Phase 6 — Auto-mode findings.** The Auto-mode first-match tiebreak follows
**on-disk plugin directory name sort order** (not `plugin.json` id); this
repo's name sorts before `highway_3d`. Also: a persisted manual pick in
`localStorage.vizSelection` bypasses Auto entirely — check the picker before
diagnosing a tiebreak problem.

**Phase 7 — Full settings UI + isolation.** Restored `highway_3d`'s ~1800-line
settings panel minus Highway String Colors, after the isolation renames
described above (globals, storage keys, DOM ids — all three collide across
plugins because everything loads into one shared page).

**Phase 8 — Upstream sync.** Established the repeatable sync procedure (now
maintained in PLANNING.md) and performed the first sync — see the sync log
below.

**Phase 9 — Engine extracted to `src/` (v0.1.2).** All genuinely-new logic
moved out of `screen.js` into an ES module (`plugin.json` gained
`"scriptType": "module"`; core serves `/api/plugins/<id>/src/…`). Tests
import the real module — no more hand-maintained duplicate. The Phase 7
mechanical renames deliberately stay inline in `screen.js` (they're renamed
*upstream* code, and extracting them would fight the sync goal).

**Phase 10 — Configurable target tuning (v0.1.3–0.1.4).** Any 5-string
pitch set via `parseTargetNote`/`resolveTargetTuning` (per-string fallback
on malformed specs); settings dropdown + custom-tuning editor; live mid-song
switching through the settings change bus; retuner cache invalidates on a
target-tuning signature.

**Phase 11 — Configurable string count 4–8 (v0.1.5).** Bounds: 4 =
highway_3d's own minimum, 8 = `MAX_RENDER_STRINGS`. The copied rendering
pipeline was already variable-count-capable; `resolveStringCount` just feeds
it the tuning's count. Note→color-role tables (`colorRoleForNote`,
`BEADG_COLOR_ROLES`), per-string color pickers, add/remove-string editor
with pure default-note rules. Two same-day follow-ups extracted remaining
logic from `screen.js` and split the module into `pitch.js` /
`target-tuning.js` / `retune-engine.js` / `string-colors.js` behind a barrel
(one-way dependency graph; zero external API change).

*(v0.2.0 — renamed to Chart Retuner, see the note at the top.)*

**Phase 12 — Guitar arrangements.** Three per-class tuning profiles
(bass/rhythm/lead — `targetTuningIdBass`/`…Rhythm`/`…Lead`) over one shared
pool of presets + customs; `arrangementClassFor` routing ("Lead Bass" is
bass; combos are rhythm; empty → bass); EADGBE default for guitar classes;
one-time legacy-key migration; `matchesArrangement` widened back to
highway_3d's own regex. Preset batch: 7-string BEADGBE, baritone BEADF#B,
violin GDAE, upright bass solo F#BEA, viola CGDA, both banjos (banjo5's
drone-first gDGBD is deliberately non-monotonic), mandolin GGDDAAEE.

**Phase 13 — Chord solver (`src/chord-solver.js`).** Tier ladder: 0 = the
per-note remap when collision-free and playable (keeps clean bass output
byte-identical), 2 = position-windowed branch-and-bound revoicing search,
3 = degradation ladder (full pitch-class set → triad → root+5th → root).
Playability = 4-fret box (`MAX_CHORD_SPAN`) unless the source stretched
further, ≤ 4 fingers with barre/run grouping. Weights in `SOLVER_WEIGHTS`
encode openness/position/no-new-barre > root-in-bass. Templates solve first
and instances/difficulty-subsets/synth chords follow them by construction.
Cold solve ≈ 4 ms for a 60-template chart; per-frame apply is a cache hit.
Deliberate bass behavior change: colliding buckets now revoice instead of
silently dropping a pitch.

**Phase 14 — Post-review fixes (2026-07-13).** 11 findings from an
xhigh-effort code review, all fixed. Headline: `resolveTargetForFret`'s walk
now moves in **pitch order** via per-target rank tables instead of index
order — fixes banjo5 wrongly dropping 29/126 swept notes *and* a
pre-existing infinite-loop hang on targets with a > max-fret gap between
pitch-adjacent strings; a direction lock guarantees termination. Also:
null chord id aliasing template 0, duplicate-source-string dedup, sliding
chords bypass the template shortcut, degenerate span clamp, non-array
fingers passthrough, per-frame classifier guard, shared pitch-class parsing,
single fret clamp, single profile-key source of truth.

**Phase 15 — Per-tuning max fret (2026-07-13).** `maxFret` per tuning
profile (options 12/14/20/21/22/24), threaded as a trailing parameter
through the engine/solver (defaulting to `DEFAULT_MAX_FRET`) and folded into
the retuner's cache signature; editor `<select>`; per-preset values (EADG
keeps 20, guitars 24, violin/mandolin 14).

**Phase 16 — Capo & octave offset, ukulele presets (v0.4.0, 2026-07-13).**
Both fold into the *effective* target the engine already accepts —
`effectiveTargetMidiTuning(midi, capo, oct)` = `m + capo − 12·oct`,
`effectiveMaxFret = maxFret − capo` — so the remap math is untouched, and
both double as algorithm validation via exact-identity round trips (tune
down k half-steps + capo k = original chart; E-standard bass +1 octave =
standard guitar's low four strings note-for-note). Capo re-spells nut labels
to sounding pitch; octave offset doesn't touch labels. Quick per-song
adjustments live in player-controls sliders (v3 `playerControlSlot()` / v2
`#player-controls`) persisting **per tuning id** via a
`tuningAdjustOverrides` blob; saved tuning defaults live in the editor (an
editor save clears that tuning's override). New presets: Ukulele gCEA
(reentrant — second non-monotonic target after banjo5) and Baritone ukulele
DGBE.

## Upstream sync log

Procedure: see PLANNING.md ("Syncing from upstream"). Each entry notes what
this repo's `screen.js` was synced to, so the next sync diffs from there.

- **2026-07-10** — synced to canonical `got-feedBack/feedBack`
  (`highway_3d` `3.31.5`, last commit touching the plugin: `b3215694`; the
  local `jphinspace/feedBack` reference checkout was one commit behind, at
  `14d116d8` / `3.31.4`). One substantive change: Butterchurn canvas-sizing
  fix (`_bcApplySize` helper; drawing buffer stuck at 300×150). Zero patch-
  point overlap — direct merge, verified byte-identical to upstream in that
  region. Plugin version bumped to 0.1.1.
