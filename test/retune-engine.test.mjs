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
    computeOpenStringMidiByString,
    computeArrangementShift,
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
function songContext(sourceStringCount, tuning, capo) {
    const sourceOpenMidiByString = computeOpenStringMidiByString(sourceStringCount, tuning, capo);
    const k = computeArrangementShift(sourceStringCount, tuning, capo, sourceOpenMidiByString);
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

console.log(`OK - ${passed} assertions passed`);
