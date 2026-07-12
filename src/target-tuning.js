// Five-String Everything — target tuning spec resolution & defaulting.
// Pure, no dependency on Three.js or screen.js's closure state. One of
// four modules the fse-retune.js barrel aggregates into the `FSE`
// namespace — see that file for the full picture.
//
// Owns: what a "target tuning" IS (a variable-length, 4-8 string, array of
// open-string MIDI pitches + display labels) and how to derive one from a
// user-supplied note-spec array, including sensible defaults/fallbacks.
// The actual chart-remap MATH (turning a source note into a target
// string/fret) lives in retune-engine.js, which imports the constants
// exported here.

import { parseTargetNote, midiToNoteLabel } from './pitch.js';

// Standard open-string pitches as MIDI note numbers, low string first,
// keyed by source string count — e.g. 4: [28,33,38,43] is 4-string bass
// EADG (28 = E1); 6: [...] is 6-string guitar standard EADGBE (40 = E2).
// Reference point sourceOpenStringMidi (below) applies a chart's own
// tuning offsets/capo to. Same numbers as lib/song.py's _TUNING_BASE_MIDI.
const STANDARD_OPEN_STRING_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

// Target string COUNT is configurable (4-8) — a saved tuning profile can
// add/remove strings from either end (settings.html's Bass Tuning editor).
// BEADG (5-string) remains the built-in default. MAX_TARGET_STRING_COUNT
// mirrors screen.js's MAX_RENDER_STRINGS (PALETTES.default.length there —
// per-string materials/gradients are only allocated up to that count, a
// real structural limit, not an arbitrary choice). MIN_TARGET_STRING_COUNT
// matches highway_3d's own floor.
export const TARGET_MAX_FRET = 20;
export const MAX_TARGET_STRING_COUNT = 8;
export const MIN_TARGET_STRING_COUNT = 4;
export const DEFAULT_TARGET_TUNING = ['B0', 'E1', 'A1', 'D2', 'G2'];
// Extended low-to-high note chain used both as a per-index FALLBACK inside
// resolveTargetTuning when a spec entry fails to parse (corrupt/partial
// custom tuning — covers realistic lengths beyond the 5-string default
// without trying to solve "what's the anchor" for arbitrary data) AND as
// the canonical note chain string-colors.js derives its note->color-role
// table from, so the two stay in sync automatically.
// EXTENDED_CORE_INDEX is the index of 'B0' (DEFAULT_TARGET_TUNING[0]'s
// equivalent), so DEFAULT_TARGET_TUNING[i] === EXTENDED_DEFAULT_TARGET_TUNING[EXTENDED_CORE_INDEX + i].
export const EXTENDED_DEFAULT_TARGET_TUNING = ['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3'];
export const EXTENDED_CORE_INDEX = 2;

// Whether `strings` is a usable tuning-profile note-spec array: the right
// length (MIN_TARGET_STRING_COUNT..MAX_TARGET_STRING_COUNT) and every
// entry a note parseTargetNote accepts. Shared by every save-path
// validator (screen.js's window.fse3dSaveCustomTuning and its own
// storage-read filter) so the bounds/parse rules can't drift between them.
export function isValidTuningStringsArray(strings) {
    if (!Array.isArray(strings) || strings.length < MIN_TARGET_STRING_COUNT || strings.length > MAX_TARGET_STRING_COUNT) return false;
    return strings.every(s => !!parseTargetNote(s));
}

// Resolves a variable-length tuning spec (array of note-name strings, low
// string first, length 4-8) into { midiTuning: number[], labels: string[] }
// of the same length as `spec`. Any string that fails to parse (missing,
// malformed) falls back to a reasonable default for that index — the
// 5-string BEADG default for i<5, else the extended chain — so a
// corrupt/partial custom tuning degrades one string at a time rather than
// breaking the whole render. `spec` itself isn't length-clamped here
// (that's enforced where profiles are created/saved, e.g. screen.js's
// fse3dSaveCustomTuning) — this function just resolves whatever length
// it's given, falling back to the 5-string BEADG default when `spec`
// isn't a usable array at all.
//
// No uniqueness constraint: two (or more) strings resolving to the exact
// same note + octave is allowed (e.g. an intentional unison pair) and
// requires no special handling in retune-engine.js — every remap function
// looks up a string's OWN target pitch independently, it never searches
// for "the" string matching a pitch.
export function resolveTargetTuning(spec) {
    const src = (Array.isArray(spec) && spec.length > 0) ? spec : DEFAULT_TARGET_TUNING;
    const n = src.length;
    const midiTuning = new Array(n);
    const labels = new Array(n);
    for (let i = 0; i < n; i++) {
        const fallbackSpec = i < DEFAULT_TARGET_TUNING.length
            ? DEFAULT_TARGET_TUNING[i]
            : EXTENDED_DEFAULT_TARGET_TUNING[EXTENDED_CORE_INDEX + i];
        const parsed = parseTargetNote(src[i]) || parseTargetNote(fallbackSpec) || parseTargetNote(DEFAULT_TARGET_TUNING[0]);
        midiTuning[i] = parsed.midi;
        labels[i] = parsed.label;
    }
    return { midiTuning, labels };
}

// Fixed BEADG default target — used whenever a caller omits the optional
// `targetMidiTuning` parameter on retune-engine.js's remap functions
// (keeps every existing call site, including test/retune-engine.test.mjs,
// working unchanged) and as the fallback inside resolveTargetTuning.
const DEFAULT_TARGET = resolveTargetTuning(DEFAULT_TARGET_TUNING);
export const DEFAULT_TARGET_MIDI_TUNING = DEFAULT_TARGET.midiTuning;
export const TARGET_OPEN_STRING_LABELS = DEFAULT_TARGET.labels;

// Default note for a newly added string, given the direction ('low'|'high')
// and the CURRENT edge string's own MIDI pitch — pure, stateless (by
// explicit design: a plugin add never remembers a previously-removed
// string's value, it always recomputes fresh from whatever's currently at
// the edge being extended). Low extensions always drop a perfect fourth (5
// half-steps), matching real bass low-string convention (e.g. adding a low
// string back to EADG reproduces BEADG's B0 exactly). High extensions rise
// a major third (4 half-steps) ONLY when extending from exactly the BEADG
// default G2 (43) — matches the standard convention of a high B string
// above G (the same interval guitar's own G->B uses); every other high
// extension (second+ add, or extending a non-default tuning) rises a
// perfect fourth, same as the low direction. Returns { midi, label }.
export function defaultExtensionNote(direction, edgeMidi) {
    const midi = direction === 'low' ? edgeMidi - 5 : (edgeMidi === 43 ? edgeMidi + 4 : edgeMidi + 5);
    return { midi, label: midiToNoteLabel(midi) };
}

// Falls back to the 6-string (guitar) table for a string count not listed
// above.
export function standardOpenStringMidi(stringCount) {
    return STANDARD_OPEN_STRING_MIDI[stringCount] || STANDARD_OPEN_STRING_MIDI[6];
}

// MIDI note number of source string `s`'s open note under the chart's own
// tuning: the standard open pitch plus that string's tuning offset plus
// capo (e.g. standard low E at 28, tuned down 2 half-steps for Drop D,
// = 26 = D1). Constant per song per string — compute once, not per note.
export function sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s) {
    if (!tuningOffsets || !(s >= 0 && s < tuningOffsets.length)) return null;
    const base = standardOpenStringMidi(sourceStringCount);
    const root = s < base.length ? base[s] : base[base.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0);
}

// Every source string's open-note MIDI pitch, indexed by string. Compute
// once per song; computeArrangementShift and retune-engine.js's
// createRetuner() both read this instead of re-deriving each string's
// pitch independently.
export function computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo) {
    const midiByString = [];
    for (let s = 0; s < sourceStringCount; s++) {
        midiByString.push(sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s));
    }
    return midiByString;
}

// The single k (target string = source string + k) that best aligns the
// source string family with the target — most exact matches win, tied by
// smallest total |adjustment|, then smallest |k|. (This is why EADG lands
// on target strings 1-4 while BEAD lands on 0-3, even though both are
// "zero-offset" 4-string tunings — they sit at different absolute
// pitches.) Compute once per song; `sourceOpenMidiByString` is optional,
// pass it when already available.
export function computeArrangementShift(sourceStringCount, tuningOffsets, capo, sourceOpenMidiByString, targetMidiTuning) {
    const midiByString = sourceOpenMidiByString || computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    let bestK = 0, bestExact = -1, bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= target.length - 1; k++) {
        let exact = 0, totalAbs = 0, counted = 0;
        for (let s = 0; s < sourceStringCount; s++) {
            const j = s + k;
            if (j < 0 || j >= target.length) continue;
            const midi = midiByString[s];
            if (midi === null) continue;
            const adjustment = midi - target[j];
            counted++;
            totalAbs += Math.abs(adjustment);
            if (adjustment === 0) exact++;
        }
        if (counted === 0) continue;
        if (exact > bestExact
            || (exact === bestExact && totalAbs < bestTotalAbs)
            || (exact === bestExact && totalAbs === bestTotalAbs && Math.abs(k) < Math.abs(bestK))) {
            bestExact = exact;
            bestTotalAbs = totalAbs;
            bestK = k;
        }
    }
    return bestK;
}
