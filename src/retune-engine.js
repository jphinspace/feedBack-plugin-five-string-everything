// Chart Retuner — chart remap math: source notes/chords/anchors/
// chord-templates -> positions on the active target tuning.
// One of the pure-logic modules chart-retune.js aggregates into `CR`.
//
// One fret = one half-step. Every function looks up each target string's
// own open pitch from `target[j]`, so irregular (non-fourths) target
// tunings work with no special-casing. Simultaneous-note groups (chords,
// same-onset flat-note buckets, chord templates) route through the
// chord-aware solver (src/chord-solver.js) — see the PATCH POINT (chord
// solver) blocks in createRetuner below.

import { DEFAULT_MAX_FRET, DEFAULT_TARGET_MIDI_TUNING, computeOpenStringMidiByString, computeArrangementShift } from './target-tuning.js';
import { chordSpecFromNotes, solveChord, computeChordFingers, MAX_SEARCH_NODES } from './chord-solver.js';

const _clampFret = (f, maxFret) => Math.max(0, Math.min(maxFret, f));

// ---- Pathological-chart safety valves (createRetuner) ----------------
// A remap must never be able to stall the render thread, no matter what
// a chart file contains. Three independent bounds, all overridable per
// retuner via createRetuner(opts):
//
// MAX_SOLVER_GROUP_SIZE — a simultaneous-note group larger than this
// (no real instrument: buckets this size are data corruption, e.g. a
// broken GP export stacking a whole bar on one timestamp) skips the
// solver entirely and takes the bounded per-note path.
export const MAX_SOLVER_GROUP_SIZE = 12;
// FRAME_BUDGET_MS — cold-remap work per apply() call. A remap that
// doesn't finish inside the budget continues on subsequent calls
// (frames); until it completes, apply() publishes EMPTY arrays — never a
// partially remapped chart, and never the previous chart's data. The
// check runs between work units (one template / note bucket / chord), so
// a slice can overshoot by at most one unit — itself bounded by the
// solver node budget. Typical charts (~4 ms cold) still finish in the
// first call, exactly as before.
export const FRAME_BUDGET_MS = 5;
// MAX_TOTAL_SOLVE_MS — accumulated cold-remap work across all slices of
// one remap job. Past it the solver is disabled for the job's REMAINING
// groups (per-note path instead), so even a chart with thousands of
// distinct expensive shapes reaches the screen in bounded total work.
export const MAX_TOTAL_SOLVE_MS = 2000;

const _now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

// Pitch-order tables per target-tuning array, cached by array identity
// (target arrays are treated as immutable — resolveTargetTuning always
// allocates fresh). `null` for an ascending array — the overwhelmingly
// common case, where the walk in resolveTargetForFret can move by index
// directly — else { byPitch, rankOf } for a pitch-ordered walk. Needed
// since banjo5_gdgbd (high G4 drone at index 0) made non-monotonic
// targets a real, shipping configuration: an index walk on such a target
// marches AWAY from the string that could actually play the note.
const _pitchOrderCache = new WeakMap();
function _pitchOrderFor(target) {
    let cached = _pitchOrderCache.get(target);
    if (cached === undefined) {
        cached = null;
        for (let i = 1; i < target.length; i++) {
            if (target[i] < target[i - 1]) {
                const byPitch = target.map((_, idx) => idx).sort((a, b) => target[a] - target[b] || a - b);
                const rankOf = new Array(target.length);
                byPitch.forEach((idx, rank) => { rankOf[idx] = rank; });
                cached = { byPitch, rankOf };
                break;
            }
        }
        _pitchOrderCache.set(target, cached);
    }
    return cached;
}

// Resolves one (sourceOpenMidi, fret) against the target: starts from the
// natural target string and steps toward whichever direction the
// out-of-range fret demands — in PITCH order, which equals index order
// for ascending tunings and follows the rank tables above for
// non-monotonic ones. Returns { s, f, adjustment } or null if unplayable
// on every reachable string. Complete: finds a placement iff some string
// has one (underflow at a pitch implies underflow at every higher pitch,
// and vice versa, so the one-direction sweep covers every candidate).
//
// Anchors on the natural string first rather than a global smallest-
// adjustment search across all strings — a global search misfires on a
// large single-string drop (e.g. Drop C#, -3 half-steps), flipping to a
// different string too early.
export function resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    const ord = _pitchOrderFor(target);
    // Walk position: an index directly for an ascending target, a pitch
    // RANK otherwise.
    let r = Math.max(0, Math.min(target.length - 1, naturalTargetString));
    if (ord) r = ord.rankOf[r];
    // The direction lock doubles as the termination guarantee: needing to
    // reverse proves the note fits nowhere (everything one way underflows,
    // everything the other way overflows). Without it, two pitch-adjacent
    // strings more than maxFret semitones apart made the old walk
    // oscillate between them forever — a hard render-thread hang.
    let dir = 0;
    while (r >= 0 && r < target.length) {
        const j = ord ? ord.byPitch[r] : r;
        const adjustment = sourceOpenMidi - target[j];
        const targetFret = fret + adjustment;
        if (targetFret < 0) {
            if (dir > 0) return null;
            dir = -1;
            r -= 1;
            continue;
        }
        if (targetFret > maxFret) {
            if (dir < 0) return null;
            dir = 1;
            r += 1;
            continue;
        }
        return { s: j, f: targetFret, adjustment };
    }
    return null;
}

export function remapNote(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    const best = resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret);
    return best ? { s: best.s, f: best.f } : null;
}

// Slide (slide_to/slide_unpitch_to): both endpoints must land on the same
// target string, so anchor on whichever fret is lower, retry on the
// higher one if that fails. Clamps to maxFret on overflow instead of
// dropping (unlike an ordinary note).
export function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const lowFret = Math.min(fret, slideToFret);
    const highFret = Math.max(fret, slideToFret);
    let anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, lowFret, targetMidiTuning, maxFret);
    if (!anchor) anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, highFret, targetMidiTuning, maxFret);
    if (!anchor) return null;
    return {
        s: anchor.s,
        f: _clampFret(fret + anchor.adjustment, maxFret),
        slideTo: _clampFret(slideToFret + anchor.adjustment, maxFret),
    };
}

export function noteHalfstepRank(sourceOpenMidi, fret) {
    return sourceOpenMidi + fret;
}

// Dispatches to remapSlide when the note carries sl/slu, else remapNote.
export function remapNoteEntry(sourceOpenMidi, naturalTargetString, note, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    const hasSl = Number.isInteger(note.sl) && note.sl >= 0;
    const hasSlu = !hasSl && Number.isInteger(note.slu) && note.slu >= 0;
    if (hasSl || hasSlu) {
        const dest = hasSl ? note.sl : note.slu;
        const r = remapSlide(sourceOpenMidi, naturalTargetString, note.f, dest, targetMidiTuning, maxFret);
        if (!r) return null;
        const out = { s: r.s, f: r.f };
        if (hasSl) out.sl = r.slideTo; else out.slu = r.slideTo;
        return out;
    }
    return remapNote(sourceOpenMidi, naturalTargetString, note.f, targetMidiTuning, maxFret);
}

// Remaps every note, then keeps only the lower-pitched note per colliding
// target string. Returns { entry, note } per survivor.
export function resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    const candidates = [];
    for (const note of notes) {
        const midi = sourceOpenMidiByString[note.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[note.s], note, targetMidiTuning, maxFret);
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

// How far past an anchor's time (in seconds) remapAnchors looks for an
// exact-remap (tier-0) donor before settling for a revoiced one.
export const ANCHOR_DONOR_WINDOW_S = 2;

// Remaps hand-position anchors ({ time, fret, width }, no string of their
// own) by borrowing the adjustment of the nearest already-remapped note
// at/after the anchor's time. Open-string notes are skipped as donors.
// Both arrays must be time-sorted.
//
// Donor preference: a REVOICED donor (`_crTier` >= 2 — an octave-shifted
// chord-solver placement) can carry a huge adjustment that lurches the
// hand-position band to a nonsense fret for the passage, so when the
// nearest donor is revoiced, the anchor looks ahead up to
// ANCHOR_DONOR_WINDOW_S for the first tier-0 donor (exact per-note remap
// — `_crTier` 0, or untagged notes from direct API use) and prefers it.
// No tier-0 donor nearby -> the revoiced adjustment is still the best
// available signal, same as before.
export function remapAnchors(anchors, remappedNotes, maxFret = DEFAULT_MAX_FRET) {
    if (!Array.isArray(anchors) || anchors.length === 0) return anchors || [];
    if (!Array.isArray(remappedNotes) || remappedNotes.length === 0) return anchors.slice();
    const fretted = remappedNotes.filter(n => n._origNote.f > 0);
    const donors = fretted.length ? fretted : remappedNotes;
    const tierOf = n => n._crTier || 0;
    const out = [];
    let ptr = 0;
    for (const a of anchors) {
        while (ptr < donors.length - 1 && donors[ptr].t < a.time) ptr++;
        let note = donors[ptr];
        if (tierOf(note) !== 0) {
            const limit = a.time + ANCHOR_DONOR_WINDOW_S;
            for (let k = ptr + 1; k < donors.length && donors[k].t <= limit; k++) {
                if (tierOf(donors[k]) === 0) { note = donors[k]; break; }
            }
        }
        const adjustment = note.f - note._origNote.f;
        const fret = Math.max(0, Math.min(maxFret, a.fret + adjustment));
        out.push({ time: a.time, fret, width: a.width });
    }
    return out;
}

// Remaps a chord template's frets/fingers (indexed by original string)
// into target-string indices, reusing resolveChordCollisions.
export function remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (!template || !Array.isArray(template.frets)) return template;
    const notes = [];
    for (let si = 0; si < template.frets.length; si++) {
        const f = template.frets[si];
        if (f >= 0) notes.push({ s: si, f });
    }
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
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

export function remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, templates, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (!Array.isArray(templates)) return templates || [];
    return templates.map(t => remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, t, targetMidiTuning, maxFret));
}

// PATCH POINT (chord solver) — Tier-0 candidate for a simultaneous-note
// group: the existing per-note engine's output expressed as solver
// placements, or null when any note drops or two notes collide on one
// target string (those cases go to the revoicing search instead —
// src/chord-solver.js). Notes on null-open-midi strings are skipped, the
// same filter chordSpecFromNotes applies, so the two views of the group
// stay index-aligned. Each placement keeps the engine `entry` so a
// Tier-0-accepted group materializes byte-identically to the per-note
// path (including remapped slide endpoints).
function _exactCandidateFor(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret) {
    const placements = [];
    const taken = new Set();
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const midi = sourceOpenMidiByString[n.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[n.s], n, targetMidiTuning, maxFret);
        if (!entry || taken.has(entry.s)) return null;
        taken.add(entry.s);
        placements.push({ srcIndex: i, s: entry.s, f: entry.f, entry });
    }
    return placements.length ? placements : null;
}

// Materializes solver placements into remapped note copies — the same
// shape the per-note path emits: source-note fields (sustain,
// techniques, ...) + target s/f + `_origNote` back-reference (the
// note-state scorer keys judgments by the ORIGINAL time/string/fret).
// Tier-0 placements carry the engine `entry` (with its own remapped
// slide endpoints); revoiced placements re-apply the source note's slide
// delta to the solved fret instead, clamped like remapSlide does.
//
// `tier` (optional): the group's solve tier, tagged onto each copy as
// `_crTier` for remapAnchors' donor preference. Only bundle.notes
// entries can donate to anchors, so the chord paths omit it — an
// untagged note reads as tier 0 there, which is also the right default
// for direct API users building remappedNotes by hand.
function _materializePlacements(notes, placements, maxFret, tier) {
    const out = [];
    for (const pl of placements) {
        const src = notes[pl.srcIndex];
        const copy = pl.entry
            ? Object.assign({}, src, pl.entry)
            : Object.assign({}, src, { s: pl.s, f: pl.f });
        if (!pl.entry) {
            if (Number.isInteger(src.sl) && src.sl >= 0) copy.sl = _clampFret(pl.f + (src.sl - src.f), maxFret);
            else if (Number.isInteger(src.slu) && src.slu >= 0) copy.slu = _clampFret(pl.f + (src.slu - src.f), maxFret);
        }
        copy._origNote = src;
        if (tier !== undefined) copy._crTier = tier;
        out.push(copy);
    }
    return out;
}

// Safety fallback for a group the solver can't take (oversized, node
// budget exhausted with nothing found, or solver disabled by the
// whole-job work valve): the pre-solver per-note path — exact remap +
// lower-pitch-wins collision resolution. Placements carry the engine
// `entry`, so they materialize byte-identically to the per-note path
// (including remapped slide endpoints). `degraded: true` marks the
// voicing as a fallback, informational only.
function _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret) {
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
    if (survivors.length === 0) return null;
    return {
        placements: survivors.map(({ entry, note }) => ({ srcIndex: notes.indexOf(note), s: entry.s, f: entry.f, entry })),
        tier: 0,
        rung: 0,
        degraded: true,
    };
}

// Solves one simultaneous-note group (a Chord's notes, a chord
// template's sounded frets, or a same-onset flat-note bucket) against
// the target: Tier 0 (exact per-note remap) first, then the revoicing /
// degradation search. Returns { placements, tier, rung } or null (the
// group is entirely unsoundable — dropped, matching the single-note
// contract). `cache` lives for one remap run (one song/tuning/capo
// combination — see createRetuner's cache keys), keyed by the group's
// ordered (s,f,sl,slu) shape + template name so every recurrence of the
// same chord resolves to the same voicing at zero cost.
//
// `jobCtl` ({ solverDisabled, maxSearchNodes, stats }) is createRetuner's
// safety-valve state: oversized groups and solver-disabled jobs route to
// _collisionPlacements, and a node-budget abort that found nothing falls
// back there too — "solver gave up" must degrade the voicing, never drop
// a group the per-note path could still place.
function _solveGroup(cache, sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, templateName, maxFret, jobCtl) {
    let key = (templateName || '') + '#';
    for (const n of notes) key += n.s + ',' + n.f + ',' + (n.sl ?? '') + ',' + (n.slu ?? '') + '|';
    if (cache.has(key)) return cache.get(key);
    let solved = null;
    const spec = chordSpecFromNotes(sourceOpenMidiByString, notes, templateName);
    if (spec) {
        const oversize = notes.length > MAX_SOLVER_GROUP_SIZE;
        if (oversize || (jobCtl && jobCtl.solverDisabled)) {
            if (oversize && jobCtl) jobCtl.stats.oversizeGroups += 1;
            solved = _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
        } else {
            const budget = { nodes: (jobCtl && jobCtl.maxSearchNodes) || MAX_SEARCH_NODES, aborted: false };
            const exact = _exactCandidateFor(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
            solved = solveChord(spec, targetMidiTuning, exact, maxFret, { budget });
            if (budget.aborted) {
                if (jobCtl) jobCtl.stats.searchAborts += 1;
                if (!solved) solved = _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
            }
        }
    }
    cache.set(key, solved);
    return solved;
}

// Remaps bundle.notes/.chords/.anchors/.chordTemplates to the active
// target tuning in place, cached per song/tuning. Returns a fresh
// { apply(bundle, targetMidiTuning, maxFret), getStats() } per call so
// each splitscreen panel gets its own cache. `maxFret` is the active
// tuning profile's own ceiling (CR.resolveActiveTuning's maxFret) —
// defaults to DEFAULT_MAX_FRET (the historical hardcoded 20) when
// omitted.
//
// The cold remap runs as a generator job time-sliced across apply()
// calls (see FRAME_BUDGET_MS above): until the job completes, apply()
// publishes empty arrays. Callers need no awareness of this — they call
// apply() per frame with the raw bundle exactly as before, and the
// remapped chart appears when ready (first call for typical charts).
//
// opts (all optional, defaults are the exported valve constants):
//   frameBudgetMs   — per-apply() work budget; Infinity = synchronous.
//   maxTotalSolveMs — whole-job work cap before the solver is disabled.
//   maxSearchNodes  — per-group solver node budget (MAX_SEARCH_NODES).
//
// getStats() (diagnostics + tests): { slices, workMs, searchAborts,
// oversizeGroups, solverDisabled, inProgress } for the most recent job.
export function createRetuner(opts) {
    const frameBudgetMs = opts && opts.frameBudgetMs !== undefined ? opts.frameBudgetMs : FRAME_BUDGET_MS;
    const maxTotalSolveMs = opts && opts.maxTotalSolveMs !== undefined ? opts.maxTotalSolveMs : MAX_TOTAL_SOLVE_MS;
    const maxSearchNodes = opts && opts.maxSearchNodes !== undefined ? opts.maxSearchNodes : MAX_SEARCH_NODES;

    let cacheNotesRef = null, cacheChordsRef = null, cacheAnchorsRef = null, cacheTemplatesRef = null;
    let cacheTuningRef = null, cacheCapo = null, cacheStringCount = null, cacheTargetSig = null;
    let remappedNotes = [], remappedChords = [], remappedAnchors = [], remappedTemplates = [];
    let job = null;     // in-progress cold-remap generator, null when idle
    let jobCtl = null;  // its safety-valve state (shared with _solveGroup)
    const stats = { slices: 0, workMs: 0, searchAborts: 0, oversizeGroups: 0, solverDisabled: false };

    // The whole cold remap as a generator: one yield per work unit (one
    // template / one same-onset note bucket / one chord), so the driver
    // in apply() can stop between units when the frame budget runs out.
    // Results land in the remapped* closure vars only at the very end —
    // a partially remapped chart is never observable.
    function* _remapJob(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, ctl) {
        const sourceOpenMidiByString = computeOpenStringMidiByString(sc, tuning, capo);
        const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString, target);
        const naturalTargetByString = [];
        for (let s = 0; s < sc; s++) {
            naturalTargetByString.push(s + shiftK);
        }

        // PATCH POINT (chord solver): one solve cache per remap
        // run; identical chord shapes (by ordered s/f/slide
        // signature + template name) solve once per song/tuning.
        const groupCache = new Map();

        // Templates FIRST, so chord instances and the hand-shape-
        // synthesized chords screen.js builds straight from
        // bundle.chordTemplates follow the SAME solved voicing by
        // construction (same array index/order — chordTemplates is
        // indexed by chord id).
        const templateSolutions = new Map(); // template index -> Map<sourceString, {s,f}>
        const remapOneTemplate = (template, ti) => {
            if (!template || !Array.isArray(template.frets)) return template;
            const tNotes = [];
            for (let si = 0; si < template.frets.length; si++) {
                if (template.frets[si] >= 0) tNotes.push({ s: si, f: template.frets[si] });
            }
            // Single-note / empty templates keep the per-note
            // path (identical to the pre-solver behavior).
            if (tNotes.length < 2) {
                return remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, target, maxFret);
            }
            const solved = _solveGroup(groupCache, sourceOpenMidiByString, naturalTargetByString, tNotes, target, template.displayName || template.name, maxFret, ctl);
            const frets = new Array(target.length).fill(-1);
            if (!solved) {
                // Nothing soundable (all strings null-midi) —
                // an all-unused template, same net effect as
                // the per-note path dropping every note. A
                // non-array fingers field passes through
                // untouched, like remapChordTemplate does.
                return Object.assign({}, template, {
                    frets,
                    fingers: Array.isArray(template.fingers) ? frets.slice() : template.fingers,
                });
            }
            const byString = new Map();
            for (const pl of solved.placements) {
                byString.set(tNotes[pl.srcIndex].s, { s: pl.s, f: pl.f });
                frets[pl.s] = pl.f;
            }
            templateSolutions.set(ti, byString);
            // Fingers. A chart that omitted finger data
            // entirely (non-array — distinct from GP imports'
            // all--1 arrays) keeps that omission, matching the
            // pre-solver engine: no fabricated digits on the
            // chord ghost. Otherwise: Tier 0 kept the source
            // pitches note-for-note, so carry the chart's own
            // fingering per string (what the pre-solver path
            // did) — UNLESS the remap moved a note across the
            // open/fretted boundary (an open source string
            // landing on a fret, e.g. an open E shape onto a
            // Drop-D target), where a carried finger 0 is
            // nonsense. A revoiced shape (tier > 0) always
            // invalidates chart fingerings. Both of those
            // derive plausible ones instead.
            let fingers;
            if (!Array.isArray(template.fingers)) {
                fingers = template.fingers;
            } else {
                let carried = null;
                if (solved.tier === 0) {
                    carried = new Array(target.length).fill(-1);
                    for (const pl of solved.placements) {
                        const c = template.fingers[tNotes[pl.srcIndex].s] ?? -1;
                        if (c >= 0 && (c === 0) !== (pl.f === 0)) { carried = null; break; }
                        carried[pl.s] = c;
                    }
                }
                fingers = carried || computeChordFingers(frets);
            }
            return Object.assign({}, template, { frets, fingers });
        };
        let newTemplates;
        if (Array.isArray(rawTemplates)) {
            newTemplates = [];
            for (let ti = 0; ti < rawTemplates.length; ti++) {
                newTemplates.push(remapOneTemplate(rawTemplates[ti], ti));
                yield;
            }
        } else {
            newTemplates = rawTemplates || [];
        }

        // Group by onset time first (a bass double-stop is often two
        // flat Notes sharing a time rather than a Chord object), so
        // simultaneous notes on different source strings still
        // resolve as one chord. PATCH POINT (chord solver): groups
        // of >= 2 route through the solver — Tier 0 reproduces the
        // per-note remap whenever it is drop/collision-free and
        // playable, so single notes and clean groups behave exactly
        // as before; only groups the per-note path would break
        // (drops, collisions, unplayable stretches) get revoiced.
        const newNotes = [];
        if (Array.isArray(rawNotes)) {
            const byTime = new Map();
            for (const n of rawNotes) {
                let bucket = byTime.get(n.t);
                if (!bucket) byTime.set(n.t, bucket = []);
                bucket.push(n);
            }
            for (const bucket of byTime.values()) {
                if (bucket.length >= 2) {
                    const solved = _solveGroup(groupCache, sourceOpenMidiByString, naturalTargetByString, bucket, target, null, maxFret, ctl);
                    if (solved) newNotes.push(..._materializePlacements(bucket, solved.placements, maxFret, solved.tier));
                } else {
                    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, bucket, target, maxFret);
                    for (const { entry, note } of survivors) {
                        const copy = Object.assign({}, note, entry);
                        copy._origNote = note; // keyed by the note-state provider
                        copy._crTier = 0; // exact per-note remap — always a preferred anchor donor
                        newNotes.push(copy);
                    }
                }
                yield;
            }
            newNotes.sort((a, b) => a.t - b.t);
        }
        const newChords = [];
        if (Array.isArray(rawChords)) {
            for (const ch of rawChords) {
                const chNotes = ch.notes || [];
                let placements = null;
                // Template-first: an instance whose notes match its
                // template's frets — including a difficulty-filtered
                // SUBSET of them — takes the template's solved
                // voicing per source string, so instances at every
                // difficulty level agree with each other and with
                // the chord diagram. Instances that reference a
                // string the template solve dropped (or that
                // diverge from their template) solve ad-hoc below.
                // A null/absent id means "no template" — guarded
                // BEFORE Number() coercion, which would turn null
                // into 0 and alias template index 0 (same guard the
                // chord-ghost helpers in screen.js apply).
                const cid = ch.id == null ? null
                    : (typeof ch.id === 'number' ? ch.id : Number(ch.id));
                const byString = cid !== null ? templateSolutions.get(cid) : undefined;
                const tmpl = cid !== null && Array.isArray(rawTemplates) ? (rawTemplates[cid] || null) : null;
                // Sliding chords skip the template shortcut: the
                // template solution was solved from PLAIN frets, so
                // it can't reproduce remapSlide's lower-endpoint
                // anchoring — the ad-hoc path's Tier 0 goes through
                // remapNoteEntry/remapSlide and keeps slides exact.
                const hasSlide = chNotes.some(n => (Number.isInteger(n.sl) && n.sl >= 0)
                    || (Number.isInteger(n.slu) && n.slu >= 0));
                if (!hasSlide && byString && tmpl && chNotes.length > 0
                    && chNotes.every(n => tmpl.frets[n.s] === n.f && byString.has(n.s))) {
                    // One note per source string: a malformed chart
                    // can double up a string within one chord — the
                    // first note wins, matching the one-note-per-
                    // target-slot invariant every other path keeps.
                    const seen = new Set();
                    placements = [];
                    for (let i = 0; i < chNotes.length; i++) {
                        const n = chNotes[i];
                        if (seen.has(n.s)) continue;
                        seen.add(n.s);
                        const t = byString.get(n.s);
                        placements.push({ srcIndex: i, s: t.s, f: t.f });
                    }
                } else if (chNotes.length >= 2) {
                    const solved = _solveGroup(groupCache, sourceOpenMidiByString, naturalTargetByString, chNotes, target,
                        tmpl ? (tmpl.displayName || tmpl.name) : null, maxFret, ctl);
                    placements = solved ? solved.placements : null;
                } else {
                    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, chNotes, target, maxFret);
                    placements = survivors.map(({ entry, note }) => ({ srcIndex: chNotes.indexOf(note), s: entry.s, f: entry.f, entry }));
                }
                if (placements && placements.length > 0) {
                    newChords.push(Object.assign({}, ch, { notes: _materializePlacements(chNotes, placements, maxFret) }));
                }
                yield;
            }
        }
        // Publish atomically — the in-progress state was never visible.
        remappedNotes = newNotes;
        remappedChords = newChords;
        remappedAnchors = remapAnchors(rawAnchors, newNotes, maxFret);
        remappedTemplates = newTemplates;
    }

    function apply(bundle, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
        const target = (Array.isArray(targetMidiTuning) && targetMidiTuning.length >= 1)
            ? targetMidiTuning : DEFAULT_TARGET_MIDI_TUNING;
        const rawNotes = bundle.notes, rawChords = bundle.chords, rawAnchors = bundle.anchors;
        const rawTemplates = bundle.chordTemplates;
        const tuning = bundle.tuning, capo = bundle.capo | 0, sc = bundle.stringCount;
        // '@' + maxFret: two profiles sharing the same strings but a
        // different max fret must NOT cache-hit each other's remap.
        const targetSig = target.join(',') + '@' + maxFret;
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
            // A chart/tuning change mid-job discards the stale job
            // outright — its raw inputs no longer describe this chart.
            job = null;
            jobCtl = null;
            stats.slices = 0;
            stats.workMs = 0;
            stats.searchAborts = 0;
            stats.oversizeGroups = 0;
            stats.solverDisabled = false;

            if (!Number.isFinite(sc) || sc < 1 || !Array.isArray(tuning)) {
                // Fail-safe: pass the chart through unremapped.
                remappedNotes = Array.isArray(rawNotes) ? rawNotes : [];
                remappedChords = Array.isArray(rawChords) ? rawChords : [];
                remappedAnchors = Array.isArray(rawAnchors) ? rawAnchors : [];
                remappedTemplates = Array.isArray(rawTemplates) ? rawTemplates : [];
            } else {
                // Empty until the job publishes — never a partially
                // remapped chart, and never the previous chart's data.
                remappedNotes = [];
                remappedChords = [];
                remappedAnchors = [];
                remappedTemplates = [];
                jobCtl = { solverDisabled: false, maxSearchNodes, stats };
                job = _remapJob(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, jobCtl);
            }
        }

        if (job) {
            // Drive the job for up to frameBudgetMs of work. At least one
            // unit always runs, so completion needs at most one apply()
            // call per work unit regardless of what the clock reports;
            // a unit itself is bounded by the solver node budget.
            const sliceStart = _now();
            for (;;) {
                if (job.next().done) { job = null; break; }
                if (_now() - sliceStart >= frameBudgetMs) break;
            }
            stats.workMs += _now() - sliceStart;
            stats.slices += 1;
            // Whole-job valve: past the total work budget, every
            // remaining group takes the bounded per-note path instead of
            // the solver (see _solveGroup), so the job's tail is cheap.
            if (job && !jobCtl.solverDisabled && stats.workMs > maxTotalSolveMs) {
                jobCtl.solverDisabled = true;
                stats.solverDisabled = true;
            }
        }

        bundle.notes = remappedNotes;
        bundle.chords = remappedChords;
        bundle.anchors = remappedAnchors;
        bundle.chordTemplates = remappedTemplates;
    }

    function getStats() {
        return {
            slices: stats.slices,
            workMs: stats.workMs,
            searchAborts: stats.searchAborts,
            oversizeGroups: stats.oversizeGroups,
            solverDisabled: stats.solverDisabled,
            inProgress: job !== null,
        };
    }

    return { apply, getStats };
}
