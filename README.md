# Five-String Everything

A [feedBack](https://github.com/got-feedBack/feedBack) plugin that lets a
5-string BEADG bass play **any** bass chart, in any source tuning (Drop D,
Drop C#, whatever), by remapping each note to the correct string/fret for a
fixed BEADG target instead of the chart's original tuning. Notes outside a
20-fret BEADG bass's range are dropped.

It's a fork of the bundled [`highway_3d`](https://github.com/got-feedBack/feedBack/tree/main/plugins/highway_3d)
plugin — same 3D highway, same settings, same everything, except note gems
(and the hand-position highlight, and chord shapes) land on the remapped
string/fret. It runs alongside `highway_3d` without modifying it; **`highway_3d`
must stay installed** — this plugin depends on it for shared features
(Highway String Colors) and reuses its whole rendering engine as a base.

MVP scope: bass arrangements only, fixed BEADG target (no tuning picker yet).

See [`PLANNING.md`](PLANNING.md) for the full design writeup — the algorithm,
every patch point against `highway_3d`, and why each one exists.

## Install

**Option A — feedback-desktop plugin manager:** add this repo's URL
(`https://github.com/<you>/feedBack-plugin-five-string-everything.git`) in the
plugin manager. It installs under the repo name verbatim.

**Option B — manual copy:** clone or copy this repo's contents into your
feedBack install's `plugins/` directory, e.g.:

```sh
git clone <this-repo-url> /path/to/feedBack/plugins/feedBack-plugin-five-string-everything
```

Restart feedBack (or reload plugins) after installing.

After installing, `highway_3d` may continue to be selected by default for bass
arrangements. You may need to select `five string everything` manually.

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

**Syncing from upstream `highway_3d`:** this fork needs to periodically pull
fixes from the canonical `highway_3d` plugin rather than silently drifting.
Short version:

1. Shallow-clone `https://github.com/got-feedBack/feedBack` somewhere
   scratch (never point this repo's own remotes at it).
2. Diff its `plugins/highway_3d/` against the version this plugin was last
   synced to (noted in `PLANNING.md`'s sync-log entries).
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
