// Standalone Node verification for the string/fret offset transformation
// engine. Imports the real engine from ../src/chart-retune.js — no
// hand-synced duplicate. Run with `node test/retune-engine.test.mjs`.
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const {
    DEFAULT_MAX_FRET,
    MAX_FRET_OPTIONS,
    isValidMaxFret,
    isValidCapo,
    resolveCapo,
    MIN_OCTAVE_OFFSET,
    MAX_OCTAVE_OFFSET,
    isValidOctaveOffset,
    resolveOctaveOffset,
    effectiveTargetMidiTuning,
    effectiveMaxFret,
    MAX_TARGET_STRING_COUNT,
    MIN_TARGET_STRING_COUNT,
    MIN_TARGET_MIDI,
    MAX_TARGET_MIDI,
    DEFAULT_TARGET_MIDI_TUNING,
    DEFAULT_TARGET_TUNING,
    EXTENDED_DEFAULT_TARGET_TUNING,
    parseTargetNote,
    midiToNoteLabel,
    defaultExtensionNote,
    colorRoleForNote,
    BEADG_COLOR_ROLES,
    isValidTuningStringsArray,
    BUILTIN_PRESET_TUNINGS,
    DEFAULT_TUNING_ID,
    DEFAULT_GUITAR_TUNING_ID,
    defaultTuningIdForClass,
    arrangementClassFor,
    resolveActiveTuning,
    resolveTargetTuning,
    computeOpenStringMidiByString,
    computeArrangementShift,
    resolveTargetForFret,
    remapNote,
    remapSlide,
    resolveChordCollisions,
    remapAnchors,
    remapChordTemplate,
    remapChordTemplates,
    intToHex,
    LIGHT_GRAY_COLOR,
    resolveColorsArray,
} = CR;

let passed = 0;
function check(label, actual, expected) {
    assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    passed++;
}

// Mirrors what createRetuner().apply() does once per song: compute k, then
// per-string open-note MIDI pitches and natural targets.
function songContext(sourceStringCount, tuning, capo, targetMidiTuning) {
    const sourceOpenMidiByString = computeOpenStringMidiByString(sourceStringCount, tuning, capo);
    const k = computeArrangementShift(sourceStringCount, tuning, capo, sourceOpenMidiByString, targetMidiTuning);
    const naturalTargetByString = [];
    for (let s = 0; s < sourceStringCount; s++) {
        naturalTargetByString.push(s + k);
    }
    return { k, sourceOpenMidiByString, naturalTargetByString };
}

// Spot-check frets rather than looping 0-20: resolveTargetForFret only
// branches at the 0/20 boundaries, so once a string's adjustment is
// constant these three points give the same confidence as all 21 would.
const SPOT_FRETS = [0, 10, 20];

// Drop-D, full chart. tuning = [-2,0,0,0], capo = 0.
{
    const ctx = songContext(4, [-2, 0, 0, 0], 0);
    check('Drop-D arrangement shift', ctx.k, 1);
    for (const f of SPOT_FRETS) {
        check(`Drop-D A string f=${f}`, remapNote(ctx.sourceOpenMidiByString[1], ctx.naturalTargetByString[1], f), { s: 2, f });
        check(`Drop-D D string f=${f}`, remapNote(ctx.sourceOpenMidiByString[2], ctx.naturalTargetByString[2], f), { s: 3, f });
        check(`Drop-D G string f=${f}`, remapNote(ctx.sourceOpenMidiByString[3], ctx.naturalTargetByString[3], f), { s: 4, f });
    }
    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    check('Drop-D dropped string f=0 (D open)', remapNote(midi0, nat0, 0), { s: 0, f: 3 });
    check('Drop-D dropped string f=1 (Eb, original example)', remapNote(midi0, nat0, 1), { s: 0, f: 4 });
    check('Drop-D dropped string f=2 (E, crossover)', remapNote(midi0, nat0, 2), { s: 1, f: 0 });
    for (const f of [10, 20]) {
        check(`Drop-D dropped string f=${f}`, remapNote(midi0, nat0, f), { s: 1, f: f - 2 });
    }
}

// Drop C#: open strings low-to-high C#, G#, C#, F# (tuning = [-3,-1,-1,-1]).
// Every string carries a nonzero adjustment, so every string cascades near
// the bottom of its range before settling on its own natural target.
{
    const ctx = songContext(4, [-3, -1, -1, -1], 0);
    check('Drop-C# arrangement shift', ctx.k, 1);

    const [midi0, midi1, midi2, midi3] = ctx.sourceOpenMidiByString;
    const [nat0, nat1, nat2, nat3] = ctx.naturalTargetByString;

    check('Drop-C# string0 f=0 (C#) cascades to B', remapNote(midi0, nat0, 0), { s: 0, f: 2 });
    check('Drop-C# string0 f=1 (D) cascades to B', remapNote(midi0, nat0, 1), { s: 0, f: 3 });
    check('Drop-C# string0 f=2 (Eb) cascades to B', remapNote(midi0, nat0, 2), { s: 0, f: 4 });
    check('Drop-C# string0 f=3 (E, crossover onto natural E target)', remapNote(midi0, nat0, 3), { s: 1, f: 0 });
    for (const f of [10, 20]) {
        check(`Drop-C# string0 f=${f} stays on its natural (E) target`, remapNote(midi0, nat0, f), { s: 1, f: f - 3 });
    }

    check('Drop-C# string1 f=0 (G#) cascades to E', remapNote(midi1, nat1, 0), { s: 1, f: 4 });
    check('Drop-C# string1 f=1 (A, crossover onto natural A target)', remapNote(midi1, nat1, 1), { s: 2, f: 0 });
    for (const f of [10, 20]) {
        check(`Drop-C# string1 f=${f} stays on its natural (A) target`, remapNote(midi1, nat1, f), { s: 2, f: f - 1 });
    }

    check('Drop-C# string2 f=0 (C#) cascades to A', remapNote(midi2, nat2, 0), { s: 2, f: 4 });
    check('Drop-C# string2 f=1 (D, crossover onto natural D target)', remapNote(midi2, nat2, 1), { s: 3, f: 0 });
    for (const f of [10, 20]) {
        check(`Drop-C# string2 f=${f} stays on its natural (D) target`, remapNote(midi2, nat2, f), { s: 3, f: f - 1 });
    }

    check('Drop-C# string3 f=0 (F#) cascades to D', remapNote(midi3, nat3, 0), { s: 3, f: 4 });
    check('Drop-C# string3 f=1 (G, crossover onto natural G target)', remapNote(midi3, nat3, 1), { s: 4, f: 0 });
    for (const f of [10, 20]) {
        check(`Drop-C# string3 f=${f} stays on its natural (G) target`, remapNote(midi3, nat3, f), { s: 4, f: f - 1 });
    }
}

// EADG identity: every note shifts string index +1, fret unchanged.
{
    const ctx = songContext(4, [0, 0, 0, 0], 0);
    check('EADG arrangement shift', ctx.k, 1);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            check(`EADG identity s=${s} f=${f}`, remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s: s + 1, f });
        }
    }
}

// BEAD identity: completely unchanged.
{
    const ctx = songContext(4, [-5, -5, -5, -5], 0);
    check('BEAD arrangement shift', ctx.k, 0);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            check(`BEAD identity s=${s} f=${f}`, remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s, f });
        }
    }
}

// Already-BEADG identity.
{
    const ctx = songContext(5, [0, 0, 0, 0, 0], 0);
    check('Already-BEADG arrangement shift', ctx.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            check(`Already-BEADG identity s=${s} f=${f}`, remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s, f });
        }
    }
}

// Out-of-range drop.
{
    check('below open B drops', remapNote(22, 0, 0), null);
    check('above fret 20 on G drops', remapNote(43, 4, 21), null);
}

// Non-monotonic targets (banjo5_gdgbd puts the HIGH G4 drone at index 0):
// the walk moves in PITCH order, not index order, so overflow reaches the
// drone string, and the direction lock guarantees termination (review
// findings: wrongly-dropped notes on the banjo preset; a pre-existing
// infinite loop when two pitch-adjacent strings sit >20 semitones apart).
{
    const banjo5 = resolveTargetTuning(['G4', 'D3', 'G3', 'B3', 'D4']).midiTuning;
    check('banjo5 target midi (drone-first, non-monotonic)', banjo5, [67, 50, 55, 59, 62]);
    check('overflow past the top fretted string walks to the HIGH drone at index 0',
        resolveTargetForFret(75, 1, 8, banjo5), { s: 0, f: 16, adjustment: 8 });

    // Completeness sweep: a standard-guitar chart remapped onto banjo5
    // must never drop a note that SOME banjo string could play, and every
    // kept note must sound its exact source pitch.
    const src = computeOpenStringMidiByString(6, [0, 0, 0, 0, 0, 0], 0);
    const k = computeArrangementShift(6, [0, 0, 0, 0, 0, 0], 0, src, banjo5);
    let wronglyDropped = 0, pitchErrors = 0;
    for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= 20; f++) {
            const r = remapNote(src[s], s + k, f, banjo5);
            const fits = banjo5.some(open => { const tf = f + (src[s] - open); return tf >= 0 && tf <= 20; });
            if (fits && !r) wronglyDropped++;
            if (r && banjo5[r.s] + r.f !== src[s] + f) pitchErrors++;
        }
    }
    check('banjo5 completeness: zero wrongly-dropped notes across a full guitar chart sweep', wronglyDropped, 0);
    check('banjo5 completeness: every kept note sounds its exact source pitch', pitchErrors, 0);

    // The former infinite-loop input (strings 35 and 62 are pitch-adjacent
    // in this non-monotonic target, 27 semitones apart): the pitch walk
    // now FINDS the legitimate placement the index walk oscillated past.
    check('pitch-adjacent >20-semitone gap: resolves instead of hanging',
        resolveTargetForFret(45, 1, 15, [40, 35, 62, 55, 59, 64]), { s: 0, f: 20, adjustment: 5 });
    // And when nothing fits anywhere, the direction lock returns null
    // (this monotonic huge-gap case also looped forever before).
    check('monotonic >20-semitone adjacent gap with no fit terminates with null',
        resolveTargetForFret(50, 0, 5, [28, 60, 65, 70]), null);
}

// Slide notes.
{
    const midi = 28, natural = 1;
    const lowToHigh = remapSlide(midi, natural, 18, 25);
    check('low-to-high slide anchors on lower fret, clamps far end', lowToHigh, { s: 1, f: 18, slideTo: 20 });
    const highToLow = remapSlide(midi, natural, 25, 18);
    check('high-to-low slide anchors on the (lower) destination fret', highToLow, { s: 1, f: 20, slideTo: 18 });
}

// Chord collision: two source strings sharing open-string MIDI 33 and
// natural target 2 both resolve to target string 2; lower pitch survives.
{
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const noteA = { s: 0, f: 5 };
    const noteB = { s: 1, f: 2 };
    const noteC = { s: 2, f: 0 };
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, [noteA, noteB, noteC]);
    const bySourceString = new Map(survivors.map(x => [x.note.s, x]));

    check('expected 2 survivors', survivors.length, 2);
    check('colliding higher-pitched note (source string 0) should be dropped', bySourceString.has(0), false);
    check('colliding lower-pitched note (source string 1) keeps its own remap',
        bySourceString.get(1).entry, { s: 2, f: 2 });
    check('non-colliding note (source string 2) is untouched',
        bySourceString.get(2).entry, { s: 3, f: 0 });
}

// Anchor remapping. Open-string notes are excluded as donors.
{
    const remappedNotes = [
        { t: 0, f: 4, _origNote: { t: 0, f: 1 } },
        { t: 1, f: 5, _origNote: { t: 1, f: 7 } },
    ];
    const anchors = [
        { time: 0, fret: 1, width: 4 },
        { time: 1, fret: 7, width: 4 },
        { time: 5, fret: 10, width: 4 },
    ];
    const remapped = remapAnchors(anchors, remappedNotes);
    check('anchor aligned with a low-note-shift note', remapped[0], { time: 0, fret: 4, width: 4 });
    check('anchor aligned with a natural-target-shift note', remapped[1], { time: 1, fret: 5, width: 4 });
    check('anchor after the last note falls back to its shift', remapped[2], { time: 5, fret: 8, width: 4 });

    const clampLow = remapAnchors([{ time: 0, fret: 0, width: 4 }], [{ t: 0, f: 0, _origNote: { t: 0, f: 3 } }]);
    check('anchor clamps at fret 0', clampLow[0], { time: 0, fret: 0, width: 4 });
    const clampHigh = remapAnchors([{ time: 0, fret: DEFAULT_MAX_FRET - 1, width: 4 }], [{ t: 0, f: DEFAULT_MAX_FRET, _origNote: { t: 0, f: 0 } }]);
    check('anchor clamps at fret 20', clampHigh[0], { time: 0, fret: DEFAULT_MAX_FRET, width: 4 });

    const passthrough = remapAnchors([{ time: 0, fret: 5, width: 4 }], []);
    check('anchor passes through unchanged with no surviving notes', passthrough[0], { time: 0, fret: 5, width: 4 });

    const openDonorNotes = [
        { t: 0, f: 3, _origNote: { t: 0, f: 4 } },
        { t: 1, f: 4, _origNote: { t: 1, f: 0 } },
        { t: 2, f: 6, _origNote: { t: 2, f: 7 } },
    ];
    const openDonorAnchors = [
        { time: 0, fret: 3, width: 4 },
        { time: 1, fret: 8, width: 4 },
    ];
    const remappedOpenDonor = remapAnchors(openDonorAnchors, openDonorNotes);
    check('anchor before open-string note uses fretted-note adjustment', remappedOpenDonor[0], { time: 0, fret: 2, width: 4 });
    check('anchor aligned with open-string note skips it for the next fretted donor', remappedOpenDonor[1], { time: 1, fret: 7, width: 4 });
}

// Collision resolution for simultaneous notes NOT wrapped in a Chord
// object — grouped by onset time and run through resolveChordCollisions
// the same as a real chord's .notes array.
{
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const noteA = { t: 5, s: 0, f: 5 };
    const noteB = { t: 5, s: 1, f: 2 };
    const noteC = { t: 5, s: 2, f: 0 };
    const noteD = { t: 6, s: 2, f: 3 };

    const byTime = new Map();
    for (const n of [noteA, noteB, noteC, noteD]) {
        let bucket = byTime.get(n.t);
        if (!bucket) byTime.set(n.t, bucket = []);
        bucket.push(n);
    }
    const remapped = [];
    for (const bucket of byTime.values()) {
        for (const { entry, note } of resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, bucket)) {
            remapped.push({ t: note.t, s: entry.s, f: entry.f, origS: note.s });
        }
    }
    remapped.sort((a, b) => a.t - b.t);

    check('flat-notes collision: only 3 of 4 notes survive', remapped.length, 3);
    const atT5 = remapped.filter(n => n.t === 5);
    const atT6 = remapped.filter(n => n.t === 6);
    check('flat-notes collision: exactly 2 of the 3 same-instant notes survive', atT5.length, 2);
    check('colliding higher-pitched flat note (source string 0) should be dropped', atT5.some(n => n.origS === 0), false);
    check('flat-notes collision: lower-pitched note keeps its own remap',
        atT5.find(n => n.origS === 1), { t: 5, s: 2, f: 2, origS: 1 });
    check('flat-notes collision: non-colliding same-instant note is untouched',
        atT5.find(n => n.origS === 2), { t: 5, s: 3, f: 0, origS: 2 });
    check('flat-notes collision: a different-instant singleton is unaffected',
        atT6[0], { t: 6, s: 3, f: 3, origS: 2 });
}

// Chord template remapping — real-world case: Black Veil Brides "In the
// End", Drop C# tuning, no real Chord objects, chord synthesized from a
// hand-shape + this template's raw frets.
{
    const ctx = songContext(4, [-3, -1, -1, -1], 0);
    const template = { name: '', displayName: '', frets: [6, 7, -1, -1, -1, -1], fingers: [1, 2, -1, -1, -1, -1] };
    const remapped = remapChordTemplate(ctx.sourceOpenMidiByString, ctx.naturalTargetByString, template);
    check('real-chart chord template: fret array remapped to target indices', remapped.frets, [-1, 3, 6, -1, -1]);
    check('real-chart chord template: fingers relocate to the same new indices', remapped.fingers, [-1, 1, 2, -1, -1]);
    check('real-chart chord template: name/displayName pass through unchanged', {
        name: remapped.name, displayName: remapped.displayName,
    }, { name: '', displayName: '' });

    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    check('template stays consistent with the real note it was authored from',
        remapNote(midi0, nat0, 6), { s: remapped.frets.indexOf(3), f: 3 });
}

// Collision within a single template.
{
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const template = { frets: [5, 2, 0, -1], fingers: null };
    const remapped = remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template);
    check('colliding template slots: only the lower-pitched survivor is kept', remapped.frets, [-1, -1, 2, 0, -1]);
    check('colliding template with no fingers array passes fingers through as-is', remapped.fingers, null);
}

// Array wrapper preserves chord_id indexing.
{
    const ctx = songContext(4, [0, 0, 0, 0], 0); // EADG identity
    const templates = [
        { frets: [0, -1, -1, -1], fingers: null },
        { frets: [-1, 2, -1, -1], fingers: null },
    ];
    const remapped = remapChordTemplates(ctx.sourceOpenMidiByString, ctx.naturalTargetByString, templates);
    check('remapChordTemplates keeps the array length/order (id indexing)', remapped.length, 2);
    check('remapChordTemplates id 0 shifted per EADG identity (string+1, fret unchanged)', remapped[0].frets, [-1, 0, -1, -1, -1]);
    check('remapChordTemplates id 1 shifted per EADG identity (string+1, fret unchanged)', remapped[1].frets, [-1, -1, 2, -1, -1]);
}

// Custom target tuning: parseTargetNote / resolveTargetTuning.
{
    check('parseTargetNote: natural note + octave 0', parseTargetNote('B0'), { midi: 23, label: 'B' });
    check('parseTargetNote: sharp, lowercase letter', parseTargetNote('f#2'), { midi: 42, label: 'F#' });
    check('parseTargetNote: flat', parseTargetNote('Bb1'), { midi: 34, label: 'Bb' });
    check('parseTargetNote: negative octave', parseTargetNote('A-1'), { midi: 9, label: 'A' });
    check('parseTargetNote: rejects garbage', parseTargetNote('H0'), null);
    check('parseTargetNote: rejects missing octave', parseTargetNote('B'), null);
    check('parseTargetNote: rejects non-string', parseTargetNote(undefined), null);

    const beadg = resolveTargetTuning(DEFAULT_TARGET_TUNING);
    check('resolveTargetTuning(BEADG) midi matches DEFAULT_TARGET_MIDI_TUNING (the engine\'s BEADG-shaped fallback)', beadg.midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    check('resolveTargetTuning(BEADG) labels', beadg.labels, ['B', 'E', 'A', 'D', 'G']);

    const partial = resolveTargetTuning(['B0', 'garbage', 'A1', 'D2', 'G2']);
    check('resolveTargetTuning: malformed string falls back to BEADG default for that slot only',
        partial.midiTuning, [23, 28, 33, 38, 43]);

    check('resolveTargetTuning: non-array spec falls back to full BEADG default',
        resolveTargetTuning(null).midiTuning, DEFAULT_TARGET_MIDI_TUNING);

    // resolveTargetTuning honors the spec's own length, no padding.
    const short = resolveTargetTuning(['A0', 'F1']);
    check('resolveTargetTuning: honors a shorter-than-5 spec length exactly',
        short.midiTuning, [21, 29]);
    check('resolveTargetTuning: short array labels', short.labels, ['A', 'F']);

    // A malformed entry past index 4 falls back to EXTENDED_DEFAULT_TARGET_TUNING.
    const long = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'garbage']);
    check('resolveTargetTuning: malformed entry past the BEADG core falls back to the extended chain (B2)',
        long.midiTuning, [23, 28, 33, 38, 43, 47]);
    check('resolveTargetTuning: extended-chain fallback label', long.labels[5], 'B');
}

// AEADG target, EADG source: proves the explicit targetMidiTuning
// parameter is actually honored (not silently defaulting to BEADG).
// AEADG's indices 1-4 are numerically identical to BEADG's, and a 4-string
// EADG source never reaches index 0, so a full fret sweep here would just
// re-run the EADG-identity block above against different-but-equal data —
// one spot check is enough to prove the parameter takes effect.
{
    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    check('AEADG target labels', aeadg.labels, ['A', 'E', 'A', 'D', 'G']);
    const ctx = songContext(4, [0, 0, 0, 0], 0, aeadg.midiTuning);
    check('AEADG target, EADG source arrangement shift', ctx.k, 1);
    check('AEADG target EADG source spot check',
        remapNote(ctx.sourceOpenMidiByString[0], ctx.naturalTargetByString[0], 5, aeadg.midiTuning), { s: 1, f: 5 });

    // A 5-string source already tuned AEADG is a full identity remap —
    // this DOES exercise index 0 (A0), unlike the EADG-source case above.
    const ctx5 = songContext(5, [-2, 0, 0, 0, 0], 0, aeadg.midiTuning);
    check('AEADG identity arrangement shift', ctx5.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            check(`AEADG identity s=${s} f=${f}`,
                remapNote(ctx5.sourceOpenMidiByString[s], ctx5.naturalTargetByString[s], f, aeadg.midiTuning), { s, f });
        }
    }
}

// BbEbAbDbGb target — a half-step-flat identity remap.
{
    const flat = resolveTargetTuning(['Bb0', 'Eb1', 'Ab1', 'Db2', 'Gb2']);
    check('BbEbAbDbGb target midi', flat.midiTuning, [22, 27, 32, 37, 42]);
    check('BbEbAbDbGb target labels', flat.labels, ['Bb', 'Eb', 'Ab', 'Db', 'Gb']);
    const ctx = songContext(5, [-1, -1, -1, -1, -1], 0, flat.midiTuning);
    check('BbEbAbDbGb identity arrangement shift', ctx.k, 0);
    for (let s = 0; s < 5; s++) {
        for (const f of SPOT_FRETS) {
            check(`BbEbAbDbGb identity s=${s} f=${f}`,
                remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, flat.midiTuning), { s, f });
        }
    }

    const sourceOpenMidiByString = [32, 32, 37];
    const naturalTargetByString = [2, 2, 3];
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString,
        [{ s: 0, f: 5 }, { s: 1, f: 2 }, { s: 2, f: 0 }], flat.midiTuning);
    check('custom-target chord collision: 2 of 3 notes survive', survivors.length, 2);
    check('custom-target chord collision: lower-pitched note wins the shared slot',
        survivors.find(x => x.note.s === 1).entry, { s: 2, f: 2 });
}

// createRetuner().apply() end-to-end, including cache invalidation when
// the active target tuning changes.
{
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const rawChords = [], rawAnchors = [], rawTemplates = [];
    const bundle = {
        notes: rawNotes,
        chords: rawChords,
        anchors: rawAnchors,
        chordTemplates: rawTemplates,
        tuning: [0, 0, 0, 0, 0],
        capo: 0,
        stringCount: 5,
    };
    retuner.apply(bundle);
    check('createRetuner default target: identity remap of the open low string', { s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });
    const beforeAeadg = bundle.notes[0];

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes; // simulate core re-supplying the raw array next frame
    retuner.apply(bundle, aeadg.midiTuning);
    check('createRetuner: changing target tuning invalidates the cache and re-remaps', bundle.notes[0].f, 2);
    // assert.notStrictEqual, not check(): this asserts reference INEQUALITY
    // (a new object, not merely an equal one), which check()'s deepStrictEqual can't express.
    assert.notStrictEqual(bundle.notes[0], beforeAeadg, 'a target-tuning change must not reuse the previous remap object'); passed++;

    bundle.notes = rawNotes;
    retuner.apply(bundle);
    check('createRetuner: switching back to the default target re-remaps correctly', bundle.notes[0].f, 0);
}

// Switching tuning mid-playthrough must re-add a note previously dropped
// as unplayable, if now in range under the new target.
{
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [-2, 0, 0, 0, 0], capo: 0, stringCount: 5,
    };

    retuner.apply(bundle);
    check('un-drop test: open low A is unplayable on the BEADG target and gets dropped', bundle.notes.length, 0);

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes;
    retuner.apply(bundle, aeadg.midiTuning);
    check('un-drop test: switching to the AEADG target re-adds the note, no longer dropped', bundle.notes.length, 1);
    check('un-drop test: re-added note is an exact identity match', { s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });

    bundle.notes = rawNotes;
    retuner.apply(bundle);
    check('un-drop test: switching back to BEADG drops the note again', bundle.notes.length, 0);
}

// maxFret: per-tuning-profile ceiling (HISTORY.md Phase 15 — replaces the old
// blanket hardcoded 20). Every engine entry point defaults to
// DEFAULT_MAX_FRET (20, exercised throughout this file already); these
// cases pin the actual widening/narrowing behavior a non-default value
// produces.
{
    // Single-string target at exactly the source's open pitch (adjustment
    // 0), so the target fret always equals the source fret — isolates the
    // ceiling check from any natural-string/adjustment interaction.
    const oneString = [40];
    check('resolveTargetForFret: a fret past 20 drops at the default ceiling',
        resolveTargetForFret(40, 0, 21, oneString), null);
    check('resolveTargetForFret: the same fret resolves once maxFret widens to 24',
        resolveTargetForFret(40, 0, 21, oneString, 24), { s: 0, f: 21, adjustment: 0 });
    check('resolveTargetForFret: a fret past a narrower 14-fret ceiling drops',
        resolveTargetForFret(40, 0, 15, oneString, 14), null);

    check('remapAnchors: clamps to the passed maxFret, not the hardcoded default',
        remapAnchors([{ time: 0, fret: 23, width: 4 }], [{ t: 0, f: 0, _origNote: { t: 0, f: 0 } }], 24),
        [{ time: 0, fret: 23, width: 4 }]);
    check('remapAnchors: still clamps at the default 20-fret ceiling when maxFret is omitted',
        remapAnchors([{ time: 0, fret: 23, width: 4 }], [{ t: 0, f: 0, _origNote: { t: 0, f: 0 } }]),
        [{ time: 0, fret: 20, width: 4 }]);

    // Single-string source/target (as above) so there's no adjacent string
    // the walk could escape to — isolates the ceiling from string choice.
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 21 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [0], capo: 0, stringCount: 1,
    };
    retuner.apply(bundle, oneString, 20);
    check('createRetuner: a fret-21 note drops under the default 20-fret ceiling', bundle.notes.length, 0);

    bundle.notes = rawNotes;
    retuner.apply(bundle, oneString, 24);
    check('createRetuner: the same note survives once maxFret widens to 24', bundle.notes.length, 1);
    check('createRetuner: it keeps its exact source fret', bundle.notes[0].f, 21);

    // Cache invalidation: same tuning, different maxFret must NOT cache-hit
    // (targetSig folds maxFret in) — re-running at 20 drops it again.
    bundle.notes = rawNotes;
    retuner.apply(bundle, oneString, 20);
    check('createRetuner: switching maxFret back down re-invalidates the cache and re-drops the note', bundle.notes.length, 0);
}

// Duplicate note+octave across strings is allowed — no uniqueness
// constraint anywhere in the engine.
{
    const dup = resolveTargetTuning(['B0', 'B0', 'A1', 'D2', 'G2']);
    check('duplicate-note target midiTuning', dup.midiTuning, [23, 23, 33, 38, 43]);
    check('duplicate-note target labels', dup.labels, ['B', 'B', 'A', 'D', 'G']);

    check('duplicate target: source lands on the first B0 slot',
        remapNote(23, 0, 0, dup.midiTuning), { s: 0, f: 0 });
    check('duplicate target: source lands on the second B0 slot',
        remapNote(23, 1, 0, dup.midiTuning), { s: 1, f: 0 });

    const survivors = resolveChordCollisions([23, 23], [0, 1], [{ s: 0, f: 0 }, { s: 1, f: 0 }], dup.midiTuning);
    check('duplicate target: both unison notes survive as independent target strings', survivors.length, 2);
}

// Irregular-interval target: B0,E1,A1,D2,F#2 — D2->F#2 is a major third,
// not the usual fourth.
{
    const irregular = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'F#2']);
    check('irregular target midiTuning', irregular.midiTuning, [23, 28, 33, 38, 42]);

    const ctx = songContext(5, [0, 0, 0, 0, 0], 0, irregular.midiTuning);
    check('irregular target arrangement shift', ctx.k, 0);
    for (let s = 0; s < 4; s++) {
        for (const f of SPOT_FRETS) {
            check(`irregular target identity s=${s} f=${f}`,
                remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, irregular.midiTuning), { s, f });
        }
    }
    check('irregular target: string 4 open note offset by the real (non-fourth) interval',
        remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 0, irregular.midiTuning), { s: 4, f: 1 });
    check('irregular target: string 4 fret 19 -> 20 (top of range)',
        remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 19, irregular.midiTuning), { s: 4, f: 20 });
    check('irregular target: string 4 fret 20 overflows (no 6th string to cascade to) and drops',
        remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 20, irregular.midiTuning), null);

    check('irregular target: cascade uses the actual interval, not an assumed fourth/fifth',
        resolveTargetForFret(38, 3, 21, irregular.midiTuning), { s: 4, f: 17, adjustment: -4 });
}

// Variable target string count: 4-8, matching highway_3d's floor and
// MAX_RENDER_STRINGS.
{
    check('MIN_TARGET_STRING_COUNT is 4', MIN_TARGET_STRING_COUNT, 4);
    check('MAX_TARGET_STRING_COUNT is 8', MAX_TARGET_STRING_COUNT, 8);
}

// defaultExtensionNote / midiToNoteLabel: low extensions drop a perfect
// fourth; high extensions rise a major third only from BEADG's G2 (43).
{
    check('midiToNoteLabel round-trips every DEFAULT_TARGET_TUNING entry',
        DEFAULT_TARGET_MIDI_TUNING.map(midiToNoteLabel), DEFAULT_TARGET_TUNING);

    check('add-high from BEADG default G2 -> B2 (major third, guitar convention)',
        defaultExtensionNote('high', 43), { midi: 47, label: 'B2' });
    check('add-low from EADG default E1 -> B0 (perfect fourth, restores BEADG)',
        defaultExtensionNote('low', 28), { midi: 23, label: 'B0' });

    check('add-high a second time from B2 -> E3 (perfect fourth)',
        defaultExtensionNote('high', 47), { midi: 52, label: 'E3' });
    check('add-low a second time from B0 -> F#0 (perfect fourth)',
        defaultExtensionNote('low', 23), { midi: 18, label: 'F#0' });

    check('add-high from a non-G2 edge (A1) uses a plain fourth, not a third',
        defaultExtensionNote('high', 33), { midi: 38, label: 'D2' });

    check('EXTENDED_DEFAULT_TARGET_TUNING agrees with the low-extension default',
        EXTENDED_DEFAULT_TARGET_TUNING[1], 'F#0');
    check('EXTENDED_DEFAULT_TARGET_TUNING agrees with the high-extension default',
        EXTENDED_DEFAULT_TARGET_TUNING[7], 'B2');
}

// colorRoleForNote / BEADG_COLOR_ROLES: symbolic color roles only, no
// actual colors (that's screen.js's job).
{
    check('colorRoleForNote: B0 -> lowB', colorRoleForNote(23), 'lowB');
    check('colorRoleForNote: E1 -> e', colorRoleForNote(28), 'e');
    check('colorRoleForNote: A1 -> a', colorRoleForNote(33), 'a');
    check('colorRoleForNote: D2 -> d', colorRoleForNote(38), 'd');
    check('colorRoleForNote: G2 -> g', colorRoleForNote(43), 'g');
    check('colorRoleForNote: B2 (1st high ext) -> highB', colorRoleForNote(47), 'highB');
    check('colorRoleForNote: E3 (2nd high ext) -> highE', colorRoleForNote(52), 'highE');
    check('colorRoleForNote: F#0 (1st low ext) -> lowExt1', colorRoleForNote(18), 'lowExt1');
    check('colorRoleForNote: C#0 (2nd low ext) -> lowExt2', colorRoleForNote(13), 'lowExt2');
    check('colorRoleForNote: a 3rd low extension (C#0 - 5 = G#-1) -> gray', colorRoleForNote(8), 'gray');
    check('colorRoleForNote: an arbitrary custom note (A0) -> gray', colorRoleForNote(21), 'gray');

    check('BEADG_COLOR_ROLES has exactly 5 entries, low to high',
        BEADG_COLOR_ROLES, ['lowB', 'e', 'a', 'd', 'g']);
}

// isValidTuningStringsArray: string-count, MIDI-range, and parse-validity checks.
{
    check('isValidTuningStringsArray: BEADG (5) is valid', isValidTuningStringsArray(DEFAULT_TARGET_TUNING), true);
    check('isValidTuningStringsArray: MIN_TARGET_STRING_COUNT (4) is valid',
        isValidTuningStringsArray(['E1', 'A1', 'D2', 'G2']), true);
    check('isValidTuningStringsArray: MAX_TARGET_STRING_COUNT (8) is valid',
        isValidTuningStringsArray(['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2']), true);
    check('isValidTuningStringsArray: below the floor (3) is invalid',
        isValidTuningStringsArray(['A1', 'D2', 'G2']), false);
    check('isValidTuningStringsArray: above the ceiling (9) is invalid',
        isValidTuningStringsArray(['C#0', 'F#0', 'B0', 'E1', 'A1', 'D2', 'G2', 'B2', 'E3']), false);
    check('isValidTuningStringsArray: C-1 and E5 range boundaries are valid',
        isValidTuningStringsArray(['C-1', 'E1', 'A1', 'D2', 'E5']), true);
    check('isValidTuningStringsArray: below MIDI range is invalid',
        isValidTuningStringsArray(['C-2', 'E1', 'A1', 'D2']), false);
    check('isValidTuningStringsArray: above MIDI range is invalid',
        isValidTuningStringsArray(['E1', 'A1', 'D2', 'F5']), false);
    check('isValidTuningStringsArray: exported MIDI bounds match C-1..E5',
        [MIN_TARGET_MIDI, MAX_TARGET_MIDI], [0, 76]);
    check('isValidTuningStringsArray: a malformed entry anywhere invalidates the whole array',
        isValidTuningStringsArray(['B0', 'E1', 'garbage', 'D2', 'G2']), false);
    check('isValidTuningStringsArray: non-array input is invalid', isValidTuningStringsArray(null), false);
    check('isValidTuningStringsArray: non-array input (string) is invalid', isValidTuningStringsArray('B0,E1,A1,D2,G2'), false);
}

// BUILTIN_PRESET_TUNINGS / DEFAULT_TUNING_ID / resolveActiveTuning: the
// built-in-preset resolution path screen.js's _crResolveActiveTuning
// delegates to wholesale.
{
    check('DEFAULT_TUNING_ID is EADG, and EADG is the first preset',
        DEFAULT_TUNING_ID, 'eadg');
    check('DEFAULT_GUITAR_TUNING_ID is EADGBE', DEFAULT_GUITAR_TUNING_ID, 'eadgbe');
    check('EADG preset entry is DEFAULT_TARGET_TUNING minus the low B, live-tracked (colors: null) like BEADG',
        { strings: BUILTIN_PRESET_TUNINGS[0].strings, colors: BUILTIN_PRESET_TUNINGS[0].colors },
        { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null });
    check('BEADG preset entry shares DEFAULT_TARGET_TUNING and has no concrete colors (live-tracked)',
        { strings: BUILTIN_PRESET_TUNINGS[1].strings, colors: BUILTIN_PRESET_TUNINGS[1].colors },
        { strings: DEFAULT_TARGET_TUNING, colors: null });
    const eadgbePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadgbe');
    check('EADGBE preset is standard 6-string guitar, live-tracked with explicit per-position roles',
        { strings: eadgbePreset.strings, colors: eadgbePreset.colors, roles: eadgbePreset.roles },
        { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'] });
    check('EADGBE preset strings validate and resolve to standard guitar MIDI',
        resolveTargetTuning(eadgbePreset.strings).midiTuning, [40, 45, 50, 55, 59, 64]);
    const sevenPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadgbe');
    check('BEADGBE 7-string preset resolves to standard 7-string guitar MIDI, low B takes the lowB role',
        { midi: resolveTargetTuning(sevenPreset.strings).midiTuning, colors: sevenPreset.colors, roles: sevenPreset.roles },
        { midi: [35, 40, 45, 50, 55, 59, 64], colors: null, roles: ['lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'] });
    const baritonePreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'baritone_beadfsb');
    check('Baritone preset is standard guitar down a fourth, roles position-parallel to EADGBE',
        { midi: resolveTargetTuning(baritonePreset.strings).midiTuning, colors: baritonePreset.colors, roles: baritonePreset.roles },
        { midi: [35, 40, 45, 50, 54, 59], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'] });
    const violinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'violin_gdae');
    check('Violin preset resolves fifths tuning with concrete colors (no roles)',
        { midi: resolveTargetTuning(violinPreset.strings).midiTuning, colors: violinPreset.colors, roles: violinPreset.roles },
        { midi: [55, 62, 69, 76], colors: ['#f18313', '#3fc413', '#ecd234', '#e61f26'], roles: undefined });
    const uprightPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'upright_solo_fsbea');
    check('Upright solo preset is EADG up a whole step, live-tracked with bass-position roles',
        { midi: resolveTargetTuning(uprightPreset.strings).midiTuning, colors: uprightPreset.colors, roles: uprightPreset.roles },
        { midi: [30, 35, 40, 45], colors: null, roles: ['e', 'a', 'd', 'g'] });
    const violaPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'viola_cgda');
    check('Viola preset is Cello an octave up, same note-parallel colors',
        { midi: resolveTargetTuning(violaPreset.strings).midiTuning, colors: violaPreset.colors },
        { midi: [48, 55, 62, 69], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'] });
    const banjo4Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo4_cgbd');
    check('Banjo 4-string preset resolves plectrum tuning with concrete colors',
        { midi: resolveTargetTuning(banjo4Preset.strings).midiTuning, colors: banjo4Preset.colors },
        { midi: [48, 55, 59, 62], colors: ['#cc00aa', '#f18313', '#1096e6', '#3fc413'] });
    const banjo5Preset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'banjo5_gdgbd');
    check('Banjo 5-string preset is non-monotonic open G: string 0 is the HIGH G4 drone (banjo tab order)',
        { midi: resolveTargetTuning(banjo5Preset.strings).midiTuning, colors: banjo5Preset.colors },
        { midi: [67, 50, 55, 59, 62], colors: ['#f18313', '#3fc413', '#f18313', '#1096e6', '#3fc413'] });
    const mandolinPreset = BUILTIN_PRESET_TUNINGS.find(p => p.id === 'mandolin_ggddaaee');
    check('Mandolin preset is four paired courses at the 8-string maximum, one color per course pair',
        { midi: resolveTargetTuning(mandolinPreset.strings).midiTuning, colors: mandolinPreset.colors },
        {
            midi: [55, 55, 62, 62, 69, 69, 76, 76],
            colors: ['#f18313', '#f18313', '#3fc413', '#3fc413', '#ecd234', '#ecd234', '#e61f26', '#e61f26'],
        });
    check('Mandolin preset sits exactly at MAX_TARGET_STRING_COUNT', mandolinPreset.strings.length, MAX_TARGET_STRING_COUNT);
    check('every preset without live-tracked colors carries concrete, valid colors',
        BUILTIN_PRESET_TUNINGS.filter(p => p.colors !== null).every(p => Array.isArray(p.colors) && p.colors.length === p.strings.length && isValidTuningStringsArray(p.strings)),
        true);
    check('every live-tracked preset has valid strings and roles (if any) matching its string count',
        BUILTIN_PRESET_TUNINGS.filter(p => p.colors === null).every(p => isValidTuningStringsArray(p.strings) && (p.roles === undefined || p.roles.length === p.strings.length)),
        true);

    // Every resolution also reports the RESOLVED id plus capo/octaveOffset
    // (v0.4.0, both 0 unless the profile carries valid values) — folded
    // into the expected shapes below via this tiny helper.
    const adj = (id, shape) => Object.assign({ id, capo: 0, octaveOffset: 0 }, shape);
    check('resolveActiveTuning: no id (fresh install) resolves to EADG, live colors',
        resolveActiveTuning(undefined, []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    check('resolveActiveTuning: explicit EADG id resolves the same as no id',
        resolveActiveTuning('eadg', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    check('resolveActiveTuning: explicit BEADG id resolves BEADG, live colors',
        resolveActiveTuning('beadg', []), adj('beadg', { strings: DEFAULT_TARGET_TUNING, colors: null, roles: null, maxFret: 24 }));
    check('resolveActiveTuning: EADGBE id resolves guitar strings + roles passthrough',
        resolveActiveTuning('eadgbe', []),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    check('resolveActiveTuning: a non-default preset id (Cello) resolves its own strings + concrete colors',
        resolveActiveTuning('cello_cgda', []),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'], roles: null, maxFret: 24 }));
    check('resolveActiveTuning: a custom-tuning id resolves from the supplied list (roles always null, maxFret defaults when absent)',
        resolveActiveTuning('custom_abc', [{ id: 'custom_abc', name: 'AEADG', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }]),
        adj('custom_abc', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 20 }));
    check('resolveActiveTuning: a custom-tuning id carries its own valid maxFret through',
        resolveActiveTuning('custom_mf', [{ id: 'custom_mf', name: 'Custom24', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], maxFret: 24 }]),
        adj('custom_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 24 }));
    check('resolveActiveTuning: a custom-tuning id with an invalid maxFret falls back to the default',
        resolveActiveTuning('custom_bad_mf', [{ id: 'custom_bad_mf', name: 'BadMF', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], maxFret: 17 }]),
        adj('custom_bad_mf', { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'], roles: null, maxFret: 20 }));
    // Unknown/deleted ids fall back to the arrangement class's default
    // preset (EADG shape for bass, EADGBE for guitar classes) — changed
    // from the pre-guitar hardcoded BEADG-shape fallback (see HISTORY.md
    // Phase 12): the class default matches what a fresh install shows.
    check('resolveActiveTuning: an unknown/deleted id falls back to the class default (bass -> EADG)',
        resolveActiveTuning('stale_deleted_id', []), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    check('resolveActiveTuning: an unknown id with null customTunings falls back to class default (non-array guard)',
        resolveActiveTuning('stale_deleted_id', null), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    check('resolveActiveTuning: an unknown id with undefined customTunings falls back to class default (non-array guard)',
        resolveActiveTuning('stale_deleted_id', undefined), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    check('resolveActiveTuning: an unknown id under a guitar class falls back to EADGBE',
        resolveActiveTuning('stale_deleted_id', [], 'lead'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    check('resolveActiveTuning: no id under the rhythm class resolves the guitar default',
        resolveActiveTuning(undefined, [], 'rhythm'),
        adj('eadgbe', { strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], colors: null, roles: ['e', 'a', 'd', 'g', 'highB', 'highE'], maxFret: 24 }));
    check('resolveActiveTuning: an explicit id resolves the same regardless of class (any profile may use any tuning)',
        resolveActiveTuning('eadg', [], 'lead'), adj('eadg', { strings: DEFAULT_TARGET_TUNING.slice(1), colors: null, roles: null, maxFret: 20 }));
    check('resolveActiveTuning: a preset id wins even if a custom tuning happens to share it',
        resolveActiveTuning('cello_cgda', [{ id: 'cello_cgda', name: 'user override attempt', strings: ['E1', 'A1', 'D2', 'G2'], colors: ['#000', '#000', '#000', '#000'] }]),
        adj('cello_cgda', { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'], roles: null, maxFret: 24 }));

    check('MAX_FRET_OPTIONS is the expected selectable ceiling list', MAX_FRET_OPTIONS, [12, 14, 20, 21, 22, 24]);
    check('isValidMaxFret accepts every listed option', MAX_FRET_OPTIONS.every(isValidMaxFret), true);
    check('isValidMaxFret rejects an unlisted value', isValidMaxFret(17), false);
    check('isValidMaxFret rejects non-numeric input', isValidMaxFret('20'), false);
    check('every built-in preset carries a valid maxFret',
        BUILTIN_PRESET_TUNINGS.every(p => isValidMaxFret(p.maxFret)), true);
    check('EADG (bass default) keeps the historical 20-fret ceiling',
        BUILTIN_PRESET_TUNINGS.find(p => p.id === 'eadg').maxFret, 20);
    check('BEADG (5-string bass) uses the wider 24-fret ceiling',
        BUILTIN_PRESET_TUNINGS.find(p => p.id === 'beadg').maxFret, 24);
    check('every guitar preset (EADGBE/7-string/baritone) uses 24 frets',
        ['eadgbe', 'beadgbe', 'baritone_beadfsb'].every(id => BUILTIN_PRESET_TUNINGS.find(p => p.id === id).maxFret === 24), true);
    check('violin and mandolin use the shorter 14-fret ceiling',
        ['violin_gdae', 'mandolin_ggddaaee'].every(id => BUILTIN_PRESET_TUNINGS.find(p => p.id === id).maxFret === 14), true);
}

// defaultTuningIdForClass / arrangementClassFor: the per-class profile
// routing screen.js's _crProfileKeyFor/_crArrClass tracking delegates to.
{
    check('defaultTuningIdForClass: bass -> EADG', defaultTuningIdForClass('bass'), 'eadg');
    check('defaultTuningIdForClass: rhythm -> EADGBE', defaultTuningIdForClass('rhythm'), 'eadgbe');
    check('defaultTuningIdForClass: lead -> EADGBE', defaultTuningIdForClass('lead'), 'eadgbe');

    check('arrangementClassFor: "Bass"', arrangementClassFor('Bass'), 'bass');
    check('arrangementClassFor: "Bass 2"', arrangementClassFor('Bass 2'), 'bass');
    check('arrangementClassFor: "Lead"', arrangementClassFor('Lead'), 'lead');
    check('arrangementClassFor: "Rhythm"', arrangementClassFor('Rhythm'), 'rhythm');
    check('arrangementClassFor: "Combo" routes to rhythm', arrangementClassFor('Combo'), 'rhythm');
    check('arrangementClassFor: plain "Guitar 22" routes to rhythm', arrangementClassFor('Guitar 22'), 'rhythm');
    check('arrangementClassFor: bass wins over lead when both words appear', arrangementClassFor('Lead Bass'), 'bass');
    check('arrangementClassFor: word boundary — "BasslineKeys" is not bass', arrangementClassFor('BasslineKeys'), 'rhythm');
    check('arrangementClassFor: case-insensitive', arrangementClassFor('LEAD'), 'lead');
    check('arrangementClassFor: empty string pins bass (pre-guitar behavior for hosts without arrangement)',
        arrangementClassFor(''), 'bass');
    check('arrangementClassFor: whitespace-only pins bass', arrangementClassFor('   '), 'bass');
    check('arrangementClassFor: undefined pins bass', arrangementClassFor(undefined), 'bass');
    check('arrangementClassFor: non-string pins bass', arrangementClassFor(42), 'bass');
}

// intToHex / resolveColorsArray: plain data-shape transforms.
{
    check('intToHex: round-trips a representative color', intToHex(0xe61f26), '#e61f26');
    check('intToHex: pads a short hex value', intToHex(0x1), '#000001');
    check('LIGHT_GRAY_COLOR is the documented CSS "light gray"', LIGHT_GRAY_COLOR, 0xd3d3d3);

    const defaults = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    check('resolveColorsArray: colors entirely missing falls back to every default',
        resolveColorsArray(undefined, 5, defaults), defaults);
    check('resolveColorsArray: colors entirely missing (null) falls back to every default',
        resolveColorsArray(null, 5, defaults), defaults);
    check('resolveColorsArray: a valid entry is kept, invalid/missing entries fall back',
        resolveColorsArray(['#abcdef', 'not-a-hex', undefined], 5, defaults),
        ['#abcdef', '#222222', '#333333', '#444444', '#555555']);
    check('resolveColorsArray: a too-short array treats missing trailing entries as invalid',
        resolveColorsArray(['#abcdef'], 5, defaults),
        ['#abcdef', '#222222', '#333333', '#444444', '#555555']);
    check('resolveColorsArray: a too-long array ignores entries past `length`',
        resolveColorsArray(['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'], 5, defaults),
        defaults);
}

// Unplayable-low-note-drop regression: EADG target (4-string, B removed)
// must silently drop notes below open E1, not cascade or crash.
{
    const eadg = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
    check('EADG (4-string, B removed) target midiTuning', eadg.midiTuning, [28, 33, 38, 43]);

    check('a pitch one half-step below open E1 is dropped on a 4-string EADG target',
        remapNote(27, 0, 0, eadg.midiTuning), null);
    check('resolveTargetForFret returns null (not a crash/undefined) for the same case',
        resolveTargetForFret(27, 0, 0, eadg.midiTuning), null);
    check('open E1 itself remains playable on the EADG target',
        remapNote(28, 0, 0, eadg.midiTuning), { s: 0, f: 0 });

    // End-to-end via createRetuner, same path screen.js's draw() uses.
    const { createRetuner } = CR;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 0 }];
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0, 0], capo: 0, stringCount: 5,
    };
    retuner.apply(bundle);
    check('under the full BEADG target, the open B note survives', bundle.notes.length, 2);

    bundle.notes = rawNotes;
    retuner.apply(bundle, eadg.midiTuning);
    check('under a reduced EADG target, only the A-string note survives (B note dropped)',
        bundle.notes.map(n => ({ s: n.s, f: n.f })), [{ s: 0, f: 0 }]);
}

// 6-string target (BEADG + a high string) — every remap function must
// bound itself against the target's actual length, not a stale fixed 5.
{
    const sixString = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'B2']);
    check('6-string target midiTuning', sixString.midiTuning, [23, 28, 33, 38, 43, 47]);
    check('6-string target labels', sixString.labels, ['B', 'E', 'A', 'D', 'G', 'B']);

    const shiftK = computeArrangementShift(6, null, 0, sixString.midiTuning, sixString.midiTuning);
    check('computeArrangementShift finds identity (k=0) using the real 6-string target bound', shiftK, 0);
    for (let s = 0; s < 6; s++) {
        for (const f of SPOT_FRETS) {
            check(`6-string target identity s=${s} f=${f}`,
                remapNote(sixString.midiTuning[s], s, f, sixString.midiTuning), { s, f });
        }
    }

    check('6-string target: overflow past fret 20 on the new top string drops',
        remapNote(sixString.midiTuning[5], 5, 21, sixString.midiTuning), null);
}

// remapChordTemplate at a non-5 target length.
{
    const eadg = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
    const sourceOpenMidiByString = [28, 33, 38, 43];
    const naturalTargetByString = [0, 1, 2, 3];
    const template4 = { frets: [3, -1, -1, 2], fingers: [1, -1, -1, 4] };
    const remapped4 = remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template4, eadg.midiTuning);
    check('remapChordTemplate at a 4-string target sizes frets to 4', remapped4.frets.length, 4);
    check('remapChordTemplate at a 4-string target sizes fingers to 4', remapped4.fingers.length, 4);
    check('remapChordTemplate at a 4-string target: content remaps correctly', remapped4.frets, [3, -1, -1, 2]);

    const sixString = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'G2', 'B2']);
    const template6 = { frets: [-1, -1, -1, -1, -1, 5], fingers: [-1, -1, -1, -1, -1, 3] };
    const remapped6 = remapChordTemplate([23, 28, 33, 38, 43, 47], [0, 1, 2, 3, 4, 5], template6, sixString.midiTuning);
    check('remapChordTemplate at a 6-string target sizes frets to 6', remapped6.frets.length, 6);
    check('remapChordTemplate at a 6-string target: the new 6th-string slot remaps correctly', remapped6.frets, [-1, -1, -1, -1, -1, 5]);
}

// ── Capo & octave offset (v0.4.0) ────────────────────────────────────

// Validation helpers.
{
    check('isValidCapo: 0 is valid (means "no capo")', isValidCapo(0, 20), true);
    check('isValidCapo: maxFret-1 is the ceiling', isValidCapo(19, 20), true);
    check('isValidCapo: capo AT the max fret is invalid', isValidCapo(20, 20), false);
    check('isValidCapo: a negative capo is invalid', isValidCapo(-1, 20), false);
    check('isValidCapo: non-integers are invalid', isValidCapo(1.5, 20), false);
    check('resolveCapo: invalid values resolve to 0', resolveCapo(25, 20), 0);
    check('resolveCapo: a valid capo passes through', resolveCapo(4, 20), 4);
    check('octave-offset bounds', [MIN_OCTAVE_OFFSET, MAX_OCTAVE_OFFSET], [-2, 2]);
    check('isValidOctaveOffset over the boundary values',
        [isValidOctaveOffset(-2), isValidOctaveOffset(2), isValidOctaveOffset(0), isValidOctaveOffset(3), isValidOctaveOffset(-3), isValidOctaveOffset(0.5)],
        [true, true, true, false, false, false]);
    check('resolveOctaveOffset: invalid values resolve to 0', resolveOctaveOffset(9), 0);
    check('effectiveTargetMidiTuning: capo raises each open, +1 octave lowers by 12',
        effectiveTargetMidiTuning([28, 33, 38, 43], 2, 1), [18, 23, 28, 33]);
    check('effectiveMaxFret subtracts the capo from the neck', effectiveMaxFret(20, 3), 17);
    check('effectiveMaxFret never collapses below 1', effectiveMaxFret(20, 25), 1);
}

// Capo cancellation identity: tuning every string down k half-steps and
// clamping a capo at fret k is a cumulative offset of 0 — the remapped
// chart must equal the un-capo'd original exactly (for charts that fit
// the capo-shortened neck), for k = 1..4. End-to-end via createRetuner,
// the same path screen.js's draw() uses.
{
    const { createRetuner } = CR;
    const eadg = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
    const rawNotes = [
        { t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 3 },
        { t: 2, s: 2, f: 12 }, { t: 3, s: 3, f: 16 },
    ];
    const rawChords = [{ id: null, t: 4, notes: [{ t: 4, s: 1, f: 2 }, { t: 4, s: 2, f: 2 }] }];
    const mkBundle = () => ({
        notes: rawNotes, chords: rawChords, anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0], capo: 0, stringCount: 4,
    });

    const baseline = mkBundle();
    createRetuner().apply(baseline, eadg.midiTuning, 20);
    const expectedNotes = baseline.notes.map(n => ({ s: n.s, f: n.f }));
    const expectedChord = baseline.chords[0].notes.map(n => ({ s: n.s, f: n.f }));
    check('capo baseline: E-standard chart on EADG is the identity',
        expectedNotes, rawNotes.map(n => ({ s: n.s, f: n.f })));

    for (const k of [1, 2, 3, 4]) {
        const downTuned = eadg.midiTuning.map(m => m - k);
        check(`capo ${k}: effective opens equal plain EADG (cumulative offset 0)`,
            effectiveTargetMidiTuning(downTuned, k, 0), eadg.midiTuning);
        const bundle = mkBundle();
        createRetuner().apply(bundle, effectiveTargetMidiTuning(downTuned, k, 0), effectiveMaxFret(20, k));
        check(`capo ${k}: notes identical to the un-capo'd chart`,
            bundle.notes.map(n => ({ s: n.s, f: n.f })), expectedNotes);
        check(`capo ${k}: chord voicing identical to the un-capo'd chart`,
            bundle.chords[0].notes.map(n => ({ s: n.s, f: n.f })), expectedChord);
    }
}

// Octave-offset identity: an E-standard bass chart with a +1 octave
// offset lands on a standard guitar's lowest four strings (E2 A2 D3 G3)
// note-for-note; the reverse (-1 octave) puts a guitar chart's low-four-
// string notes back on the bass unchanged.
{
    const { createRetuner } = CR;
    const bass = resolveTargetTuning(['E1', 'A1', 'D2', 'G2']);
    const guitar = resolveTargetTuning(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);

    const bassNotes = [
        { t: 0, s: 0, f: 0 }, { t: 1, s: 1, f: 5 },
        { t: 2, s: 2, f: 7 }, { t: 3, s: 3, f: 12 },
    ];
    const mkBass = () => ({
        notes: bassNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0], capo: 0, stringCount: 4,
    });
    const onBass = mkBass();
    createRetuner().apply(onBass, bass.midiTuning, 20);
    const bassExpected = onBass.notes.map(n => ({ s: n.s, f: n.f }));
    check('octave baseline: bass chart on the bass target is the identity',
        bassExpected, bassNotes.map(n => ({ s: n.s, f: n.f })));

    const onGuitar = mkBass();
    createRetuner().apply(onGuitar, effectiveTargetMidiTuning(guitar.midiTuning, 0, 1), effectiveMaxFret(24, 0));
    check('+1 octave: the bass chart lands on the guitar\'s low four strings identically',
        onGuitar.notes.map(n => ({ s: n.s, f: n.f })), bassExpected);

    const guitarNotes = [
        { t: 0, s: 0, f: 3 }, { t: 1, s: 1, f: 0 },
        { t: 2, s: 2, f: 9 }, { t: 3, s: 3, f: 14 },
    ];
    const onBassDown = {
        notes: guitarNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [0, 0, 0, 0, 0, 0], capo: 0, stringCount: 6,
    };
    createRetuner().apply(onBassDown, effectiveTargetMidiTuning(bass.midiTuning, 0, -1), effectiveMaxFret(20, 0));
    check('-1 octave: a guitar chart\'s low-four-string notes land on the bass identically',
        onBassDown.notes.map(n => ({ s: n.s, f: n.f })), guitarNotes.map(n => ({ s: n.s, f: n.f })));
}

// resolveActiveTuning: resolved id + capo/octaveOffset fields, and the
// v0.4.0 ukulele presets.
{
    const t = resolveActiveTuning('eadgbe', []);
    check('resolveActiveTuning reports the resolved id', t.id, 'eadgbe');
    check('built-in presets default to capo 0 / octave 0', [t.capo, t.octaveOffset], [0, 0]);

    const uke = resolveActiveTuning('ukulele_gcea', []);
    check('ukulele preset strings (reentrant gCEA)', uke.strings, ['G4', 'C4', 'E4', 'A4']);
    check('ukulele preset max fret', uke.maxFret, 12);
    const bari = resolveActiveTuning('baritone_uke_dgbe', []);
    check('baritone ukulele preset strings (DGBE)', bari.strings, ['D3', 'G3', 'B3', 'E4']);

    const customs = [
        { id: 'c1', name: 'Octave cello', strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#111111', '#222222', '#333333', '#444444'], maxFret: 24, capo: 2, octaveOffset: 1 },
        { id: 'c2', name: 'Bad adjust', strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#111111', '#222222', '#333333', '#444444'], maxFret: 12, capo: 20, octaveOffset: 9 },
    ];
    const c1 = resolveActiveTuning('c1', customs);
    check('a custom tuning carries its saved capo/octave', [c1.id, c1.capo, c1.octaveOffset], ['c1', 2, 1]);
    const c2 = resolveActiveTuning('c2', customs);
    check('a saved capo at/past the tuning\'s own max fret disables the capo; out-of-range octave resolves to 0',
        [c2.capo, c2.octaveOffset], [0, 0]);
    const fb = resolveActiveTuning('nonexistent', [], 'bass');
    check('the class-default fallback reports its own id', fb.id, 'eadg');

    // Reentrant uke target sanity: non-monotonic (high-G drone at index
    // 0) flows through the same pitch-ordered walk banjo5 exercised.
    const ukeTarget = resolveTargetTuning(uke.strings);
    check('ukulele target midiTuning', ukeTarget.midiTuning, [67, 60, 64, 69]);
    check('reentrant uke: a note below the lowest open (C4) drops rather than crashing',
        remapNote(59, 1, 0, ukeTarget.midiTuning, 12), null);
    check('reentrant uke: open C4 stays on its own string',
        remapNote(60, 1, 0, ukeTarget.midiTuning, 12), { s: 1, f: 0 });
}

// ---- Pathological-chart safety valves (createRetuner) -----------------
// The cold remap is synchronous and bounded: a per-group solver node
// budget (maxSearchNodes), an oversize-group cutoff
// (MAX_SOLVER_GROUP_SIZE), and a whole-remap deadline (maxTotalSolveMs)
// past which the remaining groups take the per-note path.

// Helper: a fresh bundle over shared raw arrays.
function mkBundle(raw) {
    return {
        notes: raw.notes, chords: raw.chords, anchors: raw.anchors,
        chordTemplates: raw.templates,
        tuning: raw.tuning, capo: raw.capo | 0, stringCount: raw.sc,
    };
}

// Solver node-budget abort inside createRetuner: the group degrades to
// the per-note path (notes still render) instead of dropping, and the
// abort is counted. Default budget: same chart, no aborts.
{
    const { createRetuner } = CR;
    // Eb-standard open-heavy chord onto EADG: the exact per-note remap
    // drops the low open Eb (below the target's range), so the solver
    // search must run — then a 10-node budget aborts it immediately.
    const raw = {
        notes: [
            { t: 0, s: 0, f: 0 }, { t: 0, s: 1, f: 0 }, { t: 0, s: 2, f: 1 }, { t: 0, s: 3, f: 3 },
        ],
        chords: [], anchors: [], templates: [], tuning: [-1, -1, -1, -1], capo: 0, sc: 4,
    };
    const eadg = DEFAULT_TARGET_MIDI_TUNING.slice(1); // E1 A1 D2 G2

    const capped = createRetuner({ maxSearchNodes: 10 });
    const cappedBundle = mkBundle(raw);
    capped.apply(cappedBundle, eadg);
    assert.ok(capped.getStats().searchAborts >= 1, 'node cap aborted the search'); passed++;
    assert.ok(cappedBundle.notes.length >= 1,
        'aborted group degrades to the per-note path instead of dropping'); passed++;
    // The per-note fallback keeps exact pitches: every survivor sounds
    // its source pitch (open midi + fret identical across the remap).
    for (const n of cappedBundle.notes) {
        const srcMidi = raw.tuning[n._origNote.s] + [28, 33, 38, 43][n._origNote.s] + n._origNote.f;
        check('aborted-group fallback preserves pitch', eadg[n.s] + n.f, srcMidi);
    }

    const uncapped = createRetuner();
    const uncappedBundle = mkBundle(raw);
    uncapped.apply(uncappedBundle, eadg);
    check('default node budget: no aborts on the same chart', uncapped.getStats().searchAborts, 0);
    assert.ok(uncappedBundle.notes.length >= cappedBundle.notes.length,
        'unbounded solve places at least as many notes'); passed++;

    // maxSearchNodes: 0 is a valid, explicit "never search" configuration
    // (immediate abort -> per-note fallback for every group) — it must
    // not be treated as "unset" and silently fall back to the default
    // budget (a `|| MAX_SEARCH_NODES` on the node count would do exactly
    // that, since 0 is falsy).
    const zeroBudget = createRetuner({ maxSearchNodes: 0 });
    const zeroBundle = mkBundle(raw);
    zeroBudget.apply(zeroBundle, eadg);
    check('maxSearchNodes: 0 aborts immediately (not treated as unset)', zeroBudget.getStats().searchAborts, 1);
    check('maxSearchNodes: 0 still degrades via the per-note fallback, matching a tiny explicit budget',
        zeroBundle.notes, cappedBundle.notes);
}

// Oversized simultaneous-note groups (data corruption, e.g. a broken GP
// export stacking a bar on one timestamp) skip the solver entirely.
{
    const { createRetuner, MAX_SOLVER_GROUP_SIZE } = CR;
    check('MAX_SOLVER_GROUP_SIZE is sane', MAX_SOLVER_GROUP_SIZE >= 8, true);
    const notes = [];
    for (let i = 0; i < MAX_SOLVER_GROUP_SIZE + 3; i++) {
        notes.push({ t: 0, s: i % 4, f: i });
    }
    const raw = { notes, chords: [], anchors: [], templates: [], tuning: [0, 0, 0, 0], capo: 0, sc: 4 };
    const retuner = createRetuner();
    const bundle = mkBundle(raw);
    retuner.apply(bundle);
    check('oversize group: counted', retuner.getStats().oversizeGroups, 1);
    assert.ok(bundle.notes.length >= 1 && bundle.notes.length <= 5,
        'oversize group resolves via per-note collision path'); passed++;
    check('oversize group: no solver aborts (solver never ran)', retuner.getStats().searchAborts, 0);
}

// Whole-remap deadline: past maxTotalSolveMs of work, the solver is
// disabled for the remaining groups — the remap still completes in the
// same apply() call and every group still materializes.
{
    const { createRetuner } = CR;
    const notes = [];
    for (let i = 0; i < 6; i++) {
        notes.push({ t: i, s: 0, f: i + 1 }, { t: i, s: 1, f: i + 2 });
    }
    const raw = { notes, chords: [], anchors: [], templates: [], tuning: [0, 0, 0, 0], capo: 0, sc: 4 };
    // maxTotalSolveMs: -1 -> the deadline is already past at the first
    // between-groups check, so every group takes the per-note path.
    const retuner = createRetuner({ maxTotalSolveMs: -1 });
    const bundle = mkBundle(raw);
    retuner.apply(bundle);
    check('deadline valve: solver disabled past the deadline', retuner.getStats().solverDisabled, true);
    check('deadline valve: every bucket still materialized', bundle.notes.length, notes.length);
    check('deadline valve: getStats shape', Object.keys(retuner.getStats()).sort(),
        ['oversizeGroups', 'searchAborts', 'solverDisabled', 'workMs']);
    // Identity chart on the default target: the per-note fallback maps
    // EADG onto BEADG's top four strings — same frets, string + 1 — so
    // the degraded output is still exactly right here.
    for (let i = 0; i < notes.length; i++) {
        check('deadline valve: fallback output correct', { s: bundle.notes[i].s, f: bundle.notes[i].f },
            { s: notes[i].s + 1, f: notes[i].f });
    }
}

// ---- Anchor-donor refinement after revoicing (PLANNING #2) ------------
// A revoiced donor (solve tier >= 2) can carry an octave-sized fret
// adjustment; remapAnchors now prefers the first tier-0 donor within
// ANCHOR_DONOR_WINDOW_S past the anchor, falling back to the revoiced
// adjustment only when no exact donor is nearby.
{
    const { remapAnchors, ANCHOR_DONOR_WINDOW_S } = CR;
    assert.ok(ANCHOR_DONOR_WINDOW_S > 0, 'donor window sane'); passed++;
    const mk = (t, origF, newF, tier) => {
        const n = { t, s: 0, f: newF, _origNote: { t, s: 0, f: origF } };
        if (tier !== undefined) n._crTier = tier;
        return n;
    };
    // Revoiced (+12) donor right at the anchor, tier-0 (-2) donor 1s later.
    check('anchor donor: nearby tier-0 donor beats the revoiced one',
        remapAnchors([{ time: 0.9, fret: 5, width: 4 }], [mk(1.0, 5, 17, 2), mk(2.0, 5, 3, 0)]),
        [{ time: 0.9, fret: 3, width: 4 }]);
    // Tier-0 donor beyond the window: the revoiced adjustment still wins
    // (it is the only signal for that passage).
    check('anchor donor: no tier-0 within the window -> revoiced fallback',
        remapAnchors([{ time: 0.9, fret: 5, width: 4 }],
            [mk(1.0, 5, 17, 2), mk(0.9 + ANCHOR_DONOR_WINDOW_S + 1, 5, 3, 0)]),
        [{ time: 0.9, fret: 17, width: 4 }]);
    // Untagged donors (direct API use) are trusted as tier 0 — the
    // pre-refinement behavior, byte-identical.
    check('anchor donor: untagged donors behave as before',
        remapAnchors([{ time: 0.9, fret: 5, width: 4 }], [mk(1.0, 5, 17), mk(2.0, 5, 3)]),
        [{ time: 0.9, fret: 17, width: 4 }]);
}

// End-to-end through createRetuner: a same-onset bucket whose low D1
// drops under the exact remap (below EADG's range) gets revoiced
// (tier 2) — its notes are tagged, and the anchor skips past them to
// the exact (tier 0) single note that follows.
{
    const { createRetuner } = CR;
    const eadg = DEFAULT_TARGET_MIDI_TUNING.slice(1); // E1 A1 D2 G2
    const mkRaw = (singleT) => ({
        // tuning [-3,-3,0,0]: s0 open C#1(25), s1 open F#1(30).
        // Bucket t=0: (s0,f1)=D1(26) — below EADG, exact remap drops it ->
        // solver revoices the pair; (s1,f1... ) see below.
        notes: [
            { t: 0, s: 0, f: 1 }, { t: 0, s: 1, f: 1 },
            { t: singleT, s: 2, f: 4 }, // (s2,f4)=D2+4 — exact, tier 0, adjustment 0
        ],
        chords: [], anchors: [{ time: 0, fret: 1, width: 4 }], templates: [],
        tuning: [-3, -3, 0, 0], capo: 0, sc: 4,
    });

    // Tier tags + the preferred-donor path (single note inside the window).
    const near = createRetuner();
    const nearRaw = mkRaw(0.6);
    const nearBundle = mkBundle(nearRaw);
    near.apply(nearBundle, eadg);
    const bucketNotes = nearBundle.notes.filter(n => n.t === 0);
    assert.ok(bucketNotes.length >= 1 && bucketNotes.every(n => n._crTier >= 2),
        'revoiced bucket notes carry their solve tier'); passed++;
    check('exact single note is tagged tier 0', nearBundle.notes.find(n => n.t === 0.6)._crTier, 0);
    check('anchor takes the nearby tier-0 donor adjustment (0), not the revoiced one',
        nearBundle.anchors, [{ time: 0, fret: 1, width: 4 }]);

    // Same chart with the exact note pushed past the window: the anchor
    // falls back to the first revoiced donor's own adjustment.
    const far = createRetuner();
    const farRaw = mkRaw(30);
    const farBundle = mkBundle(farRaw);
    far.apply(farBundle, eadg);
    const donor = farBundle.notes[0]; // first (time-sorted) fretted note at t=0
    const expected = Math.max(0, Math.min(20, 1 + donor.f - donor._origNote.f));
    check('anchor falls back to the revoiced donor when no tier-0 is nearby',
        farBundle.anchors, [{ time: 0, fret: expected, width: 4 }]);
    assert.ok(expected !== 1, 'fallback case actually differs from the tier-0 adjustment'); passed++;
}

console.log(`OK - ${passed} assertions passed`);
