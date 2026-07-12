// Five-String Everything — target tuning spec resolution & defaulting.
// One of four modules fse-retune.js aggregates into `FSE`. The chart-remap
// math itself lives in retune-engine.js, which imports the constants below.

import { parseTargetNote, midiToNoteLabel } from './pitch.js';

// Standard open-string MIDI pitches, low string first, by string count.
// Same numbers as lib/song.py's _TUNING_BASE_MIDI.
const STANDARD_OPEN_STRING_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

export const TARGET_MAX_FRET = 20;
// 8 = MAX_RENDER_STRINGS in screen.js (per-string material arrays are
// only sized that far). 4 matches highway_3d's own floor.
export const MAX_TARGET_STRING_COUNT = 8;
export const MIN_TARGET_STRING_COUNT = 4;
export const DEFAULT_TARGET_TUNING = ['B0', 'E1', 'A1', 'D2', 'G2'];
// Fallback chain for resolveTargetTuning (entries past index 4) and the
// note->color-role table in string-colors.js. EXTENDED_CORE_INDEX is the
// index of 'B0', so DEFAULT_TARGET_TUNING[i] === EXTENDED_DEFAULT_TARGET_TUNING[EXTENDED_CORE_INDEX + i].
export const EXTENDED_DEFAULT_TARGET_TUNING = ['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3'];
export const EXTENDED_CORE_INDEX = 2;

// Length in [MIN,MAX] and every entry parses. Shared by
// window.fse3dSaveCustomTuning and the storage-read filter in screen.js.
export function isValidTuningStringsArray(strings) {
    if (!Array.isArray(strings) || strings.length < MIN_TARGET_STRING_COUNT || strings.length > MAX_TARGET_STRING_COUNT) return false;
    return strings.every(s => !!parseTargetNote(s));
}

// Resolves a note-spec array (length 4-8) into { midiTuning, labels } of
// the same length. A malformed entry falls back per-index to
// DEFAULT_TARGET_TUNING/EXTENDED_DEFAULT_TARGET_TUNING rather than
// discarding the whole spec. A non-array/empty spec falls back to BEADG.
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

// Built-in BEADG default, used when a caller omits targetMidiTuning.
const DEFAULT_TARGET = resolveTargetTuning(DEFAULT_TARGET_TUNING);
export const DEFAULT_TARGET_MIDI_TUNING = DEFAULT_TARGET.midiTuning;
export const TARGET_OPEN_STRING_LABELS = DEFAULT_TARGET.labels;

// Default note for a newly added string (settings.html's "+ Add" button),
// given direction and the current edge string's MIDI pitch. Stateless —
// always computed fresh, never remembers a removed string's value.
// Low: drops a perfect fourth. High: rises a major third only from
// exactly G2 (43, BEADG's own top string — matches the usual high-B
// extension), otherwise also a perfect fourth.
export function defaultExtensionNote(direction, edgeMidi) {
    const midi = direction === 'low' ? edgeMidi - 5 : (edgeMidi === 43 ? edgeMidi + 4 : edgeMidi + 5);
    return { midi, label: midiToNoteLabel(midi) };
}

export function standardOpenStringMidi(stringCount) {
    return STANDARD_OPEN_STRING_MIDI[stringCount] || STANDARD_OPEN_STRING_MIDI[6];
}

// Source string `s`'s open pitch under the chart's own tuning/capo.
export function sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s) {
    if (!tuningOffsets || !(s >= 0 && s < tuningOffsets.length)) return null;
    const base = standardOpenStringMidi(sourceStringCount);
    const root = s < base.length ? base[s] : base[base.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0);
}

export function computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo) {
    const midiByString = [];
    for (let s = 0; s < sourceStringCount; s++) {
        midiByString.push(sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s));
    }
    return midiByString;
}

// The shift k (target string = source string + k) that best aligns the
// source strings with the target — most exact matches win, ties broken by
// smallest total |adjustment| then smallest |k|. `sourceOpenMidiByString`
// is optional, pass it when already computed.
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
