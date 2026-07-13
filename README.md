# Chart Retuner

A [feedBack](https://github.com/got-feedBack/feedBack) plugin that lets a
bass or guitar player play **any** chart, in any source tuning (Drop D,
Drop C#, whatever), by remapping each note to the correct string/fret for
a target tuning of your choice instead of the chart's original tuning.
Notes outside a 20-fret target instrument's range are dropped.

Scope: bass, lead, and rhythm arrangements (Auto-mode matches the same
lead/rhythm/bass/combo/guitar arrangement names `highway_3d` does; Keys
belongs to the piano plugin).

## Target tunings

Each arrangement class has its own tuning profile, configurable in the
plugin's settings (Target Tunings section) and switchable at any time —
even mid-song:

- **Bass arrangements** default to **EADG** (standard 4-string bass).
- **Lead** and **Rhythm/other guitar** arrangements default to **EADGBE**
  (standard 6-string guitar). "Combo" and plain "Guitar" arrangements use
  the Rhythm profile.

All three profiles pick from the same pool of tunings — any pitches, 4 to
8 strings — so a guitarist can keep one tuning for rhythm charts and
another for lead, and nothing stops you from pointing a guitar profile at
a bass tuning or vice versa:

- **EADG (4-string)** — standard bass, the bass default. Its string colors
  track feedBack's shared "Highway String Colors" setting, the same as
  `highway_3d`.
- **BEADG (5-string)** — built-in preset. Same live-tracked colors as
  EADG (plus a dedicated Low B color for the extra low string) — EADG's
  strings are literally BEADG's own E/A/D/G minus the low B, so they share
  the same live mapping.
- **EADGBE (6-string)** — standard guitar, the lead/rhythm default. Also
  live-tracks the shared string colors (the same slots `highway_3d` gives
  a 6-string guitar chart).
- **BEADGBE (7-string)** — standard 7-string guitar. Live-tracked like
  EADGBE; the extra low string uses the dedicated Low B color.
- **Baritone (BEADF#B, 6-string)** — baritone guitar, standard tuning
  down a perfect fourth. Live-tracked, colors position-parallel to
  EADGBE (each string keeps the slot its position has on a standard
  guitar).
- **Upright bass solo (F#BEA, 4-string)** — double-bass solo tuning,
  standard bass up a whole step. Live-tracked, colors position-parallel
  to EADG.
- **Cello (CGDA, 4-string)** — built-in preset, not editable/deletable.
  Fixed per-string colors, unlike the live-tracked presets.
- **Viola (CGDA, 4-string)** — the cello's notes an octave up, same
  fixed colors.
- **Violin (GDAE, 4-string)** — fifths tuning, an octave-and-change above
  the cello. Fixed per-string colors sharing Cello's G/D/A hues.
- **Banjo 4-string (CGBD)** — plectrum banjo. Fixed colors in the same
  note-parallel family.
- **Banjo 5-string (gDGBD)** — open G. String 1 is the **high G4 drone**
  (banjo tab convention puts the 5th string on the bottom line); note the
  drone string's short neck isn't modeled, so remaps may occasionally
  place low fretted notes on that lane.
- **Mandolin (GGDDAAEE, 8-string)** — four paired courses at the
  plugin's 8-string maximum, one fixed color per course pair.
- **Your own saved custom profiles** — any note/octave per string (AEADG, a
  half-step-flat BbEbAbDbGb, a 6- or 7-string with extra strings on top or
  bottom, anything else).

Every saved tuning carries its own
fixed per-string colors, set via a per-string color picker when you create
or edit it, independent of the shared Highway String Colors setting.
Colors stay pinned to string **position**, not note name, so switching
tunings never reshuffles them, and a removed string's color is never
remembered for a later re-add.

## Chords

Single notes always keep their exact sounding pitch (or drop when the
target instrument can't reach them). Chords get smarter treatment,
because open and barre shapes don't map note-for-note across tunings.
When the exact note-for-note mapping of a chord is playable, it's used
as-is; when it isn't, the chord is **revoiced** on the target tuning —
same chord (same notes-of-the-chord, octaves may shuffle) — following
these priorities, in order:

1. **Playable** — no stretches wider than a 4-fret box (unless the
   original chart chord stretched further) and never more than 4 fretting
   fingers, barres included.
2. **Comparable hand shape** — open-position chords stay open-ish and the
   hand stays near the original fret position; a barre is never
   introduced where the chart had none if a better option exists.
3. **Root in the bass** — preferred, but an inversion or a simplified
   voicing wins when it fits priorities 1-2 better.

When no full voicing fits, the chord simplifies progressively (drop
doubled notes → triad → power chord → single root note) rather than
disappearing. Chord diagrams and hand-shape highlights follow the
remapped voicing; the chord *name* still shows the chart's original
label. Note that scoring (note_detect) keys off the original chart
positions, so judgments follow the chart, not the remapped shape.

## Fork of `highway_3d` — manual sync required

This plugin is a fork of the bundled
[`highway_3d`](https://github.com/got-feedBack/feedBack/tree/main/plugins/highway_3d)
plugin — same 3D highway, same settings, same everything, except note gems
(and the hand-position highlight, and chord shapes) land on the remapped
string/fret. It runs alongside `highway_3d` without modifying it; **`highway_3d`
must stay installed** — this plugin depends on it for shared features
(Highway String Colors) and reuses its whole rendering engine as a base.

Because it's a fork rather than a hook into the original, this repo carries
its **own independent copy** of `screen.js`, forked from and patched against
[`highway_3d/screen.js`](https://github.com/got-feedBack/feedBack/blob/main/plugins/highway_3d/screen.js).
It does **not** automatically pick up upstream fixes/features — that copy
has to be **manually re-synced** whenever the upstream file changes. See
[Syncing from upstream](#syncing-from-upstream-highway_3d) below for the
procedure, and [`PLANNING.md`](PLANNING.md) for the full design writeup —
the algorithm, every patch point against `highway_3d`, and why each one
exists.

## Install

**Option A — feedback-desktop plugin manager:** add this repo's URL
(`https://github.com/jphinspace/feedBack-plugin-chart-retuner.git`) in the
plugin manager. It installs under the repo name verbatim.

**Option B — manual copy:** clone or copy this repo's contents into your
feedBack install's `plugins/` directory, e.g.:

```sh
git clone https://github.com/jphinspace/feedBack-plugin-chart-retuner.git /path/to/feedBack/plugins/feedBack-plugin-chart-retuner
```

Restart feedBack (or reload plugins) after installing.

After installing, `highway_3d` may continue to be selected by default for
bass arrangements. You may need to select `Chart Retuner` manually from the
viz picker.

## Build

No build step for `screen.js` itself — it's plain JS, no bundler. The
Tailwind stylesheet (`assets/plugin.css`) is prebuilt and committed; only
regenerate it if you add Tailwind classes to `screen.js`/`settings.html`:

```sh
bash build-tailwind.sh
```

**Tests** (the string/fret remap engine only — pure functions, no browser/DOM):

```sh
node test/retune-engine.test.mjs
```

### Syncing from upstream `highway_3d`

This fork needs to periodically pull fixes from the canonical `highway_3d`
plugin rather than silently drifting. Short version:

1. Shallow-clone `https://github.com/got-feedBack/feedBack` somewhere
   scratch (never point this repo's own remotes at it).
2. Diff its `plugins/highway_3d/screen.js` against the version this
   plugin was last synced to (noted in `PLANNING.md`'s sync-log entries).
3. For each changed hunk, find the same surrounding code in this repo's
   `screen.js` (by content, not line number — we've diverged) and reapply
   it — *unless* it touches one of our patch points (search `PLANNING.md`
   for "patch point"), in which case reconcile by hand instead of copying
   blindly.
4. Re-run the test suite and diff this repo's `screen.js` against the fresh
   upstream copy — every remaining hunk should trace to a documented patch
   point.

Full procedure and the current sync log: `PLANNING.md`, Phase 8.

## License

AGPL-3.0-only, same as feedBack and the plugin this is forked from. Third-party
components (Butterchurn) are noted in [`NOTICE`](NOTICE).
