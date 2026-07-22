// Chart Retuner — chart-transform provider (feedBack#952).
//
// Registers CR.createRetuner() (./src/chart-retune.js) as a chart-transform
// provider: core hands the current chart's difficulty-filtered AND
// full-difficulty notes/chords/anchors/templates to `_transform()` after
// every difficulty-filter rebuild (song ready, mastery slider move,
// explicit refresh), and the remapped result reaches every renderer's
// draw bundle, every highway getter, and any scorer that reads
// getNotes()/getChords() — not just one renderer this plugin owns. The
// target instrument's string COUNT (4-8) and pitches are fully
// user-configurable via the settings picker; EADG is the built-in bass
// default, EADGBE the guitar default; any 4-8-string tuning of your own
// (AEADG, BbEbAbDbGb, a cello, a banjo, ...) also works — see
// CR.resolveTargetTuning. The remap math and chord-aware revoicing live in
// ./src/ (imported as the `CR` namespace below); this file only wires that
// engine into the capability, resolves which of the three per-arrangement
// tuning profiles applies, and hosts the Target Tunings settings bridge +
// the player-controls capo/octave quick-adjust widget.
import { CR } from './src/chart-retune.js';

(function () {
    'use strict';

    const PROVIDER_ID = 'chart_retuner';

    // Legacy namespace (predates this file's own rewrite) kept verbatim so
    // upgrading installs keep their saved tuning profiles/custom tunings.
    const STORAGE_PREFIX = 'chart_retuner_bg_';
    const _mem = Object.create(null); // in-memory fallback when localStorage is blocked

    function _read(key) {
        if (key in _mem) return _mem[key];
        try {
            const v = localStorage.getItem(STORAGE_PREFIX + key);
            if (v !== null) return v;
        } catch (_) { /* storage blocked */ }
        return undefined;
    }
    function _write(key, val) {
        const s = String(val);
        _mem[key] = s;
        try { localStorage.setItem(STORAGE_PREFIX + key, s); } catch (_) { /* storage blocked */ }
        _refresh();
    }

    /* ── Target tuning profiles (bass / rhythm / lead) ───────────────────
     * Three per-arrangement-class profiles sharing one pool of built-in
     * presets + saved custom tunings — any profile may point at any
     * tuning. `arrangementClassFor` in _transform() picks which profile a
     * given chart resolves against.
     */
    const _PROFILE_KEY_BY_CLASS = {
        bass: 'targetTuningIdBass',
        rhythm: 'targetTuningIdRhythm',
        lead: 'targetTuningIdLead',
    };
    const _PROFILE_CLASSES = Object.keys(_PROFILE_KEY_BY_CLASS);
    function _profileKeyFor(arrClass) {
        return _PROFILE_KEY_BY_CLASS[arrClass] || _PROFILE_KEY_BY_CLASS.bass;
    }

    // One-time migration from the pre-guitar single 'targetTuningId'
    // setting: an existing user's pick becomes their bass profile (this
    // plugin was bass-only before guitar profiles existed). Written
    // directly, bypassing _write, so load-time migration can't fire a
    // refresh before the provider is even registered.
    (function _migrateLegacyTuningProfile() {
        try {
            if (localStorage.getItem(STORAGE_PREFIX + 'targetTuningIdBass') != null) return;
            const legacy = localStorage.getItem(STORAGE_PREFIX + 'targetTuningId');
            if (legacy == null) return;
            _mem.targetTuningIdBass = legacy;
            localStorage.setItem(STORAGE_PREFIX + 'targetTuningIdBass', legacy);
        } catch (_) { /* storage blocked — per-class defaults apply */ }
    })();

    function _readCustomTunings() {
        let list;
        try { list = JSON.parse(_read('customTunings') || '[]'); } catch (_) { list = []; }
        if (!Array.isArray(list)) return [];
        return list.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string'
            && CR.isValidTuningStringsArray(p.strings));
    }
    function _writeCustomTunings(list) { _write('customTunings', JSON.stringify(list)); }

    // Per-tuning capo/octave quick-adjust overrides (the player-controls
    // sliders), one global blob keyed by the resolved tuning id: an
    // override replaces the profile's own saved capo/capoEnabled/
    // octaveOffset defaults (including back to off/0), so a quick capo on
    // EADGBE never leaks onto the cello preset.
    function _readTuningAdjustOverrides() {
        let map;
        try { map = JSON.parse(_read('tuningAdjustOverrides') || '{}'); } catch (_) { map = null; }
        return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    }
    function _writeTuningAdjustOverride(tuningId, capo, capoEnabled, octave) {
        if (typeof tuningId !== 'string' || !tuningId) return;
        const map = _readTuningAdjustOverrides();
        map[tuningId] = { capo, capoEnabled, octave };
        _write('tuningAdjustOverrides', JSON.stringify(map));
    }

    // Silent auto-saved "active" tuning (CR.ACTIVE_TUNING_ID) — the
    // unsaved user-defined tuning the settings editor edits live. While
    // one exists it overlays every arrangement class and carries its own
    // capo/octave, so the override map above is skipped for it.
    function _readActiveTuning() {
        const active = CR.parseActiveTuning(_read('activeTuning'));
        if (!active) return null;
        const gray = active.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        active.colors = CR.resolveColorsArray(active.colors, active.strings.length, gray);
        return active;
    }
    function _writeActiveTuning(d) {
        const normalized = CR.parseActiveTuning(d);
        if (!normalized) return false;
        _write('activeTuning', JSON.stringify({
            strings: normalized.strings,
            colors: normalized.colors,
            maxFret: normalized.maxFret,
            capo: normalized.capo,
            octaveOffset: normalized.octaveOffset,
        }));
        return true;
    }
    function _clearActiveTuning() {
        if (_read('activeTuning')) _write('activeTuning', '');
    }

    // Resolves a class's active tuning to { id, strings, colors, roles,
    // maxFret, capo, capoEnabled, octaveOffset }: an unsaved active-tuning
    // overlay wins outright, else the class's built-in/custom profile with
    // any quick-adjust override laid over its own capo/capoEnabled/
    // octaveOffset defaults.
    function _resolveActiveTuning(arrClass) {
        const active = _readActiveTuning();
        if (active) return active;
        const t = CR.resolveActiveTuning(_read(_profileKeyFor(arrClass)), _readCustomTunings(), arrClass);
        const ov = _readTuningAdjustOverrides()[t.id];
        if (ov && typeof ov === 'object') {
            if (CR.isValidCapo(ov.capo, t.maxFret)) t.capo = ov.capo;
            if (typeof ov.capoEnabled === 'boolean') t.capoEnabled = ov.capoEnabled;
            if (CR.isValidOctaveOffset(ov.octave)) t.octaveOffset = ov.octave;
        }
        return t;
    }

    // Settings.html bridge — see settings.html's own comment for why it
    // dynamic-imports src/chart-retune.js directly rather than mirroring
    // constants, and falls back to raw localStorage writes when these
    // globals haven't registered yet.
    window.cr3dSetActiveTuning = (arrClass, id) => {
        _clearActiveTuning();
        _write(_profileKeyFor(arrClass), String(id || CR.defaultTuningIdForClass(arrClass)));
    };
    window.cr3dWriteActiveTuning = (d) => _writeActiveTuning(d);
    window.cr3dClearActiveTuning = () => _clearActiveTuning();
    window.cr3dGetResolvedTuning = (arrClass) => _resolveActiveTuning(arrClass || _crAdjArrClass);
    window.cr3dActiveArrClass = () => _crAdjArrClass;
    window.cr3dSaveCustomTuning = (profile) => {
        if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) return null;
        if (!CR.isValidTuningStringsArray(profile.strings)) return null;
        const n = profile.strings.length;
        const grayDefaults = profile.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        const colors = CR.resolveColorsArray(profile.colors, n, grayDefaults);
        const maxFret = CR.isValidMaxFret(profile.maxFret) ? profile.maxFret : CR.DEFAULT_MAX_FRET;
        const capo = CR.resolveCapo(profile.capo, maxFret);
        const capoEnabled = CR.resolveCapoEnabled(profile.capoEnabled);
        const octaveOffset = CR.resolveOctaveOffset(profile.octaveOffset);
        const list = _readCustomTunings();
        const id = (typeof profile.id === 'string' && profile.id)
            ? profile.id
            : 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const entry = { id, name: profile.name.trim(), strings: profile.strings.slice(0, n), colors, maxFret, capo, capoEnabled, octaveOffset };
        const idx = list.findIndex(p => p.id === id);
        if (idx >= 0) list[idx] = entry; else list.push(entry);
        _writeCustomTunings(list);
        // An editor save is the deliberate act — drop any quick-adjust
        // override for this tuning so the freshly saved defaults apply.
        const overrides = _readTuningAdjustOverrides();
        if (overrides[id]) {
            delete overrides[id];
            _write('tuningAdjustOverrides', JSON.stringify(overrides));
        }
        _clearActiveTuning();
        return id;
    };
    window.cr3dDeleteCustomTuning = (id) => {
        _writeCustomTunings(_readCustomTunings().filter(p => p.id !== id));
        const overrides = _readTuningAdjustOverrides();
        if (overrides[id]) {
            delete overrides[id];
            _write('tuningAdjustOverrides', JSON.stringify(overrides));
        }
        for (const cls of _PROFILE_CLASSES) {
            if (_read(_profileKeyFor(cls)) === id) window.cr3dSetActiveTuning(cls, null);
        }
    };

    /* ── Standard open-string base MIDI, by string count ─────────────────
     * Same table as lib/song.py's base_open_string_midis / static/js/
     * tuning-display.js's _TUNING_BASE_MIDI / highway_3d's own
     * _baseOpenStringMidis — so a consuming renderer's independently
     * computed base, combined with the tuning offsets + capo this plugin
     * returns from _transform(), reconstructs the exact resolved target
     * pitch for its open-string nut labels.
     */
    const _BASE_OPEN_MIDI = {
        4: [28, 33, 38, 43],
        5: [23, 28, 33, 38, 43],
        6: [40, 45, 50, 55, 59, 64],
        7: [35, 40, 45, 50, 55, 59, 64],
        8: [30, 35, 40, 45, 50, 55, 59, 64],
    };
    function _rendererBaseOpenMidi(n, isBass) {
        const base = (n === 4 || n === 5)
            ? (isBass ? _BASE_OPEN_MIDI[n] : _BASE_OPEN_MIDI[6].slice(0, n))
            : (_BASE_OPEN_MIDI[n] || _BASE_OPEN_MIDI[6]);
        return base.slice();
    }

    // Runs the remap engine over one notes/chords/anchors/templates view.
    // `sourceTuning`/`sourceCapo`/`sourceStringCount` describe the CHART's
    // own tuning (songInfo, untouched by this plugin); `targetMidiTuning`/
    // `maxFret` are this plugin's resolved target, already folding in this
    // plugin's own (separate) target capo when enabled — see
    // _transform(). Frets come back capo-relative (no displayFretOffset)
    // — the standard chart convention every consuming renderer already
    // understands, pairing with the `capo` field _transform() returns
    // separately.
    function _applyRetune(notes, chords, anchors, chordTemplates, sourceTuning, sourceCapo, sourceStringCount, targetMidiTuning, maxFret) {
        const bundle = {
            notes, chords, anchors: anchors || [], chordTemplates,
            tuning: sourceTuning, capo: sourceCapo, stringCount: sourceStringCount,
        };
        CR.createRetuner().apply(bundle, targetMidiTuning, maxFret);
        return bundle;
    }

    // The chart-transform provider entry point (feedBack#952) — called by
    // core after every difficulty-filter rebuild (song ready, mastery
    // slider move, explicit refresh), never per frame. `input` carries
    // isolated copies of the chart's difficulty-filtered and
    // full-difficulty arrays; the retuner is re-run over each view since
    // its own cache only tracks one input shape at a time.
    function _transform(input) {
        const songInfo = input.songInfo || {};
        const arrClass = CR.arrangementClassFor(songInfo.arrangement);
        _crAdjNoteArrClass(arrClass);
        _crMountAdjustControls();

        const active = _resolveActiveTuning(arrClass);
        const target = CR.resolveTargetTuning(active.strings);
        // The plugin's OWN target-side capo — a separate concept from
        // whatever capo (if any) the chart's SOURCE was recorded with.
        // The source's capo still feeds sourceCapo below, so the engine
        // always matches against the chart's true sounding pitches; this
        // capo instead describes the TARGET instrument, and only applies
        // when the tuning's capoEnabled flag is on (off by default — a
        // disabled tuning's capo fret is preserved in storage but never
        // reaches the remap).
        const effCapo = active.capoEnabled ? active.capo : 0;
        const remapMidiTuning = (effCapo === 0 && active.octaveOffset === 0)
            ? target.midiTuning
            : CR.effectiveTargetMidiTuning(target.midiTuning, effCapo, active.octaveOffset);
        const maxFret = CR.effectiveMaxFret(active.maxFret, effCapo);

        const filtered = _applyRetune(input.notes, input.chords, input.anchors, input.chordTemplates,
            songInfo.tuning, songInfo.capo, input.stringCount, remapMidiTuning, maxFret);
        const sameSet = input.allNotes === input.notes && input.allChords === input.chords;
        const all = sameSet ? filtered : _applyRetune(input.allNotes, input.allChords, null, input.chordTemplates,
            songInfo.tuning, songInfo.capo, input.stringCount, remapMidiTuning, maxFret);

        const n = target.midiTuning.length;
        const isBass = /\bbass\b/i.test(songInfo.arrangement || '');
        const base = _rendererBaseOpenMidi(n, isBass);
        const tuningOffsets = target.midiTuning.map((m, i) => m - base[Math.min(i, base.length - 1)]);

        return {
            notes: filtered.notes,
            chords: filtered.chords,
            anchors: filtered.anchors,
            allNotes: all.notes,
            allChords: all.chords,
            chordTemplates: filtered.chordTemplates,
            stringCount: n,
            tuning: tuningOffsets,
            capo: effCapo,
        };
    }

    /* ── Capo & octave quick controls (player chrome) ────────────────────
     * A capo on/off toggle + fret slider, and an octave slider, in the
     * player chrome — v3's always-reachable plugin slot
     * (window.feedBack.ui.playerControlSlot()) or, in classic v2,
     * #player-controls — so a player can clamp a capo on / shift the
     * chart an octave without a settings round-trip. This capo is this
     * plugin's OWN target-side concept (see _transform()), independent of
     * whatever capo the chart's source used. They edit the active tuning
     * profile's capo/capoEnabled/octave (the unsaved active tuning
     * directly, a saved profile via the quick-adjust override blob),
     * applying live via refresh() and persisting per tuning. One widget
     * per session: it tracks the arrangement class of the most recently
     * transformed chart, so under splitscreen the last-loaded panel's
     * arrangement wins.
     */
    let _crAdjRoot = null;
    let _crAdjEls = null;
    let _crAdjArrClass = 'bass';
    function _crAdjProfileName(t) {
        if (t.id === CR.ACTIVE_TUNING_ID) return CR.ACTIVE_TUNING_NAME + ' (unsaved)';
        const preset = CR.BUILTIN_PRESET_TUNINGS.find(p => p.id === t.id);
        if (preset) return preset.label;
        const custom = _readCustomTunings().find(p => p.id === t.id);
        return custom ? custom.name : t.strings.join(' ');
    }
    function _crAdjRefresh() {
        if (!_crAdjEls) return;
        const t = _resolveActiveTuning(_crAdjArrClass);
        _crAdjEls.name.textContent = 'Retuner · ' + _crAdjProfileName(t);
        _crAdjEls.capoToggle.checked = !!t.capoEnabled;
        // The fret row (label + slider + readout) only shows once capo is
        // switched on — off is the default and the common case.
        _crAdjEls.capoRow.style.display = t.capoEnabled ? '' : 'none';
        _crAdjEls.capoSlider.max = String(t.maxFret - 1);
        _crAdjEls.capoSlider.value = String(t.capo);
        _crAdjEls.capoVal.textContent = t.capo === 0 ? 'off' : String(t.capo);
        _crAdjEls.octSlider.value = String(t.octaveOffset);
        _crAdjEls.octVal.textContent = (t.octaveOffset > 0 ? '+' : '') + t.octaveOffset;
    }
    function _crAdjNoteArrClass(cls) {
        if (cls === _crAdjArrClass) return;
        _crAdjArrClass = cls;
        _crAdjRefresh();
    }
    function _crAdjCommit() {
        if (!_crAdjEls) return;
        const t = _resolveActiveTuning(_crAdjArrClass);
        const capoEnabled = _crAdjEls.capoToggle.checked;
        const capo = Math.max(0, Math.min(t.maxFret - 1, parseInt(_crAdjEls.capoSlider.value, 10) || 0));
        const oct = Math.max(CR.MIN_OCTAVE_OFFSET, Math.min(CR.MAX_OCTAVE_OFFSET, parseInt(_crAdjEls.octSlider.value, 10) || 0));
        if (t.id === CR.ACTIVE_TUNING_ID) {
            _writeActiveTuning({ strings: t.strings, colors: t.colors, maxFret: t.maxFret, capo, capoEnabled, octaveOffset: oct });
            return;
        }
        _writeTuningAdjustOverride(t.id, capo, capoEnabled, oct);
    }
    function _crBuildAdjustControls() {
        const root = document.createElement('div');
        root.id = 'cr3d-adjust-controls';
        root.style.cssText = 'display:flex;gap:4px 10px;align-items:center;flex-wrap:wrap;padding:4px 8px;font-size:11px;line-height:1.2;';
        const name = document.createElement('div');
        name.style.cssText = 'font-weight:600;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;flex-basis:100%;';
        name.title = 'Chart Retuner — the active target tuning these sliders adjust';
        root.appendChild(name);

        const capoToggleWrap = document.createElement('label');
        capoToggleWrap.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;';
        capoToggleWrap.title = 'Capo on the TARGET tuning below — independent of any capo the chart itself was recorded with. Off by default.';
        const capoToggle = document.createElement('input');
        capoToggle.type = 'checkbox';
        const capoToggleText = document.createElement('span');
        capoToggleText.textContent = 'Capo';
        capoToggleWrap.appendChild(capoToggle);
        capoToggleWrap.appendChild(capoToggleText);
        root.appendChild(capoToggleWrap);

        function row(labelText, min, max, title) {
            const wrap = document.createElement('label');
            wrap.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer;';
            wrap.title = title;
            const text = document.createElement('span');
            text.textContent = labelText;
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = String(min);
            slider.max = String(max);
            slider.step = '1';
            slider.style.cssText = 'width:110px;';
            const val = document.createElement('span');
            val.style.cssText = 'min-width:2.2em;text-align:right;font-variant-numeric:tabular-nums;';
            wrap.appendChild(text);
            wrap.appendChild(slider);
            wrap.appendChild(val);
            root.appendChild(wrap);
            return { wrap, slider, val };
        }
        const capo = row('Fret', 0, CR.DEFAULT_MAX_FRET - 1,
            'Capo fret for the active target tuning. One fret = one half-step up per string; frets above (max fret − capo) fall off the neck. Applies live; persists per tuning.');
        const oct = row('Octave', CR.MIN_OCTAVE_OFFSET, CR.MAX_OCTAVE_OFFSET,
            'Shift the whole chart up/down whole octaves — +1 plays an E-standard bass chart on guitar strings note-for-note. Applies live; persists per tuning.');
        capoToggle.addEventListener('change', _crAdjCommit);
        capo.slider.addEventListener('input', _crAdjCommit);
        oct.slider.addEventListener('input', _crAdjCommit);
        _crAdjRoot = root;
        _crAdjEls = {
            name, capoToggle, capoRow: capo.wrap, capoSlider: capo.slider, capoVal: capo.val,
            octSlider: oct.slider, octVal: oct.val,
        };
    }
    function _crMountAdjustControls() {
        if (typeof document === 'undefined') return;
        const fb = window.feedBack;
        // v3: mount into the stable plugin slot (never #player-controls —
        // its legacy anchors are gone and the transport auto-hides; see
        // CLAUDE.md "player-chrome contract"). v2: append to the classic
        // always-visible controls bar.
        const isV3 = !!(fb && fb.uiVersion === 'v3');
        const slot = (isV3 && fb.ui && typeof fb.ui.playerControlSlot === 'function')
            ? fb.ui.playerControlSlot()
            : document.getElementById('player-controls');
        if (!slot) return;
        // Re-injection guard against the ACTUAL container, not a
        // hard-coded id (the host shim may re-home nodes).
        if (_crAdjRoot && slot.contains(_crAdjRoot)) { _crAdjRefresh(); return; }
        if (!_crAdjRoot) _crBuildAdjustControls();
        slot.appendChild(_crAdjRoot);
        _crAdjRefresh();
    }
    // Keep the readouts live for any change that isn't this widget's own
    // commit — another session editing the same profiles, or a settings-
    // editor save (which also clears this tuning's override).
    const _refreshListeners = [_crAdjRefresh];

    /* ── chart-transform capability registration ─────────────────────── */
    function _capabilitiesReady() {
        return !!(window.feedBack && window.feedBack.capabilities && window.feedBack.capabilities.version === 1);
    }
    function _refresh() {
        for (const fn of _refreshListeners) { try { fn(); } catch (e) { console.error('[Chart Retuner] refresh listener threw', e); } }
        if (!_capabilitiesReady()) return;
        window.feedBack.capabilities.dispatch({ capability: 'chart-transform', command: 'refresh', source: PROVIDER_ID });
    }
    function _registerAndAutoSelect() {
        const api = window.feedBack.capabilities;
        Promise.resolve(api.dispatch({
            capability: 'chart-transform',
            command: 'register-provider',
            source: PROVIDER_ID,
            payload: { providerId: PROVIDER_ID, label: 'Chart Retuner', transform: _transform },
        })).then(() => {
            // Auto-activate the first time this plugin ever registers. Core
            // persists "no selection" and "explicitly cleared" identically
            // (an absent localStorage key), so this flag is the only way
            // to tell "never chosen" from "user turned it off" apart on
            // later loads.
            if (_read('autoSelected') != null) return;
            _write('autoSelected', '1');
            api.dispatch({
                capability: 'chart-transform', command: 'select-provider',
                source: PROVIDER_ID, payload: { providerId: PROVIDER_ID },
            });
        });
    }
    if (_capabilitiesReady()) _registerAndAutoSelect();
    else window.addEventListener('feedBack:capabilities:ready', _registerAndAutoSelect, { once: true });
})();
