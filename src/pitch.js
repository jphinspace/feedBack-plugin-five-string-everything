// Five-String Everything — note-name <-> MIDI pitch conversion.
// Pure, no dependency on any other module or on Three.js/screen.js's
// closure state. One of four modules the fse-retune.js barrel aggregates
// into the `FSE` namespace — see that file for the full picture.

// Pitch class (0=C .. 11=B) for the natural note letters, before applying
// a #/b accidental.
const NOTE_LETTER_PITCH_CLASS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Parses one target-tuning string spec, e.g. "B0", "Bb1", "F#2", "A-1" —
// note letter (A-G, case-insensitive) + optional single #/b accidental +
// signed octave number, scientific pitch notation (C4 = MIDI 60, matching
// lib/song.py's _TUNING_BASE_MIDI convention used elsewhere in this
// module family). Returns { midi, label } (label preserves the input's
// own letter case/accidental spelling, e.g. "Bb" not the enharmonic "A#")
// or null if the spec doesn't parse.
export function parseTargetNote(spec) {
    if (typeof spec !== 'string') return null;
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(spec.trim());
    if (!m) return null;
    const letter = m[1], accidental = m[2], octave = parseInt(m[3], 10);
    let pc = NOTE_LETTER_PITCH_CLASS[letter.toLowerCase()];
    if (accidental === '#') pc += 1;
    else if (accidental === 'b') pc -= 1;
    return { midi: pc + 12 * (octave + 1), label: letter.toUpperCase() + accidental };
}

// Inverse of parseTargetNote's pitch math — MIDI note number -> scientific
// pitch notation, sharp spelling (e.g. "C#0" not "Db0", matching
// target-tuning.js's EXTENDED_DEFAULT_TARGET_TUNING notation).
const PITCH_CLASS_SHARP_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToNoteLabel(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return PITCH_CLASS_SHARP_LABELS[pc] + octave;
}
