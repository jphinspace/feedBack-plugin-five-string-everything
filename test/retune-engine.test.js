// Standalone Node verification for the string/fret offset transformation
// engine (PLANNING.md Phase 2/3). Mirrors the `FSE` block near the top of
// screen.js — no test framework, no DOM/THREE dependency, run directly with
// `node test/retune-engine.test.js`. Keep this in sync with screen.js's FSE
// block if that logic changes.
'use strict';
const assert = require('assert');

const STANDARD_OPEN_STRING_HALFSTEPS = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};
const TARGET_OPEN_STRING_HALFSTEPS = [23, 28, 33, 38, 43]; // B0 E1 A1 D2 G2
const TARGET_MAX_FRET = 20;

function standardOpenStringHalfsteps(stringCount) {
    return STANDARD_OPEN_STRING_HALFSTEPS[stringCount] || STANDARD_OPEN_STRING_HALFSTEPS[6];
}
function sourceOpenStringOffset(sourceStringCount, tuningOffsets, capo, s) {
    if (!tuningOffsets || !(s >= 0 && s < tuningOffsets.length)) return null;
    const base = standardOpenStringHalfsteps(sourceStringCount);
    const root = s < base.length ? base[s] : base[base.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0);
}
function bestTargetCandidate(sourceOpenOffset, fret) {
    if (sourceOpenOffset === null || sourceOpenOffset === undefined) return null;
    let best = null;
    for (let ts = 0; ts < TARGET_OPEN_STRING_HALFSTEPS.length; ts++) {
        const adjustment = sourceOpenOffset - TARGET_OPEN_STRING_HALFSTEPS[ts];
        const targetFret = fret + adjustment;
        if (targetFret < 0 || targetFret > TARGET_MAX_FRET) continue;
        if (best === null || Math.abs(adjustment) < Math.abs(best.adjustment)) {
            best = { s: ts, f: targetFret, adjustment };
        }
    }
    return best;
}
function remapNote(sourceOpenOffset, fret) {
    const best = bestTargetCandidate(sourceOpenOffset, fret);
    return best ? { s: best.s, f: best.f } : null;
}
function remapSlide(sourceOpenOffset, fret, slideToFret) {
    if (sourceOpenOffset === null || sourceOpenOffset === undefined) return null;
    const lowFret = Math.min(fret, slideToFret);
    const highFret = Math.max(fret, slideToFret);
    let anchor = bestTargetCandidate(sourceOpenOffset, lowFret);
    if (!anchor) anchor = bestTargetCandidate(sourceOpenOffset, highFret);
    if (!anchor) return null;
    const clamp = v => Math.max(0, Math.min(TARGET_MAX_FRET, v));
    return { s: anchor.s, f: clamp(fret + anchor.adjustment), slideTo: clamp(slideToFret + anchor.adjustment) };
}
function noteHalfstepRank(sourceOpenOffset, fret) {
    return sourceOpenOffset + fret;
}
function remapNoteEntry(sourceOpenOffset, note) {
    const hasSl = Number.isInteger(note.sl) && note.sl >= 0;
    const hasSlu = !hasSl && Number.isInteger(note.slu) && note.slu >= 0;
    if (hasSl || hasSlu) {
        const dest = hasSl ? note.sl : note.slu;
        const r = remapSlide(sourceOpenOffset, note.f, dest);
        if (!r) return null;
        const out = { s: r.s, f: r.f };
        if (hasSl) out.sl = r.slideTo; else out.slu = r.slideTo;
        return out;
    }
    return remapNote(sourceOpenOffset, note.f);
}
function resolveChordCollisions(offsetsByString, notes) {
    const candidates = [];
    for (const note of notes) {
        const off = offsetsByString[note.s];
        if (off === null || off === undefined) continue;
        const entry = remapNoteEntry(off, note);
        if (!entry) continue;
        candidates.push({ entry, note, rank: noteHalfstepRank(off, note.f) });
    }
    const bySlot = new Map();
    for (const c of candidates) {
        const prev = bySlot.get(c.entry.s);
        if (!prev || c.rank < prev.rank) bySlot.set(c.entry.s, c);
    }
    return Array.from(bySlot.values()).map(c => ({ entry: c.entry, note: c.note }));
}

let passed = 0;
function check(label, actual, expected) {
    assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    passed++;
}

// 1. Drop-D worked example, full chart. tuning = [-2,0,0,0], capo = 0.
{
    const tuning = [-2, 0, 0, 0], capo = 0, sc = 4;
    // Untouched strings (A, D, G) shift string index +1, fret unchanged.
    for (let f = 0; f <= 20; f++) {
        const offA = sourceOpenStringOffset(sc, tuning, capo, 1);
        check(`Drop-D A string f=${f}`, remapNote(offA, f), { s: 2, f });
        const offD = sourceOpenStringOffset(sc, tuning, capo, 2);
        check(`Drop-D D string f=${f}`, remapNote(offD, f), { s: 3, f });
        const offG = sourceOpenStringOffset(sc, tuning, capo, 3);
        check(`Drop-D G string f=${f}`, remapNote(offG, f), { s: 4, f });
    }
    // Dropped string: crossover at fret 2.
    const off0 = sourceOpenStringOffset(sc, tuning, capo, 0);
    check('Drop-D dropped string f=0 (D open)', remapNote(off0, 0), { s: 0, f: 3 });
    check('Drop-D dropped string f=1 (Eb, original example)', remapNote(off0, 1), { s: 0, f: 4 });
    check('Drop-D dropped string f=2 (E, crossover)', remapNote(off0, 2), { s: 1, f: 0 });
    for (let f = 2; f <= 20; f++) {
        check(`Drop-D dropped string f=${f}`, remapNote(off0, f), { s: 1, f: f - 2 });
    }
}

// 2. EADG identity: every note shifts string index +1, fret unchanged.
{
    const tuning = [0, 0, 0, 0], capo = 0, sc = 4;
    for (let s = 0; s < 4; s++) {
        const off = sourceOpenStringOffset(sc, tuning, capo, s);
        for (let f = 0; f <= 20; f++) {
            check(`EADG identity s=${s} f=${f}`, remapNote(off, f), { s: s + 1, f });
        }
    }
}

// 3. BEAD identity: completely unchanged (BEAD = EADG shifted down a fourth).
{
    const tuning = [-5, -5, -5, -5], capo = 0, sc = 4;
    for (let s = 0; s < 4; s++) {
        const off = sourceOpenStringOffset(sc, tuning, capo, s);
        for (let f = 0; f <= 20; f++) {
            check(`BEAD identity s=${s} f=${f}`, remapNote(off, f), { s, f });
        }
    }
}

// 4. Already-BEADG identity.
{
    const tuning = [0, 0, 0, 0, 0], capo = 0, sc = 5;
    for (let s = 0; s < 5; s++) {
        const off = sourceOpenStringOffset(sc, tuning, capo, s);
        for (let f = 0; f <= 20; f++) {
            check(`Already-BEADG identity s=${s} f=${f}`, remapNote(off, f), { s, f });
        }
    }
}

// 5. Out-of-range drop.
{
    // One half-step below open B (offset 22) on a hypothetical single-string
    // source: no target string can produce a fret >= 0.
    check('below open B drops', remapNote(22, 0), null);
    // One half-step above fret 20 on the G string (offset 43): fret 21 on
    // string 4 is the only "candidate" and it's out of range.
    check('above fret 20 on G drops', remapNote(43, 21), null);
}

// Slide notes.
{
    // sourceOpenOffset = 28 exactly matches the target E string (adjustment
    // 0 when anchored there) — chosen so the anchor fret passes through
    // unchanged and only the overflowing endpoint needs clamping.
    // bestTargetCandidate(28, 18): adjustments 28-[23,28,33,38,43] =
    // [5,0,-5,-10,-15]; targetFret = 18+adj = [23,18,13,8,3]; j0(23) is
    // invalid (>20), so among valid candidates the smallest |adjustment| is
    // j1 (E string, adjustment 0) -> anchor = { s: 1, adjustment: 0 }.
    const off = 28;

    // Low-to-high: starts at (low) fret 18, slides up to fret 25 — past the
    // neck. Anchor is chosen from the low end (18, unaffected by clamping);
    // the far end (25) must clamp down to 20 rather than being dropped.
    const lowToHigh = remapSlide(off, 18, 25);
    check('low-to-high slide anchors on lower fret, clamps far end', lowToHigh, { s: 1, f: 18, slideTo: 20 });

    // High-to-low: starts at (high) fret 25, slides down to fret 18 — the
    // destination. Anchoring on the lower (destination) fret picks the same
    // target string as above; the (higher) start fret clamps to 20.
    const highToLow = remapSlide(off, 25, 18);
    check('high-to-low slide anchors on the (lower) destination fret', highToLow, { s: 1, f: 20, slideTo: 18 });
}

// Chord collision resolution (Phase 3). Two source strings sharing the same
// open-string offset (33) both independently prefer target string 2:
//   noteA {s:0,f:5} -> target {s:2,f:5}, rank 33+5=38
//   noteB {s:1,f:2} -> target {s:2,f:2}, rank 33+2=35 (lower, survives)
// A third, non-colliding note on a different source string is untouched.
{
    const offsetsByString = [33, 33, 38];
    const noteA = { s: 0, f: 5 };
    const noteB = { s: 1, f: 2 };
    const noteC = { s: 2, f: 0 };
    const survivors = resolveChordCollisions(offsetsByString, [noteA, noteB, noteC]);
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

console.log(`OK - ${passed} assertions passed`);
