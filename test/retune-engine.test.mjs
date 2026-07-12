// Standalone Node verification for the string/fret offset transformation
// engine. Imports the real engine from ../src/chart-retune.js — no
// hand-synced duplicate. Run with `node test/retune-engine.test.mjs`.
import assert from 'node:assert';
import { CR } from '../src/chart-retune.js';

const {
    TARGET_MAX_FRET,
    MAX_TARGET_STRING_COUNT,
    MIN_TARGET_STRING_COUNT,
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
    BUILTIN_TUNING_ID,
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
    const clampHigh = remapAnchors([{ time: 0, fret: TARGET_MAX_FRET - 1, width: 4 }], [{ t: 0, f: TARGET_MAX_FRET, _origNote: { t: 0, f: 0 } }]);
    check('anchor clamps at fret 20', clampHigh[0], { time: 0, fret: TARGET_MAX_FRET, width: 4 });

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
    check('resolveTargetTuning(BEADG) midi matches the built-in default', beadg.midiTuning, DEFAULT_TARGET_MIDI_TUNING);
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

// isValidTuningStringsArray: bounds + parse-validity check.
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
    check('isValidTuningStringsArray: a malformed entry anywhere invalidates the whole array',
        isValidTuningStringsArray(['B0', 'E1', 'garbage', 'D2', 'G2']), false);
    check('isValidTuningStringsArray: non-array input is invalid', isValidTuningStringsArray(null), false);
    check('isValidTuningStringsArray: non-array input (string) is invalid', isValidTuningStringsArray('B0,E1,A1,D2,G2'), false);
}

// BUILTIN_PRESET_TUNINGS / BUILTIN_TUNING_ID / resolveActiveTuning: the
// built-in-preset resolution path screen.js's _fseResolveActiveTuning
// delegates to wholesale.
{
    check('BUILTIN_TUNING_ID is BEADG, and BEADG is the first preset',
        BUILTIN_TUNING_ID, 'beadg');
    check('BEADG preset entry shares DEFAULT_TARGET_TUNING and has no concrete colors (live-tracked)',
        { strings: BUILTIN_PRESET_TUNINGS[0].strings, colors: BUILTIN_PRESET_TUNINGS[0].colors },
        { strings: DEFAULT_TARGET_TUNING, colors: null });
    check('every non-BEADG preset carries concrete, valid colors',
        BUILTIN_PRESET_TUNINGS.slice(1).every(p => Array.isArray(p.colors) && p.colors.length === p.strings.length && isValidTuningStringsArray(p.strings)),
        true);

    check('resolveActiveTuning: no id (fresh install) resolves to BEADG, live colors',
        resolveActiveTuning(undefined, []), { strings: DEFAULT_TARGET_TUNING, colors: null });
    check('resolveActiveTuning: explicit BEADG id resolves the same as no id',
        resolveActiveTuning('beadg', []), { strings: DEFAULT_TARGET_TUNING, colors: null });
    check('resolveActiveTuning: a non-BEADG preset id resolves its own strings + concrete colors',
        resolveActiveTuning('cello_cgda', []),
        { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'] });
    check('resolveActiveTuning: a custom-tuning id resolves from the supplied list',
        resolveActiveTuning('custom_abc', [{ id: 'custom_abc', name: 'AEADG', strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }]),
        { strings: ['A0', 'E1', 'A1', 'D2', 'G2'], colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] });
    check('resolveActiveTuning: an unknown/deleted id falls back to BEADG shape',
        resolveActiveTuning('stale_deleted_id', []), { strings: DEFAULT_TARGET_TUNING, colors: null });
    check('resolveActiveTuning: an unknown id with null customTunings falls back to BEADG shape (non-array guard)',
        resolveActiveTuning('stale_deleted_id', null), { strings: DEFAULT_TARGET_TUNING, colors: null });
    check('resolveActiveTuning: an unknown id with undefined customTunings falls back to BEADG shape (non-array guard)',
        resolveActiveTuning('stale_deleted_id', undefined), { strings: DEFAULT_TARGET_TUNING, colors: null });
    check('resolveActiveTuning: a preset id wins even if a custom tuning happens to share it',
        resolveActiveTuning('cello_cgda', [{ id: 'cello_cgda', name: 'user override attempt', strings: ['E1', 'A1', 'D2', 'G2'], colors: ['#000', '#000', '#000', '#000'] }]),
        { strings: ['C2', 'G2', 'D3', 'A3'], colors: ['#cc00aa', '#f18313', '#3fc413', '#ecd234'] });
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

console.log(`OK - ${passed} assertions passed`);
