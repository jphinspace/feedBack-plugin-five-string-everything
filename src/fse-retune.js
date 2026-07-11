// Five-String Everything — string/fret offset transformation engine.
// Pure functions, no dependency on Three.js or screen.js's closure state.
// This module holds the plugin's own logic; screen.js (a fork of
// highway_3d/screen.js) imports it as the `FSE` namespace, so screen.js
// itself stays close to upstream for easy syncing.
//
// String/fret offset arithmetic: one fret = one half-step, and adjacent
// BEADG target strings are a perfect fourth apart = 5 half-steps. The
// tables below are fixed MIDI note references (same numbers as
// lib/song.py's _TUNING_BASE_MIDI).
//
// Loaded as a real ES module (plugin.json "scriptType":"module", served via
// feedBack core's /api/plugins/<id>/src/... route) — imported by both
// screen.js (browser) and test/retune-engine.test.mjs (Node), so there's
// exactly one copy of this logic.

// Standard open-string pitches as MIDI note numbers, low string first,
// keyed by source string count — e.g. 4: [28,33,38,43] is 4-string bass
// EADG (28 = E1); 6: [...] is 6-string guitar standard EADGBE (40 = E2).
// Reference point sourceOpenStringMidi (below) applies a chart's own
// tuning offsets/capo to.
const STANDARD_OPEN_STRING_MIDI = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [40, 45, 50, 55, 59, 64],
    7: [35, 40, 45, 50, 55, 59, 64],
    8: [30, 35, 40, 45, 50, 55, 59, 64],
};

// Fixed target: 5-string bass, standard BEADG, no capo. Index 0 = B, 4 = G.
const TARGET_OPEN_STRING_MIDI = [23, 28, 33, 38, 43]; // B0 E1 A1 D2 G2
const TARGET_STRING_COUNT = TARGET_OPEN_STRING_MIDI.length;
const TARGET_MAX_FRET = 20;

// Fretboard string labels for the fixed BEADG target.
const TARGET_OPEN_STRING_LABELS = ['B', 'E', 'A', 'D', 'G'];

// Falls back to the 6-string (guitar) table for a string count not listed
// above.
function standardOpenStringMidi(stringCount) {
    return STANDARD_OPEN_STRING_MIDI[stringCount] || STANDARD_OPEN_STRING_MIDI[6];
}

// MIDI note number of source string `s`'s open note under the chart's own
// tuning: the standard open pitch plus that string's tuning offset plus
// capo (e.g. standard low E at 28, tuned down 2 half-steps for Drop D,
// = 26 = D1). Constant per song per string — compute once, not per note.
function sourceOpenStringMidi(sourceStringCount, tuningOffsets, capo, s) {
    if (!tuningOffsets || !(s >= 0 && s < tuningOffsets.length)) return null;
    const base = standardOpenStringMidi(sourceStringCount);
    const root = s < base.length ? base[s] : base[base.length - 1];
    return root + (tuningOffsets[s] | 0) + (capo | 0);
}

// Every source string's open-note MIDI pitch, indexed by string. Compute
// once per song; computeArrangementShift and createRetuner() both read
// this instead of re-deriving each string's pitch independently.
function computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo) {
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
function computeArrangementShift(sourceStringCount, tuningOffsets, capo, sourceOpenMidiByString) {
    const midiByString = sourceOpenMidiByString || computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo);
    let bestK = 0, bestExact = -1, bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= TARGET_STRING_COUNT - 1; k++) {
        let exact = 0, totalAbs = 0, counted = 0;
        for (let s = 0; s < sourceStringCount; s++) {
            const j = s + k;
            if (j < 0 || j >= TARGET_STRING_COUNT) continue;
            const midi = midiByString[s];
            if (midi === null) continue;
            const adjustment = midi - TARGET_OPEN_STRING_MIDI[j];
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

// Resolves one (sourceOpenMidi, fret) pair against the target: starts from
// the arrangement's natural target string and steps toward whichever
// direction the out-of-range fret demands (fret < 0 -> lower string, fret
// > 20 -> higher string). Returns { s, f, adjustment } or null if
// unplayable on every reachable string.
//
// Anchoring on the natural string first keeps a big single-string drop
// (e.g. Drop C#, -3 half-steps) on its own string for every fret it can
// reach, falling back to the extra B string only where it must. An
// earlier version compared |adjustment| across all 5 strings globally and
// flipped to preferring B too early — correct for Drop D's -2 half-step
// drop, wrong for Drop C#'s -3.
function resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    let j = Math.max(0, Math.min(TARGET_STRING_COUNT - 1, naturalTargetString));
    while (j >= 0 && j < TARGET_STRING_COUNT) {
        const adjustment = sourceOpenMidi - TARGET_OPEN_STRING_MIDI[j];
        const targetFret = fret + adjustment;
        if (targetFret < 0) { j -= 1; continue; }
        if (targetFret > TARGET_MAX_FRET) { j += 1; continue; }
        return { s: j, f: targetFret, adjustment };
    }
    return null;
}

// Ordinary (non-sliding) note: { s, f } on the target, or null if dropped.
function remapNote(sourceOpenMidi, naturalTargetString, fret) {
    const best = resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret);
    return best ? { s: best.s, f: best.f } : null;
}

// Sliding note (slide_to/slide_unpitch_to, same string). Both endpoints
// must land on the SAME target string — independent per-fret remapping
// can split them, so anchor on whichever endpoint is lower (most likely
// in range), retrying on the higher endpoint if that fails. An
// overflowing slide clamps to fret 20 instead of dropping (unlike an
// ordinary out-of-range note).
function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const lowFret = Math.min(fret, slideToFret);
    const highFret = Math.max(fret, slideToFret);
    let anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, lowFret);
    if (!anchor) anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, highFret);
    if (!anchor) return null;
    const clamp = v => Math.max(0, Math.min(TARGET_MAX_FRET, v));
    return {
        s: anchor.s,
        f: clamp(fret + anchor.adjustment),
        slideTo: clamp(slideToFret + anchor.adjustment),
    };
}

// Half-step rank for comparing two notes' pitch order (chord collision
// resolution) — same MIDI arithmetic as above, summed once so "lower"/
// "higher" comparisons are a plain integer compare.
function noteHalfstepRank(sourceOpenMidi, fret) {
    return sourceOpenMidi + fret;
}

// Single entry point for both a standalone note and a chord note:
// dispatches to remapSlide when the note carries a slide (sl/slu default
// to -1 = "no slide"), otherwise remapNote. Returns { s, f } plus, only
// when present on the input, a remapped `sl` or `slu`.
function remapNoteEntry(sourceOpenMidi, naturalTargetString, note) {
    const hasSl = Number.isInteger(note.sl) && note.sl >= 0;
    const hasSlu = !hasSl && Number.isInteger(note.slu) && note.slu >= 0;
    if (hasSl || hasSlu) {
        const dest = hasSl ? note.sl : note.slu;
        const r = remapSlide(sourceOpenMidi, naturalTargetString, note.f, dest);
        if (!r) return null;
        const out = { s: r.s, f: r.f };
        if (hasSl) out.sl = r.slideTo; else out.slu = r.slideTo;
        return out;
    }
    return remapNote(sourceOpenMidi, naturalTargetString, note.f);
}

// Remaps every note independently, groups survivors by target string, and
// for any target string with more than one note keeps only the
// lower-pitched original — per colliding string, not the whole chord.
// `notes` is an array of note-shaped objects (`s`/`f`, optionally `sl`/
// `slu`). Returns { entry, note } per survivor, where `entry` is
// remapNoteEntry's result and `note` is the original input (for field
// passthrough and keying bundle.getNoteState).
function resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes) {
    const candidates = [];
    for (const note of notes) {
        const midi = sourceOpenMidiByString[note.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[note.s], note);
        if (!entry) continue;
        candidates.push({ entry, note, rank: noteHalfstepRank(midi, note.f) });
    }
    const bySlot = new Map();
    for (const c of candidates) {
        const prev = bySlot.get(c.entry.s);
        if (!prev || c.rank < prev.rank) bySlot.set(c.entry.s, c);
    }
    return Array.from(bySlot.values()).map(c => ({ entry: c.entry, note: c.note }));
}

// Remaps the chart's `anchors` array (RS2014 hand-position markers —
// { time, fret, width }) so the hand-position highlight band tracks the
// remapped fretboard.
//
// An anchor has no string of its own, and different strings can carry
// different adjustments (Drop C# gives every string a different one).
// `getChartAnchorAt` (screen.js) treats an anchor as describing the hand
// position for notes from its own time onward, so this borrows the
// adjustment of the nearest already-remapped note at or after the
// anchor's time (falling back to the note before it, or leaving the
// anchor unchanged when there are no notes at all). Open-string notes are
// excluded as donors — their adjustment can come from a different
// fallback string and wouldn't represent nearby fretted notes.
//
// `remappedNotes` and `anchors` must both be time-sorted (chart
// invariant); one shared forward-scanning pointer keeps this
// O(anchors + notes).
function remapAnchors(anchors, remappedNotes) {
    if (!Array.isArray(anchors) || anchors.length === 0) return anchors || [];
    if (!Array.isArray(remappedNotes) || remappedNotes.length === 0) return anchors.slice();
    const fretted = remappedNotes.filter(n => n._origNote.f > 0);
    const donors = fretted.length ? fretted : remappedNotes;
    const out = [];
    let ptr = 0;
    for (const a of anchors) {
        while (ptr < donors.length - 1 && donors[ptr].t < a.time) ptr++;
        const note = donors[ptr];
        const adjustment = note.f - note._origNote.f;
        const fret = Math.max(0, Math.min(TARGET_MAX_FRET, a.fret + adjustment));
        out.push({ time: a.time, fret, width: a.width });
    }
    return out;
}

// Remaps one chord template's `frets`/`fingers` (indexed by ORIGINAL
// string) into arrays indexed by TARGET string, so chord-ghost/finger-
// diagram rendering and `chordNotesFromTemplate` (screen.js — synthesizes
// chord-frame note gems from hand-shape spans) see the same positions as
// the real note gems.
//
// A template's per-string entries are shaped like a chord's notes (one
// fret per string, -1 = unused), so this reuses resolveChordCollisions
// directly. Fingers relocate to their note's new index unchanged — the
// remap can turn adjacent frets on adjacent strings into a wide stretch
// across different strings, so this only keeps the original hint from
// going stale-indexed rather than trying to recompute "correct" fingering.
function remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template) {
    if (!template || !Array.isArray(template.frets)) return template;
    const notes = [];
    for (let si = 0; si < template.frets.length; si++) {
        const f = template.frets[si];
        if (f >= 0) notes.push({ s: si, f });
    }
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes);
    const frets = new Array(TARGET_STRING_COUNT).fill(-1);
    const hasFingers = Array.isArray(template.fingers);
    const fingers = hasFingers ? new Array(TARGET_STRING_COUNT).fill(-1) : template.fingers;
    for (const { entry, note } of survivors) {
        frets[entry.s] = entry.f;
        if (hasFingers) fingers[entry.s] = template.fingers[note.s] ?? -1;
    }
    return Object.assign({}, template, { frets, fingers });
}

// Remaps every template in `chordTemplates` (array indexed by chord_id,
// untouched — only each entry's own frets/fingers change).
function remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, templates) {
    if (!Array.isArray(templates)) return templates || [];
    return templates.map(t => remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, t));
}

// PATCH POINT: remaps bundle.notes/.chords/.anchors/.chordTemplates to the
// fixed BEADG target IN PLACE, once per song (cached), so every downstream
// reader in screen.js sees the remapped chart automatically. Safe to
// mutate: `bundle` is this createHighway() instance's own object.
//
// Returns a fresh { apply(bundle) } per call so each createFactory()
// instance (one per splitscreen panel) gets its own cache, keeping
// different songs in different panels from cross-contaminating.
function createRetuner() {
    let cacheNotesRef = null, cacheChordsRef = null, cacheAnchorsRef = null, cacheTemplatesRef = null;
    let cacheTuningRef = null, cacheCapo = null, cacheStringCount = null;
    let remappedNotes = [], remappedChords = [], remappedAnchors = [], remappedTemplates = [];

    function apply(bundle) {
        const rawNotes = bundle.notes, rawChords = bundle.chords, rawAnchors = bundle.anchors;
        const rawTemplates = bundle.chordTemplates;
        const tuning = bundle.tuning, capo = bundle.capo | 0, sc = bundle.stringCount;
        const cacheHit = rawNotes === cacheNotesRef && rawChords === cacheChordsRef
            && rawAnchors === cacheAnchorsRef && rawTemplates === cacheTemplatesRef
            && tuning === cacheTuningRef && capo === cacheCapo && sc === cacheStringCount;

        if (!cacheHit) {
            cacheNotesRef = rawNotes;
            cacheChordsRef = rawChords;
            cacheAnchorsRef = rawAnchors;
            cacheTemplatesRef = rawTemplates;
            cacheTuningRef = tuning;
            cacheCapo = capo;
            cacheStringCount = sc;

            if (!Number.isFinite(sc) || sc < 1 || !Array.isArray(tuning)) {
                // Fail safe (shouldn't happen once draw() is gated by
                // core's ready flag) — pass the chart through unremapped.
                remappedNotes = Array.isArray(rawNotes) ? rawNotes : [];
                remappedChords = Array.isArray(rawChords) ? rawChords : [];
                remappedAnchors = Array.isArray(rawAnchors) ? rawAnchors : [];
                remappedTemplates = Array.isArray(rawTemplates) ? rawTemplates : [];
            } else {
                // Arrangement-wide natural string shift, computed once per
                // song — see computeArrangementShift for the Drop C# bug
                // a per-note global search caused.
                const sourceOpenMidiByString = computeOpenStringMidiByString(sc, tuning, capo);
                const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString);
                const naturalTargetByString = [];
                for (let s = 0; s < sc; s++) {
                    naturalTargetByString.push(s + shiftK);
                }

                // A bass "double stop" is often two independent Note
                // entries sharing an onset time rather than a Chord object
                // (arr.notes and arr.chords are separate lists in
                // lib/song.py). Group by exact onset time and run every
                // group, including ordinary singletons, through the same
                // collision resolution as real chords, so two flat notes
                // sharing a target string still collide correctly.
                const newNotes = [];
                if (Array.isArray(rawNotes)) {
                    const byTime = new Map();
                    for (const n of rawNotes) {
                        let bucket = byTime.get(n.t);
                        if (!bucket) byTime.set(n.t, bucket = []);
                        bucket.push(n);
                    }
                    for (const bucket of byTime.values()) {
                        const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, bucket);
                        for (const { entry, note } of survivors) {
                            const copy = Object.assign({}, note, entry);
                            copy._origNote = note; // keyed against by the note-state provider
                            newNotes.push(copy);
                        }
                    }
                    // byTime iteration order already matches rawNotes' time
                    // order, but sort explicitly since downstream consumers
                    // assume bundle.notes is time-sorted.
                    newNotes.sort((a, b) => a.t - b.t);
                }
                const newChords = [];
                if (Array.isArray(rawChords)) {
                    for (const ch of rawChords) {
                        const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, ch.notes || []);
                        if (survivors.length === 0) continue; // every note collided/unplayable
                        const notesCopy = survivors.map(({ entry, note }) => {
                            const c = Object.assign({}, note, entry);
                            c._origNote = note;
                            return c;
                        });
                        newChords.push(Object.assign({}, ch, { notes: notesCopy }));
                    }
                }
                remappedNotes = newNotes;
                remappedChords = newChords;
                remappedAnchors = remapAnchors(rawAnchors, newNotes);
                remappedTemplates = remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, rawTemplates);
            }
        }

        bundle.notes = remappedNotes;
        bundle.chords = remappedChords;
        bundle.anchors = remappedAnchors;
        bundle.chordTemplates = remappedTemplates;
    }

    return { apply };
}

// The added B string has no slot in highway_3d's raw per-index palette —
// under target indexing it would reuse whatever color sits at slot 0 (the
// color players associate with a 4-string chart's E). Core's named-color
// system has the right slot for an added low string: "low7" ("Low B",
// 7-string guitars), default #cc00aa — but its chart-shape detection keys
// off the chart's TRUE string count, so it won't assign our synthesized
// 5th string a color on its own. Read the same "Low B" storage directly
// instead, so a real user override still applies.
//
// Hex parsing is duplicated from screen.js's _h3dHexToInt rather than
// imported, to avoid this module depending back on screen.js.
function hexToInt(hex) {
    if (typeof hex !== 'string') return null;
    const t = hex.trim().replace(/^#/, '');
    const full = t.length === 3 ? t[0] + t[0] + t[1] + t[1] + t[2] + t[2] : t;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return parseInt(full, 16);
}
function lowBColor() {
    try {
        const raw = localStorage.getItem('highwayStringColors');
        if (raw) {
            const parsed = JSON.parse(raw);
            const n = hexToInt(parsed && parsed.low7);
            if (n != null) return n;
        }
    } catch (_) { /* corrupt / blocked storage — fall through to default */ }
    return 0xcc00aa; // HWC_DEFAULT_FALLBACK.low7 ("Low B", 7-string default)
}

export const FSE = {
    TARGET_MAX_FRET,
    TARGET_STRING_COUNT,
    TARGET_OPEN_STRING_LABELS,
    standardOpenStringMidi,
    sourceOpenStringMidi,
    computeOpenStringMidiByString,
    computeArrangementShift,
    resolveTargetForFret,
    remapNote,
    remapSlide,
    noteHalfstepRank,
    remapNoteEntry,
    resolveChordCollisions,
    remapAnchors,
    remapChordTemplate,
    remapChordTemplates,
    createRetuner,
    lowBColor,
};
