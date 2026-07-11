// Standalone Node verification for the string/fret offset transformation
// engine (PLANNING.md Phase 2/3). Imports the real engine from
// ../src/fse-retune.js — the same module `screen.js` imports in the browser
// — so there is exactly one copy of this logic, no hand-synced duplicate to
// drift. No test framework, no DOM/THREE dependency, run directly with
// `node test/retune-engine.test.mjs`.
import assert from 'node:assert';
import { FSE } from '../src/fse-retune.js';

const {
    TARGET_MAX_FRET,
    TARGET_STRING_COUNT,
    DEFAULT_TARGET_MIDI_TUNING,
    DEFAULT_TARGET_TUNING,
    parseTargetNote,
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
} = FSE;

let passed = 0;
function check(label, actual, expected) {
    assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    passed++;
}

// Helper mirroring what FSE.createRetuner()'s apply() does once per song:
// compute k, then per-string open-note MIDI pitches and natural targets.
// `targetMidiTuning` (optional) mirrors createRetuner()'s optional target param —
// omit for the built-in BEADG default.
function songContext(sourceStringCount, tuning, capo, targetMidiTuning) {
    const sourceOpenMidiByString = computeOpenStringMidiByString(sourceStringCount, tuning, capo);
    const k = computeArrangementShift(sourceStringCount, tuning, capo, sourceOpenMidiByString, targetMidiTuning);
    const naturalTargetByString = [];
    for (let s = 0; s < sourceStringCount; s++) {
        naturalTargetByString.push(s + k);
    }
    return { k, sourceOpenMidiByString, naturalTargetByString };
}

// 1. Drop-D worked example, full chart. tuning = [-2,0,0,0], capo = 0.
{
    const ctx = songContext(4, [-2, 0, 0, 0], 0);
    assert.strictEqual(ctx.k, 1, `Drop-D arrangement shift: expected k=1, got ${ctx.k}`); passed++;
    for (let f = 0; f <= 20; f++) {
        check(`Drop-D A string f=${f}`, remapNote(ctx.sourceOpenMidiByString[1], ctx.naturalTargetByString[1], f), { s: 2, f });
        check(`Drop-D D string f=${f}`, remapNote(ctx.sourceOpenMidiByString[2], ctx.naturalTargetByString[2], f), { s: 3, f });
        check(`Drop-D G string f=${f}`, remapNote(ctx.sourceOpenMidiByString[3], ctx.naturalTargetByString[3], f), { s: 4, f });
    }
    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    check('Drop-D dropped string f=0 (D open)', remapNote(midi0, nat0, 0), { s: 0, f: 3 });
    check('Drop-D dropped string f=1 (Eb, original example)', remapNote(midi0, nat0, 1), { s: 0, f: 4 });
    check('Drop-D dropped string f=2 (E, crossover)', remapNote(midi0, nat0, 2), { s: 1, f: 0 });
    for (let f = 2; f <= 20; f++) {
        check(`Drop-D dropped string f=${f}`, remapNote(midi0, nat0, f), { s: 1, f: f - 2 });
    }
}

// 1b. Real Drop C# (feedback, verified against the user's actual chart —
// open strings low-to-high are C#, G#, C#, F#, i.e. tuning = [-3,-1,-1,-1]:
// the WHOLE tuning is a half-step down from standard, PLUS the lowest
// string dropped an EXTRA whole step — not just the lowest string modified
// in isolation, unlike Drop D. Every string's own natural target (k=+1,
// same shift as EADG, since 3 of 4 strings differ from standard by a
// uniform amount) is off by a nonzero adjustment (+4 for strings 1-3, +2
// for string 0), so EVERY string ends up "borrowing" fret space from the
// next-higher target for its very lowest note(s), then landing on its own
// natural target for the rest of its range:
//   string 0 (C#) -> natural E: frets 0,1,2 (C#,D,Eb) can't reach E's
//     non-negative range, cascade down to B (frets 2,3,4); fret 3+ (E and
//     up) stays on the natural E target.
//   string 1 (G#) -> natural A: fret 0 (G#) cascades down to E (fret 4);
//     fret 1+ (A and up) stays on the natural A target.
//   string 2 (C#) -> natural D: fret 0 (C#) cascades down to A (fret 4);
//     fret 1+ (D and up) stays on the natural D target.
//   string 3 (F#) -> natural G: fret 0 (F#) cascades down to D (fret 4);
//     fret 1+ (G and up) stays on the natural G target.
// This is the SAME general algorithm as Drop D, just with every string
// (not only the lowest) needing its own one-fret cascade at the bottom of
// its range — nothing here is a special case for this specific tuning.
{
    const ctx = songContext(4, [-3, -1, -1, -1], 0);
    assert.strictEqual(ctx.k, 1, `Drop-C# arrangement shift: expected k=1, got ${ctx.k}`); passed++;

    const [midi0, midi1, midi2, midi3] = ctx.sourceOpenMidiByString;
    const [nat0, nat1, nat2, nat3] = ctx.naturalTargetByString;

    check('Drop-C# string0 f=0 (C#) cascades to B', remapNote(midi0, nat0, 0), { s: 0, f: 2 });
    check('Drop-C# string0 f=1 (D) cascades to B', remapNote(midi0, nat0, 1), { s: 0, f: 3 });
    check('Drop-C# string0 f=2 (Eb) cascades to B', remapNote(midi0, nat0, 2), { s: 0, f: 4 });
    check('Drop-C# string0 f=3 (E, crossover onto natural E target)', remapNote(midi0, nat0, 3), { s: 1, f: 0 });
    for (let f = 3; f <= 20; f++) {
        check(`Drop-C# string0 f=${f} stays on its natural (E) target`, remapNote(midi0, nat0, f), { s: 1, f: f - 3 });
    }

    check('Drop-C# string1 f=0 (G#) cascades to E', remapNote(midi1, nat1, 0), { s: 1, f: 4 });
    check('Drop-C# string1 f=1 (A, crossover onto natural A target)', remapNote(midi1, nat1, 1), { s: 2, f: 0 });
    for (let f = 1; f <= 20; f++) {
        check(`Drop-C# string1 f=${f} stays on its natural (A) target`, remapNote(midi1, nat1, f), { s: 2, f: f - 1 });
    }

    check('Drop-C# string2 f=0 (C#) cascades to A', remapNote(midi2, nat2, 0), { s: 2, f: 4 });
    check('Drop-C# string2 f=1 (D, crossover onto natural D target)', remapNote(midi2, nat2, 1), { s: 3, f: 0 });
    for (let f = 1; f <= 20; f++) {
        check(`Drop-C# string2 f=${f} stays on its natural (D) target`, remapNote(midi2, nat2, f), { s: 3, f: f - 1 });
    }

    check('Drop-C# string3 f=0 (F#) cascades to D', remapNote(midi3, nat3, 0), { s: 3, f: 4 });
    check('Drop-C# string3 f=1 (G, crossover onto natural G target)', remapNote(midi3, nat3, 1), { s: 4, f: 0 });
    for (let f = 1; f <= 20; f++) {
        check(`Drop-C# string3 f=${f} stays on its natural (G) target`, remapNote(midi3, nat3, f), { s: 4, f: f - 1 });
    }
}

// 2. EADG identity: every note shifts string index +1, fret unchanged.
{
    const ctx = songContext(4, [0, 0, 0, 0], 0);
    assert.strictEqual(ctx.k, 1, `EADG arrangement shift: expected k=1, got ${ctx.k}`); passed++;
    for (let s = 0; s < 4; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`EADG identity s=${s} f=${f}`, remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s: s + 1, f });
        }
    }
}

// 3. BEAD identity: completely unchanged (BEAD = EADG shifted down a fourth).
{
    const ctx = songContext(4, [-5, -5, -5, -5], 0);
    assert.strictEqual(ctx.k, 0, `BEAD arrangement shift: expected k=0, got ${ctx.k}`); passed++;
    for (let s = 0; s < 4; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`BEAD identity s=${s} f=${f}`, remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s, f });
        }
    }
}

// 4. Already-BEADG identity.
{
    const ctx = songContext(5, [0, 0, 0, 0, 0], 0);
    assert.strictEqual(ctx.k, 0, `Already-BEADG arrangement shift: expected k=0, got ${ctx.k}`); passed++;
    for (let s = 0; s < 5; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`Already-BEADG identity s=${s} f=${f}`, remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f), { s, f });
        }
    }
}

// 5. Out-of-range drop.
{
    check('below open B drops', remapNote(22, 0, 0), null);
    check('above fret 20 on G drops', remapNote(43, 4, 21), null);
}

// Slide notes.
{
    // sourceOpenMidi = 28 exactly matches the target E string (adjustment
    // 0 when anchored there) on a source string whose natural target is
    // already E (naturalTargetString = 1).
    const midi = 28, natural = 1;
    const lowToHigh = remapSlide(midi, natural, 18, 25);
    check('low-to-high slide anchors on lower fret, clamps far end', lowToHigh, { s: 1, f: 18, slideTo: 20 });
    const highToLow = remapSlide(midi, natural, 25, 18);
    check('high-to-low slide anchors on the (lower) destination fret', highToLow, { s: 1, f: 20, slideTo: 18 });
}

// Chord collision resolution (Phase 3). Two source strings sharing the same
// open-string MIDI pitch (33) and the same natural target (2) both resolve
// to target string 2:
//   noteA {s:0,f:5} -> target {s:2,f:5}, rank 33+5=38
//   noteB {s:1,f:2} -> target {s:2,f:2}, rank 33+2=35 (lower, survives)
// A third, non-colliding note on a different source string/natural target
// is untouched.
{
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const noteA = { s: 0, f: 5 };
    const noteB = { s: 1, f: 2 };
    const noteC = { s: 2, f: 0 };
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, [noteA, noteB, noteC]);
    const bySourceString = new Map(survivors.map(x => [x.note.s, x]));

    assert.strictEqual(survivors.length, 2, `expected 2 survivors, got ${survivors.length}`);
    passed++;
    assert.ok(!bySourceString.has(0), 'colliding higher-pitched note (source string 0) should be dropped');
    passed++;
    check('colliding lower-pitched note (source string 1) keeps its own remap',
        bySourceString.get(1).entry, { s: 2, f: 2 });
    check('non-colliding note (source string 2) is untouched',
        bySourceString.get(2).entry, { s: 3, f: 0 });
}

// Anchor remapping (feedback: the "hand position" highlight band tracked
// the chart's original fret numbers, not the remapped ones). Exercises
// FSE.remapAnchors directly. Open-string notes are excluded from the donor
// pool since their adjustment comes from a different fallback target
// string than surrounding fretted notes on the same source string.
{
    // Drop-D dropped string (adjustment +3 for its low notes, -2 for its
    // "natural E" notes from fret 2 up — see test 1 above) drives two
    // anchors: one aligned with a low note (uses the +3 shift), one aligned
    // with a note past the crossover (uses the -2 shift). A third anchor
    // sits after the last note entirely and must fall back to that last
    // note's shift instead of going unremapped.
    const remappedNotes = [
        { t: 0, f: 4, _origNote: { t: 0, f: 1 } },   // Eb open-string-drop note, adjustment +3
        { t: 1, f: 5, _origNote: { t: 1, f: 7 } },   // past crossover, adjustment -2
    ];
    const anchors = [
        { time: 0, fret: 1, width: 4 },   // aligns with the first note (adjustment +3)
        { time: 1, fret: 7, width: 4 },   // aligns with the second note (adjustment -2)
        { time: 5, fret: 10, width: 4 },  // after the last note — falls back to its shift (-2)
    ];
    const remapped = remapAnchors(anchors, remappedNotes);
    check('anchor aligned with a low-note-shift note', remapped[0], { time: 0, fret: 4, width: 4 });
    check('anchor aligned with a natural-target-shift note', remapped[1], { time: 1, fret: 5, width: 4 });
    check('anchor after the last note falls back to its shift', remapped[2], { time: 5, fret: 8, width: 4 });

    // Clamped rather than going negative/over 20.
    const clampLow = remapAnchors([{ time: 0, fret: 0, width: 4 }], [{ t: 0, f: 0, _origNote: { t: 0, f: 3 } }]);
    check('anchor clamps at fret 0', clampLow[0], { time: 0, fret: 0, width: 4 });
    const clampHigh = remapAnchors([{ time: 0, fret: TARGET_MAX_FRET - 1, width: 4 }], [{ t: 0, f: TARGET_MAX_FRET, _origNote: { t: 0, f: 0 } }]);
    check('anchor clamps at fret 20', clampHigh[0], { time: 0, fret: TARGET_MAX_FRET, width: 4 });

    // No notes survived at all — pass through unchanged rather than throw.
    const passthrough = remapAnchors([{ time: 0, fret: 5, width: 4 }], []);
    check('anchor passes through unchanged with no surviving notes', passthrough[0], { time: 0, fret: 5, width: 4 });

    // Open-string donor is skipped in favor of the next fretted note.
    const openDonorNotes = [
        { t: 0, f: 3, _origNote: { t: 0, f: 4 } },   // fretted, adjustment -1
        { t: 1, f: 4, _origNote: { t: 1, f: 0 } },   // open string, adjustment +4 (fallback string)
        { t: 2, f: 6, _origNote: { t: 2, f: 7 } },   // fretted, adjustment -1
    ];
    const openDonorAnchors = [
        { time: 0, fret: 3, width: 4 },   // before the open note — should use the -1 fretted donor
        { time: 1, fret: 8, width: 4 },   // aligned with the open note — should skip it for the next fretted donor
    ];
    const remappedOpenDonor = remapAnchors(openDonorAnchors, openDonorNotes);
    check('anchor before open-string note uses fretted-note adjustment', remappedOpenDonor[0], { time: 0, fret: 2, width: 4 });
    check('anchor aligned with open-string note skips it for the next fretted donor', remappedOpenDonor[1], { time: 1, fret: 7, width: 4 });
}

// Collision resolution for simultaneous notes that AREN'T wrapped in a
// Chord object (feedback: a bass "double stop" is often encoded as two
// independent Note entries sharing an onset time, not a Chord — arr.notes
// and arr.chords are separate lists in lib/song.py). Mirrors the grouping
// FSE.createRetuner()'s apply() applies to bundle.notes: group by exact
// onset time, run each group (including ordinary singletons) through
// resolveChordCollisions, exactly like a real chord's own `.notes` array.
{
    const sourceOpenMidiByString = [33, 33, 38]; // same fixture as the chord collision test
    const naturalTargetByString = [2, 2, 3];
    const noteA = { t: 5, s: 0, f: 5 };  // collides with noteB, higher pitch -> dropped
    const noteB = { t: 5, s: 1, f: 2 };  // collides with noteA, lower pitch -> survives
    const noteC = { t: 5, s: 2, f: 0 };  // same instant, non-colliding -> untouched
    const noteD = { t: 6, s: 2, f: 3 };  // different instant, its own singleton group

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
    assert.ok(!atT5.some(n => n.origS === 0), 'colliding higher-pitched flat note (source string 0) should be dropped');
    passed++;
    check('flat-notes collision: lower-pitched note keeps its own remap',
        atT5.find(n => n.origS === 1), { t: 5, s: 2, f: 2, origS: 1 });
    check('flat-notes collision: non-colliding same-instant note is untouched',
        atT5.find(n => n.origS === 2), { t: 5, s: 3, f: 0, origS: 2 });
    check('flat-notes collision: a different-instant singleton is unaffected',
        atT6[0], { t: 6, s: 3, f: 3, origS: 2 });
}

// Chord template remapping (feedback: two note gems on the same target
// string, different frets, inside what looked like a normal chord
// indicator — the actual chart had ZERO real Chord objects; the "chord"
// was entirely synthesized from a hand-shape + this chord template's raw,
// un-remapped frets, misread as target-string indices). Exercises
// FSE.remapChordTemplate/remapChordTemplates directly.
{
    // The EXACT real-world case: Black Veil Brides "In the End", bass.json,
    // Drop C# tuning [-3,-1,-1,-1] (verified test 1b above: k=+1, string0's
    // natural target E, adjustment +3 for its low notes / -3 past the
    // crossover at fret 3; string1's natural target A, adjustment +4 / -1
    // past its crossover at fret 1). Real notes at this moment: (s:0,f:6)
    // and (s:1,f:7) — the SAME pair this chord template encodes.
    const ctx = songContext(4, [-3, -1, -1, -1], 0);
    const template = { name: '', displayName: '', frets: [6, 7, -1, -1, -1, -1], fingers: [1, 2, -1, -1, -1, -1] };
    const remapped = remapChordTemplate(ctx.sourceOpenMidiByString, ctx.naturalTargetByString, template);
    // (s:0,f:6): natural target E (index1), f=6 >= crossover fret 3 -> stays on E, fret 6-3=3.
    // (s:1,f:7): natural target A (index2), f=7 >= crossover fret 1 -> stays on A, fret 7-1=6.
    check('real-chart chord template: fret array remapped to target indices', remapped.frets, [-1, 3, 6, -1, -1]);
    check('real-chart chord template: fingers relocate to the same new indices', remapped.fingers, [-1, 1, 2, -1, -1]);
    check('real-chart chord template: name/displayName pass through unchanged', {
        name: remapped.name, displayName: remapped.displayName,
    }, { name: '', displayName: '' });

    // This is exactly what fixes the reported bug: the real note at
    // (s:0,f:6) independently remaps (via the normal note path, test 1b)
    // to { s: 1, f: 3 } — matching this template's frets[1] exactly, instead
    // of the template showing a stale raw fret 7 on target string 1.
    const midi0 = ctx.sourceOpenMidiByString[0], nat0 = ctx.naturalTargetByString[0];
    check('template stays consistent with the real note it was authored from',
        remapNote(midi0, nat0, 6), { s: remapped.frets.indexOf(3), f: 3 });
}

{
    // Collision within a single template: two original strings whose
    // remapped frets land on the same target string — must resolve exactly
    // like a real chord's notes (keep the lower-pitched one).
    const sourceOpenMidiByString = [33, 33, 38];
    const naturalTargetByString = [2, 2, 3];
    const template = { frets: [5, 2, 0, -1], fingers: null }; // s0->target2 f5 (rank38), s1->target2 f2 (rank35, lower), s2->target3 f0
    const remapped = remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template);
    check('colliding template slots: only the lower-pitched survivor is kept', remapped.frets, [-1, -1, 2, 0, -1]);
    check('colliding template with no fingers array passes fingers through as-is', remapped.fingers, null);
}

{
    // Array wrapper preserves chord_id indexing (templates are looked up by
    // array index elsewhere in the file, e.g. chordTemplates[ch.id]).
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

// Custom target tuning (feedback: some 5-string bassists tune AEADG or a
// half-step-flat BbEbAbDbGb rather than BEADG — the target must be
// user-configurable, not just the source). parseTargetNote / resolveTargetTuning.
{
    check('parseTargetNote: natural note + octave 0', parseTargetNote('B0'), { midi: 23, label: 'B' });
    check('parseTargetNote: sharp, lowercase letter', parseTargetNote('f#2'), { midi: 42, label: 'F#' });
    check('parseTargetNote: flat', parseTargetNote('Bb1'), { midi: 34, label: 'Bb' });
    check('parseTargetNote: negative octave', parseTargetNote('A-1'), { midi: 9, label: 'A' });
    check('parseTargetNote: rejects garbage', parseTargetNote('H0'), null);
    check('parseTargetNote: rejects missing octave', parseTargetNote('B'), null);
    check('parseTargetNote: rejects non-string', parseTargetNote(undefined), null);

    // Full BEADG spec round-trips to the same values as the built-in default.
    const beadg = resolveTargetTuning(DEFAULT_TARGET_TUNING);
    check('resolveTargetTuning(BEADG) midi matches the built-in default', beadg.midiTuning, DEFAULT_TARGET_MIDI_TUNING);
    check('resolveTargetTuning(BEADG) labels', beadg.labels, ['B', 'E', 'A', 'D', 'G']);

    // Per-string fallback: a malformed entry degrades just that string
    // rather than the whole tuning.
    const partial = resolveTargetTuning(['B0', 'garbage', 'A1', 'D2', 'G2']);
    check('resolveTargetTuning: malformed string falls back to BEADG default for that slot only',
        partial.midiTuning, [23, 28, 33, 38, 43]);

    // Non-array spec (not even an array) falls back to BEADG entirely.
    check('resolveTargetTuning: non-array spec falls back to full BEADG default',
        resolveTargetTuning(null).midiTuning, DEFAULT_TARGET_MIDI_TUNING);

    // Short array (still an array, just missing trailing entries): the
    // PROVIDED slots are kept as given, only the missing ones fall back —
    // same per-slot contract as the malformed-entry case above, not a
    // "whole spec discarded" special case. Deliberately uses non-BEADG
    // values for the provided slots so this is distinguishable from that
    // per-slot fallback reconstructing BEADG by coincidence (as it would
    // if this used 'B0'/'E1', which already equal the BEADG defaults for
    // those two positions).
    const short = resolveTargetTuning(['A0', 'F1']);
    check('resolveTargetTuning: short array keeps its provided slots',
        short.midiTuning, [21, 29, 33, 38, 43]);
    check('resolveTargetTuning: short array per-slot-falls-back the missing slots to BEADG',
        short.labels, ['A', 'F', 'A', 'D', 'G']);
}

// AEADG target (drops only the lowest open string a whole step below
// BEADG's B0->A0; upper four strings E/A/D/G unchanged) — a 4-string EADG
// source should land identically to the BEADG-target EADG-identity test
// above (strings 1-4, fret unchanged), since the target's own string-0
// pitch never enters that computation for a source that never reaches it.
{
    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    check('AEADG target labels', aeadg.labels, ['A', 'E', 'A', 'D', 'G']);
    const ctx = songContext(4, [0, 0, 0, 0], 0, aeadg.midiTuning);
    assert.strictEqual(ctx.k, 1, `AEADG target, EADG source arrangement shift: expected k=1, got ${ctx.k}`); passed++;
    for (let s = 0; s < 4; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`AEADG target EADG source s=${s} f=${f}`,
                remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, aeadg.midiTuning), { s: s + 1, f });
        }
    }

    // A 5-string source already tuned AEADG is a full identity onto the
    // AEADG target (mirrors the already-BEADG identity test above, just
    // on a different target).
    const ctx5 = songContext(5, [-2, 0, 0, 0, 0], 0, aeadg.midiTuning); // 5-string standard base is BEADG; -2 on string 0 (B0->A0, a whole step)
    assert.strictEqual(ctx5.k, 0, `AEADG identity arrangement shift: expected k=0, got ${ctx5.k}`); passed++;
    for (let s = 0; s < 5; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`AEADG identity s=${s} f=${f}`,
                remapNote(ctx5.sourceOpenMidiByString[s], ctx5.naturalTargetByString[s], f, aeadg.midiTuning), { s, f });
        }
    }
}

// BbEbAbDbGb target (every string a half-step flat of BEADG) — a 5-string
// source tuned identically is a full identity remap, exercising
// computeArrangementShift/remapNote/resolveChordCollisions all the way
// through the optional targetMidiTuning parameter.
{
    const flat = resolveTargetTuning(['Bb0', 'Eb1', 'Ab1', 'Db2', 'Gb2']);
    check('BbEbAbDbGb target midi', flat.midiTuning, [22, 27, 32, 37, 42]);
    check('BbEbAbDbGb target labels', flat.labels, ['Bb', 'Eb', 'Ab', 'Db', 'Gb']);
    const ctx = songContext(5, [-1, -1, -1, -1, -1], 0, flat.midiTuning);
    assert.strictEqual(ctx.k, 0, `BbEbAbDbGb identity arrangement shift: expected k=0, got ${ctx.k}`); passed++;
    for (let s = 0; s < 5; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`BbEbAbDbGb identity s=${s} f=${f}`,
                remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, flat.midiTuning), { s, f });
        }
    }

    // Chord-collision resolution also threads the custom target through
    // correctly (mirrors the default-target collision test above).
    const sourceOpenMidiByString = [32, 32, 37]; // two strings sharing Ab1 (target index 2), one at Db2 (target index 3)
    const naturalTargetByString = [2, 2, 3];
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString,
        [{ s: 0, f: 5 }, { s: 1, f: 2 }, { s: 2, f: 0 }], flat.midiTuning);
    check('custom-target chord collision: 2 of 3 notes survive', survivors.length, 2);
    check('custom-target chord collision: lower-pitched note wins the shared slot',
        survivors.find(x => x.note.s === 1).entry, { s: 2, f: 2 });
}

// createRetuner().apply(bundle, targetMidiTuning) end-to-end, including cache
// invalidation when the active target tuning changes (feedback: switching
// tunings mid-session, e.g. via the settings picker, must not serve a
// stale remap from a previous tuning for the same unchanged chart data).
{
    const { createRetuner } = FSE;
    const retuner = createRetuner();
    // Fixed raw chart references — core re-supplies these SAME array
    // references on bundle.notes/etc. every frame for an unchanged song
    // (only reference-swapped when the chart itself changes), overwriting
    // whatever the previous frame's apply() call left there. Simulate that
    // per-frame reset explicitly rather than letting the test reuse
    // apply()'s own prior output as if it were fresh raw input.
    const rawNotes = [{ t: 0, s: 0, f: 0 }];
    const rawChords = [], rawAnchors = [], rawTemplates = [];
    const bundle = {
        notes: rawNotes,
        chords: rawChords,
        anchors: rawAnchors,
        chordTemplates: rawTemplates,
        tuning: [0, 0, 0, 0, 0], // 5-string BEADG-standard-base source, no offsets
        capo: 0,
        stringCount: 5,
    };
    retuner.apply(bundle); // default (BEADG) target
    check('createRetuner default target: identity remap of the open low string', { s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });
    const beforeAeadg = bundle.notes[0];

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes; // simulate core re-supplying the pristine raw array next frame
    retuner.apply(bundle, aeadg.midiTuning);
    // Source string 0 is B0 (standard 5-string base, no offset); against an
    // AEADG target its natural/best target is still index 0 (A0), but B0 is
    // a whole step above A0, so it lands at fret 2, not fret 0.
    check('createRetuner: changing target tuning invalidates the cache and re-remaps', bundle.notes[0].f, 2);
    assert.notStrictEqual(bundle.notes[0], beforeAeadg, 'a target-tuning change must not reuse the previous remap object'); passed++;

    // Re-applying the ORIGINAL (default) target on the same unchanged chart
    // data must also bust the cache and restore the original remap, not
    // serve the AEADG-target result.
    bundle.notes = rawNotes;
    retuner.apply(bundle);
    check('createRetuner: switching back to the default target re-remaps correctly', bundle.notes[0].f, 0);
}

// Requirement: switching the active tuning mid-playthrough must re-add a
// note that was previously dropped as unplayable, if it's now in range
// under the new target — not just change already-kept notes' frets (the
// block above). Real scenario: a chart for an AEADG-tuned bass (tuning =
// [-2,0,0,0,0], open low string = A0) is unplayable on a BEADG target (A0
// is a whole step BELOW BEADG's lowest open note, B0 — there's no negative
// fret to reach it) but is a perfect identity match on an AEADG target.
{
    const { createRetuner } = FSE;
    const retuner = createRetuner();
    const rawNotes = [{ t: 0, s: 0, f: 0 }]; // open low string
    const bundle = {
        notes: rawNotes, chords: [], anchors: [], chordTemplates: [],
        tuning: [-2, 0, 0, 0, 0], capo: 0, stringCount: 5,
    };

    retuner.apply(bundle); // default (BEADG) target
    check('un-drop test: open low A is unplayable on the BEADG target and gets dropped', bundle.notes.length, 0);

    const aeadg = resolveTargetTuning(['A0', 'E1', 'A1', 'D2', 'G2']);
    bundle.notes = rawNotes; // simulate core's per-frame reset (see the cache-invalidation test above)
    retuner.apply(bundle, aeadg.midiTuning);
    check('un-drop test: switching to the AEADG target re-adds the note, no longer dropped', bundle.notes.length, 1);
    check('un-drop test: re-added note is an exact identity match', { s: bundle.notes[0].s, f: bundle.notes[0].f }, { s: 0, f: 0 });

    // Switching back to BEADG drops it again — proving this is a
    // stateless full re-evaluation every time, not a one-way "un-drop".
    bundle.notes = rawNotes;
    retuner.apply(bundle);
    check('un-drop test: switching back to BEADG drops the note again', bundle.notes.length, 0);
}

// Duplicate note+octave across strings is allowed (feedback: e.g. an
// intentional unison pair on some basses/tunings) — no uniqueness
// constraint exists anywhere in the engine; every target string is looked
// up independently by its own index, never by searching for "the" string
// matching a given pitch.
{
    const dup = resolveTargetTuning(['B0', 'B0', 'A1', 'D2', 'G2']);
    check('duplicate-note target midiTuning', dup.midiTuning, [23, 23, 33, 38, 43]);
    check('duplicate-note target labels', dup.labels, ['B', 'B', 'A', 'D', 'G']);

    // The same source pitch lands correctly on EITHER duplicate slot,
    // depending purely on which target string it naturally belongs to.
    check('duplicate target: source lands on the first B0 slot',
        remapNote(23, 0, 0, dup.midiTuning), { s: 0, f: 0 });
    check('duplicate target: source lands on the second B0 slot',
        remapNote(23, 1, 0, dup.midiTuning), { s: 1, f: 0 });

    // Two chord notes that each naturally resolve to their OWN
    // duplicate-pitch target string are two independent target strings,
    // not a collision — collision resolution keys on target STRING INDEX,
    // never on the resulting pitch, so two unison strings never spuriously
    // eat each other's notes.
    const survivors = resolveChordCollisions([23, 23], [0, 1], [{ s: 0, f: 0 }, { s: 1, f: 0 }], dup.midiTuning);
    check('duplicate target: both unison notes survive as independent target strings', survivors.length, 2);
}

// Irregular-interval target tuning (feedback: don't assume adjacent target
// strings are always a fourth or fifth apart — the algorithm must work for
// ANY per-string target pitches, uniform or not). Target = B0,E1,A1,D2,F#2:
// the first three intervals are the usual fourth (5 half-steps), but the
// last (D2->F#2) is a major third (4 half-steps) — deliberately irregular.
{
    const irregular = resolveTargetTuning(['B0', 'E1', 'A1', 'D2', 'F#2']);
    check('irregular target midiTuning', irregular.midiTuning, [23, 28, 33, 38, 42]);

    // A standard BEADG-base 5-string source (no offsets) still lands via
    // ordinary identity math on strings 0-3 (matching fourths) and via the
    // ACTUAL (not an assumed uniform) +1 adjustment on string 4, where the
    // irregular interval lives.
    const ctx = songContext(5, [0, 0, 0, 0, 0], 0, irregular.midiTuning);
    assert.strictEqual(ctx.k, 0, `irregular target arrangement shift: expected k=0, got ${ctx.k}`); passed++;
    for (let s = 0; s < 4; s++) {
        for (let f = 0; f <= 20; f++) {
            check(`irregular target identity s=${s} f=${f}`,
                remapNote(ctx.sourceOpenMidiByString[s], ctx.naturalTargetByString[s], f, irregular.midiTuning), { s, f });
        }
    }
    // String 4 (source open G2=43) against target string 4 (F#2=42):
    // adjustment = +1, so fret 0 (open G) actually lands on fret 1, not 0.
    check('irregular target: string 4 open note offset by the real (non-fourth) interval',
        remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 0, irregular.midiTuning), { s: 4, f: 1 });
    check('irregular target: string 4 fret 19 -> 20 (top of range)',
        remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 19, irregular.midiTuning), { s: 4, f: 20 });
    check('irregular target: string 4 fret 20 overflows (no 6th string to cascade to) and drops',
        remapNote(ctx.sourceOpenMidiByString[4], ctx.naturalTargetByString[4], 20, irregular.midiTuning), null);

    // Cascade from string 3 into string 4 must use the REAL 4-half-step
    // D2->F#2 interval, not an assumed 5 — hand-verified: source string 3
    // (D2=38) sounding at a synthetic out-of-range "fret 21" probe is
    // pitch 59; on target string 4 (F#2=42) that's fret 59-42=17, not the
    // 16 a hardcoded-fourth assumption would produce.
    check('irregular target: cascade uses the actual interval, not an assumed fourth/fifth',
        resolveTargetForFret(38, 3, 21, irregular.midiTuning), { s: 4, f: 17, adjustment: -4 });
}

console.log(`OK - ${passed} assertions passed`);
