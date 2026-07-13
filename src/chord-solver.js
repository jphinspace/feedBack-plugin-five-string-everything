// Chart Retuner — chord-aware remapping (the guitar-chords feature).
// One of the pure-logic modules chart-retune.js aggregates into `CR`.
//
// Guitar chords don't map note-for-note across tunings: a per-note
// pitch-preserving remap of an open chord under a shifted tuning drops
// notes (fret -1) or blows the shape apart. This module solves a
// comparable voicing on the TARGET tuning instead. Priorities, in order
// (user-set, see PLANNING.md Phase 13):
//   1. Playable — fretted stretch never exceeds a 4-fret box
//      (max fretted fret − min fretted fret ≤ MAX_CHORD_SPAN) unless the
//      ORIGINAL chord itself stretched further, and never needs more
//      than 4 fretting fingers (barres counted as one finger).
//   2. Hand shape comparable to the original — open-ish chords stay
//      open-ish/low, a barre isn't introduced where the source had none,
//      the hand stays near the source fret position. Simplifying the
//      chord is acceptable.
//   3. Root note in the bass — least important; inversions/triads are
//      acceptable when they fit the shape/playability better.
// Chord IDENTITY is the pitch-class set + root: exact sounded pitches
// are strongly preferred when playable (EXACT_PITCH_MISS), but octave
// doublings may change when they aren't ("revoice near position").
//
// Tier ladder (dispatched by solveChord; createRetuner in
// retune-engine.js supplies the Tier-0 candidate — this module never
// imports retune-engine, keeping the dependency graph one-way):
//   Tier 0 — the existing exact per-note remap, accepted when it covers
//            every source note collision-free AND is playable (or is
//            literally the source voicing, which is playable by
//            definition — it was in the chart).
//   Tier 2 — pitch-class revoicing search over hand positions
//            (solveVoicingSearch). A strong exact-pitch preference means
//            every playable exact voicing is found here too, so there is
//            no separate exact-multiset tier ("Tier 1") — it would be
//            dead code by construction.
//   Tier 3 — degradation ladder: the same search re-run with shrinking
//            required pitch-class sets (full → triad → root+5th dyad →
//            bare root), each rung costed +DEGRADE_RUNG so a fuller
//            solution always wins unless it is far worse.
//   (drop) — solveChord returns null; the caller omits the chord, the
//            same contract as an unplayable single note.

import { notePitchClass } from './pitch.js';
import { TARGET_MAX_FRET } from './target-tuning.js';

// Max fretted-fret difference within one chord: 3 = a four-fret box
// (e.g. frets 5-6-7-8). A "5+ fret stretch" (max − min ≥ 4) is only
// allowed when the source chord itself carried one.
export const MAX_CHORD_SPAN = 3;
export const MAX_FRETTING_FINGERS = 4;

// Additive cost weights, lower = better. Starting points, tuned by the
// test suite — the invariants that matter: playability is a hard
// constraint (not a weight); the shape terms (EXACT_PITCH_MISS on every
// note of a relocated voicing, OPENNESS_MISMATCH, BARRE_INTRODUCED,
// POSITION_DISTANCE) collectively outweigh ROOT_NOT_IN_BASS, encoding
// priority 2 > 3; DEGRADE_RUNG dwarfs everything else so a reduced
// chord only wins when the fuller rung has no acceptable voicing at all.
export const SOLVER_WEIGHTS = {
    EXACT_PITCH_MISS: 40,   // per target note not among the source's sounded pitches
    DROPPED_NOTE: 30,       // per source note whose pitch class vanished entirely
    DROPPED_DOUBLING: 8,    // per source note dropped while its pitch class stays covered
    ROOT_NOT_IN_BASS: 25,   // lowest sounded target note isn't the root (or slash bass)
    OPENNESS_MISMATCH: 12,  // per |source open-string count − target open-string count|
    BARRE_INTRODUCED: 30,   // target needs a barre (>4 fretted) where the source didn't
    POSITION_DISTANCE: 5,   // per fret |target min fretted fret − source min fretted fret|
    REGISTER_DISTANCE: 2,   // per semitone |target bass note − source bass note|
    NOTE_COUNT_DIFF: 4,     // per |target note count − source note count|
    INNER_MUTE: 10,         // per muted string strictly between sounded strings
    DEGRADE_RUNG: 500,      // per degradation-ladder rung
};

function pcOf(midi) {
    return ((midi % 12) + 12) % 12;
}

// Root (and slash bass, if any) pitch class from a chord template name:
// 'Am7' -> { rootPc: 9, bassPc: null }, 'C/G' -> { rootPc: 0, bassPc: 7 },
// 'F#5' -> { rootPc: 6, bassPc: null }. Returns null when the name doesn't
// start with a note letter (GP imports carry junk/empty names). The caller
// validates the parsed root against the actually-sounded pitch classes —
// a name that contradicts the notes loses to the lowest sounded pitch.
// Letter/accidental -> pitch-class parsing is pitch.js's notePitchClass —
// the same table parseTargetNote uses, so the two can't drift.
export function parseChordRootFromName(name) {
    if (typeof name !== 'string') return null;
    const m = /^\s*([A-Ga-g])([#b])?/.exec(name);
    if (!m) return null;
    const rootPc = notePitchClass(m[1], m[2]);
    const slash = /\/\s*([A-Ga-g])([#b])?\s*$/.exec(name);
    const bassPc = slash ? notePitchClass(slash[1], slash[2]) : null;
    return { rootPc, bassPc };
}

// Groups a fretted-note list (sorted by string) into maximal
// contiguous-string same-fret runs — a run is frettable with one finger
// laid across it (ring-finger mini-barre), e.g. the 2-2-2 of A major.
function _contiguousRuns(frettedSortedByString) {
    const runs = [];
    for (const n of frettedSortedByString) {
        const last = runs[runs.length - 1];
        if (last && last.f === n.f && n.s === last.maxS + 1) {
            last.notes.push(n);
            last.maxS = n.s;
        } else {
            runs.push({ f: n.f, minS: n.s, maxS: n.s, notes: [n] });
        }
    }
    return runs;
}

// Fingers needed to fret `voicing` ([{ s, f }], one note per string).
// Two grouping devices, matching how players actually cover shapes:
//   - the full barre: every note at the chord's MIN fretted fret counts
//     as one finger when a barre is valid there (barreIsValid) — F major
//     1-3-3-2-1-1's three 1s;
//   - contiguous-string same-fret runs count as one finger each
//     (mini-barre) — the 3-3-3 a ring finger lays across in Drop-D's
//     3-3-3-2-1-1 F shape.
// Open strings are free. Deliberately permissive: this gates
// playability; computeChordFingers below draws diagrams and prefers
// canonical one-finger-per-note assignments.
export function fingersNeeded(voicing) {
    const fretted = voicing.filter(n => n.f > 0).sort((a, b) => a.s - b.s);
    if (fretted.length === 0) return 0;
    let minF = Infinity;
    for (const n of fretted) if (n.f < minF) minF = n.f;
    const atMin = fretted.filter(n => n.f === minF);
    const useBarre = atMin.length >= 2 && barreIsValid(voicing);
    const rest = useBarre ? fretted.filter(n => n.f !== minF) : fretted;
    return (useBarre ? 1 : 0) + _contiguousRuns(rest).length;
}

// A barre at the chord's min fretted fret lies across every string from
// the lowest barred string up — so it's invalid when any OPEN note
// sounds on a string the barre would cover (at or above the lowest
// same-min-fret string).
export function barreIsValid(voicing) {
    const fretted = voicing.filter(n => n.f > 0);
    if (fretted.length < 2) return false;
    let minF = Infinity;
    for (const n of fretted) if (n.f < minF) minF = n.f;
    let atMin = 0, barreLowS = Infinity;
    for (const n of fretted) {
        if (n.f !== minF) continue;
        atMin++;
        if (n.s < barreLowS) barreLowS = n.s;
    }
    if (atMin < 2) return false;
    return !voicing.some(n => n.f === 0 && n.s >= barreLowS);
}

// Hard playability check against the source chord's own difficulty:
// fretted stretch within max(MAX_CHORD_SPAN, source stretch), fingers
// within max(MAX_FRETTING_FINGERS, source fingers). Anything the source
// chord itself demanded stays allowed (it was in the chart).
export function voicingPlayable(voicing, spec) {
    const fretted = voicing.filter(n => n.f > 0);
    if (fretted.length > 1) {
        let minF = Infinity, maxF = -Infinity;
        for (const n of fretted) { if (n.f < minF) minF = n.f; if (n.f > maxF) maxF = n.f; }
        if (maxF - minF > Math.max(MAX_CHORD_SPAN, spec.span)) return false;
    }
    return fingersNeeded(voicing) <= Math.max(MAX_FRETTING_FINGERS, spec.fingers);
}

// Builds the solver's view of one source chord from its notes
// ([{ s, f, ... }], source-string indexed) under the source tuning
// (sourceOpenMidiByString — capo already folded in upstream, so f === 0
// means "open at the capo", zero fingers). templateName seeds the root
// when it parses AND agrees with the sounded pitch classes; otherwise
// the lowest sounded pitch is the root (right for the overwhelming
// majority of guitar chart chords). Returns null when no note sounds.
export function chordSpecFromNotes(sourceOpenMidiByString, notes, templateName) {
    const specNotes = [];
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const open = sourceOpenMidiByString[n.s];
        if (open === null || open === undefined) continue;
        const midi = open + n.f;
        specNotes.push({ idx: i, s: n.s, f: n.f, midi, pc: pcOf(midi) });
    }
    if (specNotes.length === 0) return null;
    const pitchSet = new Set(specNotes.map(n => n.midi));
    const pcs = new Set(specNotes.map(n => n.pc));
    const pcCounts = new Map();
    for (const n of specNotes) pcCounts.set(n.pc, (pcCounts.get(n.pc) || 0) + 1);
    let bassMidi = Infinity;
    for (const n of specNotes) if (n.midi < bassMidi) bassMidi = n.midi;
    const fretted = specNotes.filter(n => n.f > 0);
    let minFretted = null, span = 0;
    if (fretted.length > 0) {
        let minF = Infinity, maxF = -Infinity;
        for (const n of fretted) { if (n.f < minF) minF = n.f; if (n.f > maxF) maxF = n.f; }
        minFretted = minF;
        span = maxF - minF;
    }
    let rootPc = pcOf(bassMidi);
    let bassPc = null;
    const named = parseChordRootFromName(templateName);
    if (named && pcs.has(named.rootPc)) {
        rootPc = named.rootPc;
        if (named.bassPc !== null && pcs.has(named.bassPc)) bassPc = named.bassPc;
    }
    return {
        notes: specNotes,
        pitchSet,
        pcs,
        pcCounts,
        rootPc,
        bassPc,
        bassMidi,
        minFretted,
        span,
        openCount: specNotes.length - fretted.length,
        noteCount: specNotes.length,
        fingers: fingersNeeded(specNotes),
        requiresBarre: fretted.length > MAX_FRETTING_FINGERS,
    };
}

// The degradation ladder: required pitch-class sets from fullest to
// barest, consecutive duplicates removed. Interval preferences off the
// root: third = 4 (major) else 3 (minor), fifth = 7 (perfect) else
// 6 (dim) else 8 (aug) — only intervals actually present in the source
// chord are ever required.
export function degradationLadder(spec) {
    const has = pc => spec.pcs.has(pc);
    const iv = semis => pcOf(spec.rootPc + semis);
    const third = [4, 3].map(iv).find(has);
    const fifth = [7, 6, 8].map(iv).find(has);
    const rungs = [new Set(spec.pcs)];
    const triad = new Set([spec.rootPc]);
    if (third !== undefined) triad.add(third);
    if (fifth !== undefined) triad.add(fifth);
    rungs.push(triad);
    const dyad = new Set([spec.rootPc]);
    const partner = fifth !== undefined ? fifth : third;
    if (partner !== undefined) dyad.add(partner);
    rungs.push(dyad);
    rungs.push(new Set([spec.rootPc]));
    const out = [];
    for (const r of rungs) {
        const prev = out[out.length - 1];
        if (prev && prev.size === r.size && [...r].every(pc => prev.has(pc))) continue;
        out.push(r);
    }
    return out;
}

// Full cost of a candidate voicing ([{ s, f, midi, pc }]) against the
// spec. Every term is >= 0 and the per-note EXACT_PITCH_MISS portion is
// exactly what the search accumulates as its branch-and-bound partial
// cost, keeping that bound admissible.
export function scoreVoicing(spec, voicing) {
    const W = SOLVER_WEIGHTS;
    let cost = 0;
    let minMidi = Infinity, minMidiPc = -1, openCount = 0, minFretted = null;
    let minS = Infinity, maxS = -Infinity;
    const tgtPcCounts = new Map();
    for (const n of voicing) {
        if (!spec.pitchSet.has(n.midi)) cost += W.EXACT_PITCH_MISS;
        if (n.midi < minMidi) { minMidi = n.midi; minMidiPc = n.pc; }
        if (n.f === 0) openCount += 1;
        else if (minFretted === null || n.f < minFretted) minFretted = n.f;
        if (n.s < minS) minS = n.s;
        if (n.s > maxS) maxS = n.s;
        tgtPcCounts.set(n.pc, (tgtPcCounts.get(n.pc) || 0) + 1);
    }
    for (const [pc, srcCount] of spec.pcCounts) {
        const t = tgtPcCounts.get(pc) || 0;
        if (t === 0) cost += W.DROPPED_NOTE * srcCount;
        else if (t !== srcCount) cost += W.DROPPED_DOUBLING * Math.abs(t - srcCount);
    }
    if (minMidiPc !== (spec.bassPc !== null ? spec.bassPc : spec.rootPc)) cost += W.ROOT_NOT_IN_BASS;
    cost += W.OPENNESS_MISMATCH * Math.abs(openCount - spec.openCount);
    if (voicing.length - openCount > MAX_FRETTING_FINGERS && !spec.requiresBarre) cost += W.BARRE_INTRODUCED;
    cost += W.POSITION_DISTANCE * Math.abs((minFretted !== null ? minFretted : 0) - (spec.minFretted !== null ? spec.minFretted : 0));
    cost += W.REGISTER_DISTANCE * Math.abs(minMidi - spec.bassMidi);
    cost += W.NOTE_COUNT_DIFF * Math.abs(voicing.length - spec.noteCount);
    cost += W.INNER_MUTE * (maxS - minS + 1 - voicing.length);
    return cost;
}

// Searches every hand position for the min-cost playable voicing whose
// notes all belong to `requiredPcs` and which covers EVERY pc in
// `requiredPcs` at least once. Depth-first over target strings
// (mute | open-if-in-set | each window fret in-set) with
// branch-and-bound on the accumulated EXACT_PITCH_MISS partial cost.
// Positions are visited nearest-to-the-source-position first so the
// bound tightens early. Voicing size is hard-capped at the SOURCE note
// count (opts.maxNotes) — the solver never emits more notes than the
// chart had, which keeps _origNote/scoring semantics sane downstream.
// Returns { voicing: [{ s, f, midi, pc }], cost } or null.
export function solveVoicingSearch(spec, requiredPcs, targetMidiTuning, opts) {
    const target = targetMidiTuning;
    if (!Array.isArray(target) || target.length === 0) return null;
    const nStr = target.length;
    const maxNotes = Math.min((opts && opts.maxNotes) || spec.noteCount, nStr);
    if (maxNotes < requiredPcs.size) return null;
    // Clamped so the position loop below always has at least p=1 (a
    // window covering the whole neck): a degenerate source span >= 20
    // (extreme GP import) must widen the search, never empty it — an
    // empty loop would also skip the open-string candidates it gates.
    const allowedSpan = Math.min(Math.max(MAX_CHORD_SPAN, spec.span), TARGET_MAX_FRET - 1);
    const pcsArr = [...requiredPcs];
    const pcBit = new Map(pcsArr.map((pc, i) => [pc, 1 << i]));
    const fullMask = (1 << pcsArr.length) - 1;
    const srcPos = spec.minFretted !== null ? spec.minFretted : 1;
    const positions = [];
    for (let p = 1; p <= TARGET_MAX_FRET - allowedSpan; p++) positions.push(p);
    positions.sort((a, b) => Math.abs(a - srcPos) - Math.abs(b - srcPos) || a - b);

    const W = SOLVER_WEIGHTS;
    let best = null;
    const chosen = [];
    for (const p of positions) {
        // Per-string candidates at this position: mute (null), the open
        // string when its pc qualifies, and every window fret whose pc
        // qualifies. Window frets start at the position itself — fret 0
        // is only ever the explicit open candidate.
        const cands = [];
        for (let j = 0; j < nStr; j++) {
            const open = target[j];
            const list = [null];
            const openBit = pcBit.get(pcOf(open));
            if (openBit !== undefined) list.push({ s: j, f: 0, midi: open, pc: pcOf(open), bit: openBit });
            for (let f = p; f <= p + allowedSpan && f <= TARGET_MAX_FRET; f++) {
                const midi = open + f;
                const bit = pcBit.get(pcOf(midi));
                if (bit !== undefined) list.push({ s: j, f, midi, pc: pcOf(midi), bit });
            }
            cands.push(list);
        }
        (function dfs(j, mask, partial) {
            if (best && partial >= best.cost) return;
            if (j === nStr) {
                if (mask !== fullMask || chosen.length === 0) return;
                if (fingersNeeded(chosen) > Math.max(MAX_FRETTING_FINGERS, spec.fingers)) return;
                const cost = scoreVoicing(spec, chosen);
                if (!best || cost < best.cost) best = { voicing: chosen.slice(), cost };
                return;
            }
            // Coverage feasibility: the remaining strings must be able to
            // supply every still-missing pc (one new note covers at most
            // one missing bit) within the note budget.
            const missing = fullMask & ~mask;
            let missingCount = 0;
            for (let m = missing; m; m >>= 1) missingCount += m & 1;
            const budget = Math.min(maxNotes - chosen.length, nStr - j);
            if (missingCount > budget) return;
            for (const c of cands[j]) {
                if (c === null) { dfs(j + 1, mask, partial); continue; }
                if (chosen.length >= maxNotes) continue;
                chosen.push(c);
                dfs(j + 1, mask | c.bit, partial + (spec.pitchSet.has(c.midi) ? 0 : W.EXACT_PITCH_MISS));
                chosen.pop();
            }
        })(0, 0, 0);
    }
    return best;
}

// Matches each solved target note back to a distinct source note (for
// _origNote scoring linkage and technique carry-over): exact MIDI match
// first, then nearest same-pitch-class, then nearest by pitch — always
// among the not-yet-used source notes; target notes are matched in
// ascending pitch order for determinism. Returns [{ srcIndex, s, f }]
// where srcIndex indexes the notes array chordSpecFromNotes was built
// from (spec.notes[k].idx).
export function matchVoicingToSource(voicing, spec) {
    const used = new Set();
    const ordered = voicing.slice().sort((a, b) => a.midi - b.midi || a.s - b.s);
    const placements = [];
    for (const n of ordered) {
        let pick = null;
        for (const s of spec.notes) {
            if (used.has(s.idx) || s.midi !== n.midi) continue;
            pick = s;
            break;
        }
        if (!pick) {
            let bestD = Infinity;
            for (const s of spec.notes) {
                if (used.has(s.idx) || s.pc !== n.pc) continue;
                const d = Math.abs(s.midi - n.midi);
                if (d < bestD) { bestD = d; pick = s; }
            }
        }
        if (!pick) {
            let bestD = Infinity;
            for (const s of spec.notes) {
                if (used.has(s.idx)) continue;
                const d = Math.abs(s.midi - n.midi);
                if (d < bestD) { bestD = d; pick = s; }
            }
        }
        if (!pick) return null; // impossible: |voicing| <= |spec.notes|
        used.add(pick.idx);
        placements.push({ srcIndex: pick.idx, s: n.s, f: n.f });
    }
    return placements;
}

// Tier dispatch for one chord. `exactCandidate` is the caller-computed
// Tier-0 result ([{ srcIndex, s, f }] from the existing per-note engine,
// or null) — accepted when it covers every spec note and is playable,
// or when it IS the source voicing verbatim (playable by definition).
// Otherwise the revoicing search runs down the degradation ladder,
// comparing rungs on cost + rung * DEGRADE_RUNG (with an early break
// once no later rung can win). Returns
// { placements: [{ srcIndex, s, f }], tier: 0|2|3, rung } or null (drop
// the chord).
export function solveChord(spec, targetMidiTuning, exactCandidate) {
    if (!spec || spec.notes.length === 0) return null;
    if (Array.isArray(exactCandidate) && exactCandidate.length === spec.notes.length) {
        const byIdx = new Map(spec.notes.map(n => [n.idx, n]));
        const identity = exactCandidate.every(pl => {
            const src = byIdx.get(pl.srcIndex);
            return src && src.s === pl.s && src.f === pl.f;
        });
        const voicing = exactCandidate.map(pl => ({ s: pl.s, f: pl.f }));
        if (identity || voicingPlayable(voicing, spec)) {
            return { placements: exactCandidate, tier: 0, rung: 0 };
        }
    }
    const W = SOLVER_WEIGHTS;
    const rungs = degradationLadder(spec);
    let best = null;
    for (let r = 0; r < rungs.length; r++) {
        const found = solveVoicingSearch(spec, rungs[r], targetMidiTuning, { maxNotes: spec.noteCount });
        if (found) {
            const total = found.cost + r * W.DEGRADE_RUNG;
            if (!best || total < best.total) {
                const placements = matchVoicingToSource(found.voicing, spec);
                if (placements) best = { total, placements, tier: r === 0 ? 2 : 3, rung: r };
            }
        }
        // No later rung (baseline (r+1) * DEGRADE_RUNG) can beat this.
        if (best && best.total <= (r + 1) * W.DEGRADE_RUNG) break;
    }
    return best ? { placements: best.placements, tier: best.tier, rung: best.rung } : null;
}

// Plausible finger numbers for a remapped chord template
// (frets-by-target-string, -1 = unused, 0 = open, n = fret). Prefers the
// canonical one-finger-per-note assignment in ascending (fret, string)
// order (E major 0-2-2-1-0-0 -> 0-2-3-1-0-0); falls back to a barre
// (same-fret notes at the min fretted fret share finger 1, valid per
// barreIsValid) and then to contiguous-run mini-barre grouping only when
// there are more fretted notes than fingers. Deliberately conservative:
// anything still ambiguous returns all -1 — a wrong finger number in
// the chord diagram is worse than none (GP imports already render all
// -1).
export function computeChordFingers(fretsByTargetString) {
    const n = fretsByTargetString.length;
    const fingers = new Array(n).fill(-1);
    const voicing = [];
    for (let s = 0; s < n; s++) {
        const f = fretsByTargetString[s];
        if (f === 0) fingers[s] = 0;
        else if (f > 0) voicing.push({ s, f });
        // fingers[s] stays -1 for unused strings
    }
    if (voicing.length === 0) return fingers;
    const all = fretsByTargetString.map((f, s) => ({ s, f })).filter(x => x.f >= 0);
    const byString = voicing.slice().sort((a, b) => a.s - b.s);
    const minF = Math.min(...voicing.map(x => x.f));
    const atMin = byString.filter(x => x.f === minF);
    const useBarre = atMin.length >= 2 && voicing.length > MAX_FRETTING_FINGERS && barreIsValid(all);
    const rest = useBarre ? byString.filter(x => x.f !== minF) : byString;
    let next = useBarre ? 2 : 1;
    if (useBarre) for (const x of atMin) fingers[x.s] = 1;
    if (rest.length <= MAX_FRETTING_FINGERS - (useBarre ? 1 : 0)) {
        // Canonical: one finger per remaining note, low fret first.
        const sorted = rest.slice().sort((a, b) => a.f - b.f || a.s - b.s);
        for (const x of sorted) fingers[x.s] = next++;
        return fingers;
    }
    // Mini-barre fallback: contiguous same-fret runs share a finger.
    const runs = _contiguousRuns(rest).sort((a, b) => a.f - b.f || a.minS - b.minS);
    if (next - 1 + runs.length > MAX_FRETTING_FINGERS) {
        return new Array(n).fill(-1).map((v, s) => (fretsByTargetString[s] === 0 ? 0 : -1)); // ambiguous
    }
    for (const run of runs) {
        for (const x of run.notes) fingers[x.s] = next;
        next++;
    }
    return fingers;
}
