// Five-String Everything — string/fret offset transformation engine.
// Pure functions, no dependency on Three.js or screen.js's closure state.
// This module holds the plugin's own logic; screen.js (a fork of
// highway_3d/screen.js) imports it as the `FSE` namespace, so screen.js
// itself stays close to upstream for easy syncing.
//
// String/fret offset arithmetic: one fret = one half-step. Adjacent BEADG
// target strings happen to be a perfect fourth apart (5 half-steps), but
// that's a fact about BEADG specifically, not an assumption baked into the
// algorithm — every function below looks up each target string's own open
// pitch from the target array (`target[j]`), so a custom target tuning with
// irregular string-to-string intervals (not uniformly fourths, fifths, or
// anything else) works with zero special-casing. The tables below are fixed
// MIDI note references (same numbers as lib/song.py's _TUNING_BASE_MIDI).
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

// Target is always a 5-string bass (5SE never changes string COUNT — only
// which pitches those 5 strings are tuned to is user-configurable, see
// resolveTargetTuning below). BEADG remains the built-in default.
const TARGET_STRING_COUNT = 5;
const TARGET_MAX_FRET = 20;
const DEFAULT_TARGET_TUNING = ['B0', 'E1', 'A1', 'D2', 'G2'];

// Pitch class (0=C .. 11=B) for the natural note letters, before applying
// a #/b accidental.
const NOTE_LETTER_PITCH_CLASS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Parses one target-tuning string spec, e.g. "B0", "Bb1", "F#2", "A-1" —
// note letter (A-G, case-insensitive) + optional single #/b accidental +
// signed octave number, scientific pitch notation (C4 = MIDI 60, matching
// lib/song.py's _TUNING_BASE_MIDI convention used elsewhere in this file).
// Returns { midi, label } (label preserves the input's own letter case /
// accidental spelling, e.g. "Bb" not the enharmonic "A#") or null if the
// spec doesn't parse.
function parseTargetNote(spec) {
    if (typeof spec !== 'string') return null;
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(spec.trim());
    if (!m) return null;
    const letter = m[1], accidental = m[2], octave = parseInt(m[3], 10);
    let pc = NOTE_LETTER_PITCH_CLASS[letter.toLowerCase()];
    if (accidental === '#') pc += 1;
    else if (accidental === 'b') pc -= 1;
    return { midi: pc + 12 * (octave + 1), label: letter.toUpperCase() + accidental };
}

// Resolves a 5-entry tuning spec (array of note-name strings, low string
// first) into { midiTuning: number[5], labels: string[5] }. Any string that
// fails to parse (missing, malformed, wrong array length) falls back to
// the corresponding BEADG default entry — a corrupt/partial custom tuning
// degrades one string at a time rather than breaking the whole render.
//
// No uniqueness constraint: two (or more) strings resolving to the exact
// same note + octave is allowed (e.g. an intentional unison pair) and
// requires no special handling below — every remap function looks up a
// string's OWN target pitch independently, it never searches for "the"
// string matching a pitch.
function resolveTargetTuning(spec) {
    const src = Array.isArray(spec) ? spec : DEFAULT_TARGET_TUNING;
    const midiTuning = new Array(TARGET_STRING_COUNT);
    const labels = new Array(TARGET_STRING_COUNT);
    for (let i = 0; i < TARGET_STRING_COUNT; i++) {
        const parsed = parseTargetNote(src[i]) || parseTargetNote(DEFAULT_TARGET_TUNING[i]);
        midiTuning[i] = parsed.midi;
        labels[i] = parsed.label;
    }
    return { midiTuning, labels };
}

// Fixed BEADG default target — used whenever a caller omits the optional
// `targetMidiTuning` parameter on the remap functions below (keeps every
// existing call site, including test/retune-engine.test.mjs, working
// unchanged) and as the fallback inside resolveTargetTuning.
const DEFAULT_TARGET = resolveTargetTuning(DEFAULT_TARGET_TUNING);
const DEFAULT_TARGET_MIDI_TUNING = DEFAULT_TARGET.midiTuning;
const TARGET_OPEN_STRING_LABELS = DEFAULT_TARGET.labels;

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
function computeArrangementShift(sourceStringCount, tuningOffsets, capo, sourceOpenMidiByString, targetMidiTuning) {
    const midiByString = sourceOpenMidiByString || computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    let bestK = 0, bestExact = -1, bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= TARGET_STRING_COUNT - 1; k++) {
        let exact = 0, totalAbs = 0, counted = 0;
        for (let s = 0; s < sourceStringCount; s++) {
            const j = s + k;
            if (j < 0 || j >= TARGET_STRING_COUNT) continue;
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
function resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    let j = Math.max(0, Math.min(TARGET_STRING_COUNT - 1, naturalTargetString));
    while (j >= 0 && j < TARGET_STRING_COUNT) {
        const adjustment = sourceOpenMidi - target[j];
        const targetFret = fret + adjustment;
        if (targetFret < 0) { j -= 1; continue; }
        if (targetFret > TARGET_MAX_FRET) { j += 1; continue; }
        return { s: j, f: targetFret, adjustment };
    }
    return null;
}

// Ordinary (non-sliding) note: { s, f } on the target, or null if dropped.
// `targetMidiTuning` (optional) is a 5-entry open-string MIDI array for the
// active target tuning; omit for the built-in BEADG default.
function remapNote(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning) {
    const best = resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning);
    return best ? { s: best.s, f: best.f } : null;
}

// Sliding note (slide_to/slide_unpitch_to, same string). Both endpoints
// must land on the SAME target string — independent per-fret remapping
// can split them, so anchor on whichever endpoint is lower (most likely
// in range), retrying on the higher endpoint if that fails. An
// overflowing slide clamps to fret 20 instead of dropping (unlike an
// ordinary out-of-range note).
function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const lowFret = Math.min(fret, slideToFret);
    const highFret = Math.max(fret, slideToFret);
    let anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, lowFret, targetMidiTuning);
    if (!anchor) anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, highFret, targetMidiTuning);
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
function remapNoteEntry(sourceOpenMidi, naturalTargetString, note, targetMidiTuning) {
    const hasSl = Number.isInteger(note.sl) && note.sl >= 0;
    const hasSlu = !hasSl && Number.isInteger(note.slu) && note.slu >= 0;
    if (hasSl || hasSlu) {
        const dest = hasSl ? note.sl : note.slu;
        const r = remapSlide(sourceOpenMidi, naturalTargetString, note.f, dest, targetMidiTuning);
        if (!r) return null;
        const out = { s: r.s, f: r.f };
        if (hasSl) out.sl = r.slideTo; else out.slu = r.slideTo;
        return out;
    }
    return remapNote(sourceOpenMidi, naturalTargetString, note.f, targetMidiTuning);
}

// Remaps every note independently, groups survivors by target string, and
// for any target string with more than one note keeps only the
// lower-pitched original — per colliding string, not the whole chord.
// `notes` is an array of note-shaped objects (`s`/`f`, optionally `sl`/
// `slu`). Returns { entry, note } per survivor, where `entry` is
// remapNoteEntry's result and `note` is the original input (for field
// passthrough and keying bundle.getNoteState).
function resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning) {
    const candidates = [];
    for (const note of notes) {
        const midi = sourceOpenMidiByString[note.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[note.s], note, targetMidiTuning);
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
function remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, targetMidiTuning) {
    if (!template || !Array.isArray(template.frets)) return template;
    const notes = [];
    for (let si = 0; si < template.frets.length; si++) {
        const f = template.frets[si];
        if (f >= 0) notes.push({ s: si, f });
    }
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning);
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
function remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, templates, targetMidiTuning) {
    if (!Array.isArray(templates)) return templates || [];
    return templates.map(t => remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, t, targetMidiTuning));
}

// PATCH POINT: remaps bundle.notes/.chords/.anchors/.chordTemplates to the
// active target tuning IN PLACE, once per song/tuning-change (cached), so
// every downstream reader in screen.js sees the remapped chart
// automatically. Safe to mutate: `bundle` is this createHighway()
// instance's own object.
//
// Returns a fresh { apply(bundle, targetMidiTuning) } per call so each
// createFactory() instance (one per splitscreen panel) gets its own cache,
// keeping different songs in different panels from cross-contaminating.
// `targetMidiTuning` (optional, passed to apply()) is the active target tuning's
// 5-entry open-string MIDI array — omit for the built-in BEADG default.
function createRetuner() {
    let cacheNotesRef = null, cacheChordsRef = null, cacheAnchorsRef = null, cacheTemplatesRef = null;
    let cacheTuningRef = null, cacheCapo = null, cacheStringCount = null, cacheTargetSig = null;
    let remappedNotes = [], remappedChords = [], remappedAnchors = [], remappedTemplates = [];

    function apply(bundle, targetMidiTuning) {
        const target = (Array.isArray(targetMidiTuning) && targetMidiTuning.length === TARGET_STRING_COUNT)
            ? targetMidiTuning : DEFAULT_TARGET_MIDI_TUNING;
        const rawNotes = bundle.notes, rawChords = bundle.chords, rawAnchors = bundle.anchors;
        const rawTemplates = bundle.chordTemplates;
        const tuning = bundle.tuning, capo = bundle.capo | 0, sc = bundle.stringCount;
        const targetSig = target.join(',');
        const cacheHit = rawNotes === cacheNotesRef && rawChords === cacheChordsRef
            && rawAnchors === cacheAnchorsRef && rawTemplates === cacheTemplatesRef
            && tuning === cacheTuningRef && capo === cacheCapo && sc === cacheStringCount
            && targetSig === cacheTargetSig;

        if (!cacheHit) {
            cacheNotesRef = rawNotes;
            cacheChordsRef = rawChords;
            cacheAnchorsRef = rawAnchors;
            cacheTemplatesRef = rawTemplates;
            cacheTuningRef = tuning;
            cacheCapo = capo;
            cacheStringCount = sc;
            cacheTargetSig = targetSig;

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
                const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString, target);
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
                        const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, bucket, target);
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
                        const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, ch.notes || [], target);
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
                remappedTemplates = remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, rawTemplates, target);
            }
        }

        bundle.notes = remappedNotes;
        bundle.chords = remappedChords;
        bundle.anchors = remappedAnchors;
        bundle.chordTemplates = remappedTemplates;
    }

    return { apply };
}

// The added low string has no slot in highway_3d's raw per-index palette —
// under target indexing it would reuse whatever color sits at slot 0 (the
// color players associate with a 4-string chart's E). Core's named-color
// system has the right slot for an added low string: "low7" ("Low B",
// 7-string guitars), default #cc00aa — but its chart-shape detection keys
// off the chart's TRUE string count, so it won't assign our synthesized
// 5th string a color on its own. Read the same "Low B" storage directly
// instead, so a real user override still applies.
//
// This slot is keyed by TARGET STRING INDEX (0), never by the pitch that
// happens to be tuned there. With custom target tunings (AEADG, drop
// tunings, ...) string 0 is often not actually a B — deliberately unchanged:
// per-string colors are a "which string is this" cue for muscle memory, not
// a note-name indicator, so they stay pinned to BEADG's slot layout for
// every 5-string tuning rather than being remapped per note.
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
    DEFAULT_TARGET_MIDI_TUNING,
    DEFAULT_TARGET_TUNING,
    parseTargetNote,
    resolveTargetTuning,
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
