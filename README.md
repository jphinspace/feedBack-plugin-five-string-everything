# Chart Retuner

A [feedBack](https://github.com/got-feedBack/feedBack) plugin that lets a
bass player play **any** chart, in any source tuning (Drop D, Drop C#,
whatever), by remapping each note to the correct string/fret for a target
tuning of your choice instead of the chart's original tuning. Notes outside
a 20-fret target instrument's range are dropped.

Scope today: bass arrangements only. Guitar (lead/rhythm) support is planned
but not yet implemented — Auto-mode only picks this plugin for arrangements
whose name contains "bass".

## Target tuning

The target tuning — both which pitches and how many strings (4 to 8) — is
fully configurable in the plugin's settings (Bass Tuning section), and can
be switched live, no reload required:

- **EADG (4-string)** — the built-in default, standard bass tuning. Its
  string colors track feedBack's shared "Highway String Colors" setting,
  the same as `highway_3d`.
- **BEADG (5-string)** — a second built-in preset, selectable from the
  Active tuning dropdown but not the default. Same live-tracked colors as
  EADG (plus a dedicated Low B color for the extra low string) — EADG's
  strings are literally BEADG's own E/A/D/G minus the low B, so they share
  the same live mapping.
- **Cello (CGDA, 4-string)** — a third built-in preset, selectable from
  the Active tuning dropdown but not the default and not editable/deletable.
  Fixed per-string colors, unlike EADG/BEADG.
- **Your own saved profiles** — any note/octave per string (AEADG, a
  half-step-flat BbEbAbDbGb, a 6- or 7-string with extra strings on top or
  bottom, anything else). Strings can only be added or removed from the top
  or bottom, never the middle.

Every saved tuning (built-in Cello preset or your own) carries its own
fixed per-string colors, set via a per-string color picker when you create
or edit it — independent of the shared Highway String Colors setting.
Colors stay pinned to string **position**, not note name, so switching
tunings never reshuffles them, and a removed string's color is never
remembered for a later re-add.

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
