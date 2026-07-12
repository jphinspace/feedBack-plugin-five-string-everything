// Five-String Everything — barrel module. Aggregates four pure-logic
// modules into the `FSE` namespace screen.js and the test suite import.
//
//   - pitch.js: note-name <-> MIDI
//   - target-tuning.js: target tuning resolution/defaulting
//   - retune-engine.js: chart remap math
//   - string-colors.js: per-string color roles + hex handling
//
// Served via feedBack core's /api/plugins/<id>/src/... route
// (plugin.json "scriptType":"module"); imported by both screen.js and
// test/retune-engine.test.mjs.

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
