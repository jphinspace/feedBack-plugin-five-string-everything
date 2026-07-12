// Five-String Everything — chart remap math: turning a source chart's
// notes/chords/anchors/chord-templates into positions on the active
// target tuning. Pure, no dependency on Three.js or screen.js's closure
// state. One of four modules the fse-retune.js barrel aggregates into the
// `FSE` namespace — see that file for the full picture.
//
// String/fret offset arithmetic: one fret = one half-step. Adjacent BEADG
// target strings happen to be a perfect fourth apart (5 half-steps), but
// that's a fact about BEADG specifically, not an assumption baked into the
// algorithm — every function below looks up each target string's own open
// pitch from the target array (`target[j]`), so a custom target tuning with
// irregular string-to-string intervals (not uniformly fourths, fifths, or
// anything else) works with zero special-casing.
//
// Target-tuning RESOLUTION (what the target array actually contains) lives
// in target-tuning.js, imported here for the built-in-default fallback and
// the fret ceiling.

import { TARGET_MAX_FRET, DEFAULT_TARGET_MIDI_TUNING, computeOpenStringMidiByString, computeArrangementShift } from './target-tuning.js';

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
export function resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    let j = Math.max(0, Math.min(target.length - 1, naturalTargetString));
    while (j >= 0 && j < target.length) {
        const adjustment = sourceOpenMidi - target[j];
        const targetFret = fret + adjustment;
        if (targetFret < 0) { j -= 1; continue; }
        if (targetFret > TARGET_MAX_FRET) { j += 1; continue; }
        return { s: j, f: targetFret, adjustment };
    }
    return null;
}

// Ordinary (non-sliding) note: { s, f } on the target, or null if dropped.
// `targetMidiTuning` (optional) is the active target tuning's open-string
// MIDI array; omit for the built-in BEADG default.
export function remapNote(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning) {
    const best = resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning);
    return best ? { s: best.s, f: best.f } : null;
}

// Sliding note (slide_to/slide_unpitch_to, same string). Both endpoints
// must land on the SAME target string — independent per-fret remapping
// can split them, so anchor on whichever endpoint is lower (most likely
// in range), retrying on the higher endpoint if that fails. An
// overflowing slide clamps to fret 20 instead of dropping (unlike an
// ordinary out-of-range note).
export function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning) {
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
export function noteHalfstepRank(sourceOpenMidi, fret) {
    return sourceOpenMidi + fret;
}

// Single entry point for both a standalone note and a chord note:
// dispatches to remapSlide when the note carries a slide (sl/slu default
// to -1 = "no slide"), otherwise remapNote. Returns { s, f } plus, only
// when present on the input, a remapped `sl` or `slu`.
export function remapNoteEntry(sourceOpenMidi, naturalTargetString, note, targetMidiTuning) {
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
export function resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning) {
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
export function remapAnchors(anchors, remappedNotes) {
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
export function remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, targetMidiTuning) {
    if (!template || !Array.isArray(template.frets)) return template;
    const notes = [];
    for (let si = 0; si < template.frets.length; si++) {
        const f = template.frets[si];
        if (f >= 0) notes.push({ s: si, f });
    }
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    const frets = new Array(target.length).fill(-1);
    const hasFingers = Array.isArray(template.fingers);
    const fingers = hasFingers ? new Array(target.length).fill(-1) : template.fingers;
    for (const { entry, note } of survivors) {
        frets[entry.s] = entry.f;
        if (hasFingers) fingers[entry.s] = template.fingers[note.s] ?? -1;
    }
    return Object.assign({}, template, { frets, fingers });
}

// Remaps every template in `chordTemplates` (array indexed by chord_id,
// untouched — only each entry's own frets/fingers change).
export function remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, templates, targetMidiTuning) {
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
// `targetMidiTuning` (optional, passed to apply()) is the active target
// tuning's open-string MIDI array (any length >= 1) — omit for the
// built-in 5-string BEADG default.
export function createRetuner() {
    let cacheNotesRef = null, cacheChordsRef = null, cacheAnchorsRef = null, cacheTemplatesRef = null;
    let cacheTuningRef = null, cacheCapo = null, cacheStringCount = null, cacheTargetSig = null;
    let remappedNotes = [], remappedChords = [], remappedAnchors = [], remappedTemplates = [];

    function apply(bundle, targetMidiTuning) {
        const target = (Array.isArray(targetMidiTuning) && targetMidiTuning.length >= 1)
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
