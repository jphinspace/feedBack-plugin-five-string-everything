// Provider end-to-end: import the real src/main.js under Node with a stubbed
// capability API, capture the registered transform, and run core-shaped
// input through it.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const captured = {};
const _busListeners = new Map();
globalThis.feedBack = {
    capabilities: {
        version: 1,
        dispatch: async (req) => { captured[req.command] = req; return { outcome: 'handled' }; },
        subscribe: () => {},
    },
    on: (type, fn) => {
        if (!_busListeners.has(type)) _busListeners.set(type, []);
        _busListeners.get(type).push(fn);
    },
    emit: (type, detail) => {
        for (const fn of _busListeners.get(type) || []) fn({ detail });
    },
};

await import('../src/main.js');

const reg = captured['register-provider'];
assert.ok(reg, 'provider registered on load');
assert.equal(reg.capability, 'chart-transform');
assert.equal(reg.source, 'chart_retuner');
assert.equal(reg.payload.providerId, 'chart_retuner');
const transform = reg.payload.transform;
assert.equal(typeof transform, 'function');

// Case 1: E-standard 4-string bass chart onto the default bass target
// (EADG) — identity remap, zero-offset tuning export.
const notes = [{ t: 1.0, s: 0, f: 3, sus: 0.5 }, { t: 2.0, s: 3, f: 5, sus: 0 }];
const chords = [];
const anchors = [{ time: 0, fret: 1, width: 4 }];
const input1 = {
    notes, chords, anchors, chordTemplates: [],
    allNotes: notes, allChords: chords,
    stringCount: 4,
    songInfo: { arrangement: 'Bass', tuning: [0, 0, 0, 0], capo: 0 },
};
const out1 = transform(input1);
assert.equal(out1.stringCount, 4, 'EADG target has 4 strings');
assert.deepEqual(out1.tuning, [0, 0, 0, 0], 'EADG = standard, zero offsets');
assert.equal(out1.capo, 0);
assert.equal(out1.notes.length, 2, 'identity remap keeps both notes');
assert.equal(out1.notes[0].s, 0);
assert.equal(out1.notes[0].f, 3);
assert.equal(out1.notes[0]._origNote, notes[0], 'original back-reference kept');
assert.ok(out1.allNotes === undefined, 'filter-inactive: no separate all view');

// Case 2: filtered subset differs from the full chart → both views export.
const filtered = [notes[0]];
const input2 = { ...input1, notes: filtered, allNotes: notes };
const out2 = transform(input2);
assert.equal(out2.notes.length, 1, 'effective view follows the filtered subset');
assert.equal(out2.allNotes.length, 2, 'full-difficulty view still complete');

// Case 3: a drop-tuned source note below the target's range is dropped.
const lowNotes = [{ t: 1.0, s: 0, f: 0, sus: 0 }]; // D1 (26) on D-standard bass
const input3 = {
    notes: lowNotes, chords: [], anchors, chordTemplates: [],
    allNotes: lowNotes, allChords: [],
    stringCount: 4,
    songInfo: { arrangement: 'Bass', tuning: [-2, -2, -2, -2], capo: 0 },
};
const out3 = transform(input3);
assert.equal(out3.notes.length, 0, 'below-range note drops on EADG');

// Case 4: guitar arrangement routes to the guitar profile (EADGBE, 6 strings).
const gNotes = [{ t: 1.0, s: 0, f: 3, sus: 0 }];
const input4 = {
    notes: gNotes, chords: [], anchors, chordTemplates: [],
    allNotes: gNotes, allChords: [],
    stringCount: 6,
    songInfo: { arrangement: 'Lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0 },
};
const out4 = transform(input4);
assert.equal(out4.stringCount, 6, 'lead routes to the EADGBE profile');
assert.deepEqual(out4.tuning, [0, 0, 0, 0, 0, 0]);
assert.equal(out4.notes.length, 1);

// Case 5: non-fretted / unclaimed arrangements pass through untransformed
// (only lead/rhythm/bass/combo/guitar arrangements remap).
const dNotes = [{ t: 1.0, s: 0, f: 38, sus: 0 }];
const drumInput = {
    notes: dNotes, chords: [], anchors: [], chordTemplates: [],
    allNotes: dNotes, allChords: [],
    stringCount: 6,
    songInfo: { arrangement: 'Drums', tuning: [0, 0, 0, 0, 0, 0], capo: 0 },
};
assert.equal(transform(drumInput), null, 'drums arrangement passes through');
assert.equal(transform({ ...drumInput, songInfo: { arrangement: 'Keys' } }), null, 'keys arrangement passes through');
assert.equal(transform({ ...drumInput, songInfo: { arrangement: 'Vocals' } }), null, 'vocals arrangement passes through');
assert.ok(transform({ ...drumInput, songInfo: { arrangement: 'Lead Bass', tuning: [0, 0, 0, 0] }, stringCount: 4, notes: notes, allNotes: notes }) !== null,
    'bass-family arrangements still remap');

// Case 6: string colors — a live-tracked default preset must NOT override
// core's Highway String Colors; a concrete-color custom tuning must, on
// the primary highway and on announced splitscreen panels alike.
function makeColorHighway() {
    const calls = [];
    return {
        calls,
        setStringColors(arr) { calls.push(arr); },
        getStringColors() { return ['#111111']; },
    };
}
const primaryHw = makeColorHighway();
globalThis.highway = primaryHw;
transform(input1);
assert.equal(primaryHw.calls.length, 0, 'live-tracked preset leaves core colors alone');

const customColors = ['#101010', '#202020', '#303030', '#404040'];
const customId = window.cr3dSaveCustomTuning({
    name: 'Provider Test Tuning',
    strings: ['E1', 'A1', 'D2', 'G2'],
    colors: customColors,
    maxFret: 20,
});
assert.ok(customId, 'custom tuning saved');
window.cr3dSetActiveTuning('bass', customId);
transform(input1);
assert.equal(primaryHw.calls.length, 1, 'concrete colors applied to the primary');
assert.deepEqual(primaryHw.calls[0], customColors);

const panelHw = makeColorHighway();
globalThis.feedBack.emit('highway:created', { highway: panelHw });
assert.equal(panelHw.calls.length, 1, 'announced panel receives the applied colors');
assert.deepEqual(panelHw.calls[0], customColors);

window.cr3dSetActiveTuning('bass', null);
transform(input1);
assert.deepEqual(primaryHw.calls[primaryHw.calls.length - 1], ['#111111'], 'primary colors restored');
assert.deepEqual(panelHw.calls[panelHw.calls.length - 1], ['#111111'], 'panel colors restored');

console.log('OK - end-to-end transform sanity passed');
