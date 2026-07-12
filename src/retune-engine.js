// Five-String Everything — chart remap math: source notes/chords/anchors/
// chord-templates -> positions on the active target tuning.
// One of four modules fse-retune.js aggregates into `FSE`.
//
// One fret = one half-step. Every function looks up each target string's
// own open pitch from `target[j]`, so irregular (non-fourths) target
// tunings work with no special-casing.

import { TARGET_MAX_FRET, DEFAULT_TARGET_MIDI_TUNING, computeOpenStringMidiByString, computeArrangementShift } from './target-tuning.js';

// Resolves one (sourceOpenMidi, fret) against the target: starts from the
// natural target string and steps toward whichever direction the
// out-of-range fret demands. Returns { s, f, adjustment } or null if
// unplayable on every reachable string.
//
// Anchors on the natural string first rather than a global smallest-
// adjustment search across all strings — a global search misfires on a
// large single-string drop (e.g. Drop C#, -3 half-steps), flipping to a
// different string too early.
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

export function remapNote(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning) {
    const best = resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning);
    return best ? { s: best.s, f: best.f } : null;
}

// Slide (slide_to/slide_unpitch_to): both endpoints must land on the same
// target string, so anchor on whichever fret is lower, retry on the
// higher one if that fails. Clamps to fret 20 on overflow instead of
// dropping (unlike an ordinary note).
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

export function noteHalfstepRank(sourceOpenMidi, fret) {
    return sourceOpenMidi + fret;
}

// Dispatches to remapSlide when the note carries sl/slu, else remapNote.
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

// Remaps every note, then keeps only the lower-pitched note per colliding
// target string. Returns { entry, note } per survivor.
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

// Remaps hand-position anchors ({ time, fret, width }, no string of their
// own) by borrowing the adjustment of the nearest already-remapped note
// at/after the anchor's time. Open-string notes are skipped as donors.
// Both arrays must be time-sorted.
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

// Remaps a chord template's frets/fingers (indexed by original string)
// into target-string indices, reusing resolveChordCollisions.
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

export function remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, templates, targetMidiTuning) {
    if (!Array.isArray(templates)) return templates || [];
    return templates.map(t => remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, t, targetMidiTuning));
}

// Remaps bundle.notes/.chords/.anchors/.chordTemplates to the active
// target tuning in place, cached per song/tuning. Returns a fresh
// { apply(bundle, targetMidiTuning) } per call so each splitscreen panel
// gets its own cache.
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
                // Fail-safe: pass the chart through unremapped.
                remappedNotes = Array.isArray(rawNotes) ? rawNotes : [];
                remappedChords = Array.isArray(rawChords) ? rawChords : [];
                remappedAnchors = Array.isArray(rawAnchors) ? rawAnchors : [];
                remappedTemplates = Array.isArray(rawTemplates) ? rawTemplates : [];
            } else {
                const sourceOpenMidiByString = computeOpenStringMidiByString(sc, tuning, capo);
                const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString, target);
                const naturalTargetByString = [];
                for (let s = 0; s < sc; s++) {
                    naturalTargetByString.push(s + shiftK);
                }

                // Group by onset time first (a bass double-stop is often two
                // flat Notes sharing a time rather than a Chord object), so
                // simultaneous notes on different source strings still
                // collide-resolve correctly.
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
                            copy._origNote = note; // keyed by the note-state provider
                            newNotes.push(copy);
                        }
                    }
                    newNotes.sort((a, b) => a.t - b.t);
                }
                const newChords = [];
                if (Array.isArray(rawChords)) {
                    for (const ch of rawChords) {
                        const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, ch.notes || [], target);
                        if (survivors.length === 0) continue;
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
