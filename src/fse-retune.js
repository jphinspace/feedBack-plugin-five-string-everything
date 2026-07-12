// Five-String Everything — barrel module. Aggregates four focused pure-
// logic modules into the single `FSE` namespace screen.js and the test
// suite import (`import { FSE } from './src/fse-retune.js'`) — external
// consumers and every existing FSE.xxx call site are unchanged by this
// split; only the internal file layout changed (previously all of this
// lived in one ~650-line file with several distinct concerns mixed
// together — notes, tunings, and colors).
//
//   - pitch.js: note-name <-> MIDI conversion (parseTargetNote, midiToNoteLabel).
//   - target-tuning.js: what a target tuning IS and how to resolve/default
//     one (resolveTargetTuning, defaultExtensionNote, computeArrangementShift, ...).
//   - retune-engine.js: the chart-remap MATH — turning a source note into
//     a target string/fret (remapNote, resolveChordCollisions, createRetuner, ...).
//   - string-colors.js: per-string color role + hex handling
//     (colorRoleForNote, resolveColorsArray, lowBColor, ...).
//
// Dependency direction is one-way: pitch.js has none; target-tuning.js and
// string-colors.js both depend on pitch.js; retune-engine.js depends on
// target-tuning.js; string-colors.js also depends on target-tuning.js (its
// note->color-role table is derived from EXTENDED_DEFAULT_TARGET_TUNING
// rather than duplicating those MIDI values). No module depends back on
// this barrel or on any of Three.js/screen.js's closure state.
//
// Loaded as a real ES module (plugin.json "scriptType":"module", served
// via feedBack core's /api/plugins/<id>/src/... route) — imported by both
// screen.js (browser) and test/retune-engine.test.mjs (Node), so there's
// exactly one copy of this logic (across the four files above).

import * as Pitch from './pitch.js';
import * as TargetTuning from './target-tuning.js';
import * as RetuneEngine from './retune-engine.js';
import * as StringColors from './string-colors.js';

export const FSE = {
    ...Pitch,
    ...TargetTuning,
    ...RetuneEngine,
    ...StringColors,
};
