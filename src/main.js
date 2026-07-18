// Chart Retuner — chart-transform provider runtime.
//
// feedBack's chart-transform capability domain (feedBack#952) remaps the
// chart BEFORE the built-in renderer, custom viz, overlays, and scoring
// consumers read it, so this plugin is its pure remap engine (src/) plus
// this thin runtime: settings storage, tuning resolution, the
// settings-panel bridges, the capo/octave player controls, and the
// provider registration itself.
import { CR } from './chart-retune.js';

(function () {
    'use strict';

    const PLUGIN_ID = 'chart_retuner';
    const PROVIDER_ID = 'chart_retuner';
    const PROVIDER_LABEL = 'Chart Retuner';

    /* ── Settings storage ──────────────────────────────────────────────
     * Same chart_retuner_bg_* localStorage namespace as pre-0.5.0
     * versions so every existing user's tunings/profiles/overrides
     * survive. Global-only: tuning profiles describe the player's REAL
     * physical instrument, never per-panel state. */
    const PREFIX = 'chart_retuner_bg_';
    const _mem = Object.create(null); // fallback when storage is blocked
    const _listeners = [];
    const DEFAULTS = {
        targetTuningIdBass: CR.DEFAULT_TUNING_ID,
        targetTuningIdRhythm: CR.DEFAULT_GUITAR_TUNING_ID,
        targetTuningIdLead: CR.DEFAULT_GUITAR_TUNING_ID,
        customTunings: '[]',
        tuningAdjustOverrides: '{}',
        activeTuning: '',
    };
    function _readSetting(key) {
        try {
            const v = localStorage.getItem(PREFIX + key);
            if (v != null) return v;
        } catch (_) { /* storage blocked — mem fallback below */ }
        if (_mem[key] != null) return _mem[key];
        return DEFAULTS[key] != null ? DEFAULTS[key] : null;
    }
    function _writeGlobal(key, value) {
        _mem[key] = value;
        try { localStorage.setItem(PREFIX + key, value); } catch (_) { /* storage blocked */ }
        _emitChange(key);
    }
    function _emitChange(key) {
        for (const fn of _listeners) {
            try { fn(key); } catch (_) { /* listener errors stay local */ }
        }
    }
    function _subscribe(fn) { _listeners.push(fn); }
    // Cross-tab edits (settings open in another tab) re-enter the same bus.
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('storage', (e) => {
            if (e && typeof e.key === 'string' && e.key.indexOf(PREFIX) === 0) {
                _emitChange(e.key.slice(PREFIX.length));
            }
        });
    }

    const _CR_PROFILE_KEY_BY_CLASS = {
        bass: 'targetTuningIdBass',
        rhythm: 'targetTuningIdRhythm',
        lead: 'targetTuningIdLead',
    };
    const _CR_PROFILE_CLASSES = Object.keys(_CR_PROFILE_KEY_BY_CLASS);
    const _CR_PROFILE_KEYS = Object.values(_CR_PROFILE_KEY_BY_CLASS);
    function _crProfileKeyFor(arrClass) {
        return _CR_PROFILE_KEY_BY_CLASS[arrClass] || _CR_PROFILE_KEY_BY_CLASS.bass;
    }

    // One-time migration from the pre-guitar single 'targetTuningId' key.
    (function _crMigrateLegacyTuningProfile() {
        try {
            if (localStorage.getItem(PREFIX + 'targetTuningIdBass') != null) return;
            const legacy = localStorage.getItem(PREFIX + 'targetTuningId');
            if (legacy == null) return;
            _mem.targetTuningIdBass = legacy;
            localStorage.setItem(PREFIX + 'targetTuningIdBass', legacy);
        } catch (_) { /* storage blocked — per-class defaults apply */ }
    })();

    // One-time sweep of storage orphaned by pre-0.5.0 versions (which
    // shipped their own renderer): everything under chart_retuner_bg_*
    // except the kept tuning keys (including per-panel bg_panel<N>_* keys
    // and the migrated legacy targetTuningId), plus the Butterchurn
    // chart_retuner_viz3d_* state. Runs AFTER the legacy-key migration.
    (function _crSweepOrphanedStorage() {
        const DONE_KEY = 'chart_retuner_storage_cleanup_v1';
        const KEEP = new Set(Object.keys(DEFAULTS));
        try {
            if (localStorage.getItem(DONE_KEY)) return;
            const doomed = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (typeof k !== 'string') continue;
                if (k.indexOf('chart_retuner_viz3d_') === 0) { doomed.push(k); continue; }
                if (k.indexOf(PREFIX) === 0 && !KEEP.has(k.slice(PREFIX.length))) doomed.push(k);
            }
            for (const k of doomed) localStorage.removeItem(k);
            localStorage.setItem(DONE_KEY, '1');
        } catch (_) { /* storage blocked — nothing to clean */ }
    })();

    /* ── Suggested-color palette (settings editor bridges) ───────────── */
    // Only feeds the settings editor's "suggest a color" flows.
    const DEFAULT_PALETTE = [
        0xe61f26, 0xecd234, 0x1096e6, 0xf18313,
        0x3fc413, 0xb518d9, 0xff6bd5, 0x6bffe6,
    ];
    function _crColorForRole(role) {
        switch (role) {
            case 'lowB': return CR.lowBColor();
            case 'e': return DEFAULT_PALETTE[0];
            case 'a': return DEFAULT_PALETTE[1];
            case 'd': return DEFAULT_PALETTE[2];
            case 'g': return DEFAULT_PALETTE[3];
            case 'highB': return DEFAULT_PALETTE[4];
            case 'highE': return DEFAULT_PALETTE[5];
            case 'lowExt1': return DEFAULT_PALETTE[6];
            case 'lowExt2': return DEFAULT_PALETTE[7];
            default: return CR.LIGHT_GRAY_COLOR;
        }
    }
    function _crBeadgDefaultColors() {
        return CR.BEADG_COLOR_ROLES.map(role => CR.intToHex(_crColorForRole(role)));
    }
    function _hexToIntSafe(hex) {
        if (typeof hex !== 'string') return null;
        const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
        return m ? parseInt(m[1], 16) : null;
    }

    /* ── Tuning profiles / custom tunings / adjust overrides ─────────── */
    function _crReadCustomTunings() {
        const raw = _readSetting('customTunings');
        let list;
        try { list = JSON.parse(raw || '[]'); } catch (_) { list = []; }
        if (!Array.isArray(list)) return [];
        let migrated = false;
        const out = [];
        for (const p of list) {
            if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !CR.isValidTuningStringsArray(p.strings)) continue;
            // Pre-colors 5-string profiles backfill to the BEADG role colors.
            const defaults = p.strings.length === 5
                ? _crBeadgDefaultColors()
                : p.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
            const colors = CR.resolveColorsArray(p.colors, p.strings.length, defaults);
            if (!Array.isArray(p.colors) || p.colors.length !== colors.length || p.colors.some((c, i) => c !== colors[i])) {
                migrated = true;
            }
            out.push({ id: p.id, name: p.name, strings: p.strings.slice(), colors, maxFret: p.maxFret, capo: p.capo, octaveOffset: p.octaveOffset });
        }
        if (migrated) {
            // Lazy backfill written directly so it can't re-enter the bus mid-read.
            const json = JSON.stringify(out);
            _mem.customTunings = json;
            try { localStorage.setItem(PREFIX + 'customTunings', json); } catch (_) { /* storage blocked */ }
        }
        return out;
    }
    function _crWriteCustomTunings(list) {
        _writeGlobal('customTunings', JSON.stringify(list));
    }
    function _crReadTuningAdjustOverrides() {
        const raw = _readSetting('tuningAdjustOverrides');
        let map;
        try { map = JSON.parse(raw || '{}'); } catch (_) { map = null; }
        return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    }
    function _crWriteTuningAdjustOverride(tuningId, capo, octave) {
        if (typeof tuningId !== 'string' || !tuningId) return;
        const map = _crReadTuningAdjustOverrides();
        map[tuningId] = { capo, octave };
        _writeGlobal('tuningAdjustOverrides', JSON.stringify(map));
    }
    function _crReadActiveTuning() {
        const active = CR.parseActiveTuning(_readSetting('activeTuning'));
        if (!active) return null;
        const gray = active.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        active.colors = CR.resolveColorsArray(active.colors, active.strings.length, gray);
        return active;
    }
    function _crWriteActiveTuning(d) {
        const normalized = CR.parseActiveTuning(d);
        if (!normalized) return false;
        _writeGlobal('activeTuning', JSON.stringify({
            strings: normalized.strings,
            colors: normalized.colors,
            maxFret: normalized.maxFret,
            capo: normalized.capo,
            octaveOffset: normalized.octaveOffset,
        }));
        return true;
    }
    function _crClearActiveTuning() {
        if (_readSetting('activeTuning')) _writeGlobal('activeTuning', '');
    }
    // Resolved tuning for a class: active-tuning overlay, else profile +
    // per-tuning capo/octave override laid over the profile defaults.
    function _crResolveActiveTuning(arrClass) {
        const active = _crReadActiveTuning();
        if (active) return active;
        const t = CR.resolveActiveTuning(_readSetting(_crProfileKeyFor(arrClass)), _crReadCustomTunings(), arrClass);
        const ov = _crReadTuningAdjustOverrides()[t.id];
        if (ov && typeof ov === 'object') {
            if (CR.isValidCapo(ov.capo, t.maxFret)) t.capo = ov.capo;
            if (CR.isValidOctaveOffset(ov.octave)) t.octaveOffset = ov.octave;
        }
        return t;
    }

    /* ── window.cr3d* bridges (consumed by settings.html) ────────────── */
    window.cr3dSetActiveTuning = (arrClass, id) => {
        _crClearActiveTuning();
        _writeGlobal(_crProfileKeyFor(arrClass), String(id || CR.defaultTuningIdForClass(arrClass)));
    };
    window.cr3dListCustomTunings = () => _crReadCustomTunings();
    window.cr3dWriteActiveTuning = (d) => _crWriteActiveTuning(d);
    window.cr3dClearActiveTuning = () => _crClearActiveTuning();
    window.cr3dGetResolvedTuning = (arrClass) => _crResolveActiveTuning(arrClass || _crAdjArrClass);
    window.cr3dActiveArrClass = () => _crAdjArrClass;
    window.cr3dActiveTuningId = CR.ACTIVE_TUNING_ID;
    window.cr3dSaveCustomTuning = (profile) => {
        if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) return null;
        if (!CR.isValidTuningStringsArray(profile.strings)) return null;
        const n = profile.strings.length;
        const grayDefaults = profile.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        const colors = CR.resolveColorsArray(profile.colors, n, grayDefaults);
        const maxFret = CR.isValidMaxFret(profile.maxFret) ? profile.maxFret : CR.DEFAULT_MAX_FRET;
        const capo = CR.resolveCapo(profile.capo, maxFret);
        const octaveOffset = CR.resolveOctaveOffset(profile.octaveOffset);
        const list = _crReadCustomTunings();
        const id = (typeof profile.id === 'string' && profile.id)
            ? profile.id
            : 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const entry = { id, name: profile.name.trim(), strings: profile.strings.slice(0, n), colors, maxFret, capo, octaveOffset };
        const idx = list.findIndex(p => p.id === id);
        if (idx >= 0) list[idx] = entry; else list.push(entry);
        _crWriteCustomTunings(list);
        // A deliberate save drops the quick override masking its defaults.
        const overrides = _crReadTuningAdjustOverrides();
        if (overrides[id]) {
            delete overrides[id];
            _writeGlobal('tuningAdjustOverrides', JSON.stringify(overrides));
        }
        _crClearActiveTuning();
        return id;
    };
    window.cr3dDeleteCustomTuning = (id) => {
        _crWriteCustomTunings(_crReadCustomTunings().filter(p => p.id !== id));
        const overrides = _crReadTuningAdjustOverrides();
        if (overrides[id]) {
            delete overrides[id];
            _writeGlobal('tuningAdjustOverrides', JSON.stringify(overrides));
        }
        for (const cls of _CR_PROFILE_CLASSES) {
            if (_readSetting(_crProfileKeyFor(cls)) === id) window.cr3dSetActiveTuning(cls, null);
        }
    };
    window.cr3dDefaultStringFor = (direction, edgeNoteSpec) => {
        const dir = direction === 'low' ? 'low' : 'high';
        const parsed = CR.parseTargetNote(edgeNoteSpec);
        const edgeMidi = parsed ? parsed.midi
            : CR.DEFAULT_TARGET_MIDI_TUNING[dir === 'low' ? 0 : CR.DEFAULT_TARGET_MIDI_TUNING.length - 1];
        const next = CR.defaultExtensionNote(dir, edgeMidi);
        const role = CR.colorRoleForNote(next.midi);
        return { note: next.label, color: CR.intToHex(_crColorForRole(role)) };
    };
    window.cr3dResolveDisplayColor = (strings, colors, index) => {
        if (Array.isArray(colors) && colors[index] != null && _hexToIntSafe(colors[index]) != null) return colors[index];
        const parsed = Array.isArray(strings) && CR.parseTargetNote(strings[index]);
        return CR.intToHex(_crColorForRole(parsed ? CR.colorRoleForNote(parsed.midi) : 'gray'));
    };

    /* ── The chart-transform provider ─────────────────────────────────
     * Two engine instances: one for the effective (difficulty-filtered)
     * view core renders/scores, one for the full-difficulty view behind
     * getNotes()/getChords(). Each caches by input identity + target
     * signature, so mastery moves and tuning switches re-derive from raw
     * and everything else cache-hits. */
    const _retuner = CR.createRetuner();
    const _retunerAll = CR.createRetuner();

    // Only fretted-instrument arrangements remap. Anything else — keys,
    // drums, vocals, unknown names — passes through untransformed:
    // remapping a non-fretted chart onto a string tuning is garbage.
    // Empty stays remappable (pre-guitar hosts pin 'bass').
    const REMAP_ARRANGEMENTS = /\b(?:lead|rhythm|bass|combo|guitar)\b/i;

    function _transform(input) {
        const songInfo = input.songInfo || {};
        const arrName = typeof songInfo.arrangement === 'string' ? songInfo.arrangement.trim() : '';
        if (arrName && !REMAP_ARRANGEMENTS.test(arrName)) {
            _restoreStringColors();
            return null;
        }
        const arrClass = CR.arrangementClassFor(songInfo.arrangement);
        _crAdjNoteArrClass(arrClass);
        const t = _crResolveActiveTuning(arrClass);
        const target = CR.resolveTargetTuning(t.strings);
        const remapTuning = CR.effectiveTargetMidiTuning(target.midiTuning, t.capo, t.octaveOffset);
        const maxFret = CR.effectiveMaxFret(t.maxFret, t.capo);
        const b = {
            notes: input.notes, chords: input.chords, anchors: input.anchors,
            chordTemplates: input.chordTemplates,
            tuning: songInfo.tuning, capo: songInfo.capo, stringCount: input.stringCount,
        };
        // displayFretOffset = target capo: output frets are physical.
        _retuner.apply(b, remapTuning, maxFret, t.capo);
        const out = {
            notes: b.notes, chords: b.chords, anchors: b.anchors,
            chordTemplates: b.chordTemplates,
            stringCount: target.midiTuning.length,
            // Offsets from the standard tuning for this string count, so
            // pitch-deriving consumers (scoring) see the target instrument.
            tuning: _targetTuningOffsets(target.midiTuning),
            capo: t.capo,
        };
        // Full-difficulty views only when the filter actually differs.
        if (input.allNotes !== input.notes || input.allChords !== input.chords) {
            const bAll = {
                notes: input.allNotes, chords: input.allChords, anchors: input.anchors,
                chordTemplates: input.chordTemplates,
                tuning: songInfo.tuning, capo: songInfo.capo, stringCount: input.stringCount,
            };
            _retunerAll.apply(bAll, remapTuning, maxFret, t.capo);
            out.allNotes = bAll.notes;
            out.allChords = bAll.chords;
        }
        _applyStringColors(t);
        return out;
    }
    function _targetTuningOffsets(midiTuning) {
        const standard = CR.standardOpenStringMidi(midiTuning.length);
        return midiTuning.map((m, i) => m - standard[Math.min(i, standard.length - 1)]);
    }

    /* ── String colors: apply the profile's per-string colors to every
     *    highway surface (primary + announced splitscreen panels) while
     *    our transform is active ─────────────────────────────────────── */
    const _HasWeakRef = typeof WeakRef === 'function';
    const _hwRefs = [];               // announced non-primary surfaces
    const _origColorsBySurface = typeof WeakMap === 'function' ? new WeakMap() : null;
    let _appliedColors = null;        // concrete colors currently applied, or null
    function _canColor(hw) {
        return !!(hw && typeof hw.setStringColors === 'function');
    }
    function _eachColorSurface(fn) {
        const seen = new Set();
        const primary = window.highway;
        if (_canColor(primary)) { seen.add(primary); fn(primary); }
        const live = [];
        for (const ref of _hwRefs) {
            const hw = _HasWeakRef ? ref.deref() : ref;
            if (!hw) continue;
            live.push(ref);
            if (seen.has(hw) || !_canColor(hw)) continue;
            seen.add(hw);
            fn(hw);
        }
        _hwRefs.length = 0;
        for (const ref of live) _hwRefs.push(ref);
    }
    function _applyColorsTo(hw, colors) {
        if (_origColorsBySurface && !_origColorsBySurface.has(hw) && typeof hw.getStringColors === 'function') {
            _origColorsBySurface.set(hw, hw.getStringColors());
        }
        hw.setStringColors(colors);
    }
    function _applyStringColors(t) {
        // Live-tracked presets (EADG/BEADG/EADGBE — colors: null) follow
        // the user's own Highway String Colors: leave core's colors alone
        // (and restore them if a concrete-color tuning had overridden
        // them earlier).
        if (!Array.isArray(t.colors) || !t.colors.length) {
            _restoreStringColors();
            return;
        }
        const gray = t.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        const colors = CR.resolveColorsArray(t.colors, t.strings.length, gray);
        _appliedColors = colors;
        _eachColorSurface((hw) => _applyColorsTo(hw, colors));
    }
    function _restoreStringColors() {
        _appliedColors = null;
        _eachColorSurface((hw) => {
            const orig = _origColorsBySurface && _origColorsBySurface.get(hw);
            if (orig) {
                hw.setStringColors(orig);
                _origColorsBySurface.delete(hw);
            }
        });
    }

    /* ── Capability wiring ────────────────────────────────────────────── */
    function _capabilities() {
        const api = window.feedBack && window.feedBack.capabilities;
        return (api && api.version === 1) ? api : null;
    }
    function _dispatch(command, payload) {
        const api = _capabilities();
        if (!api) return Promise.resolve(null);
        return api.dispatch({ capability: 'chart-transform', command, source: PLUGIN_ID, payload: payload || {} })
            .catch(() => null);
    }
    function _isActive() {
        const domain = window.feedBack && window.feedBack.chartTransformDomain;
        return !!(domain && domain.snapshot && domain.snapshot().active === PROVIDER_ID);
    }
    function _register() {
        return _dispatch('register-provider', { providerId: PROVIDER_ID, label: PROVIDER_LABEL, transform: _transform });
    }
    function _refreshTransform() {
        if (_isActive()) _dispatch('refresh');
    }

    // Settings changes that alter the remap re-run the installed transform.
    _subscribe((key) => {
        if (key === 'tuningAdjustOverrides' || key === 'customTunings'
            || key === 'activeTuning'
            || _CR_PROFILE_KEYS.indexOf(key) !== -1) {
            _crAdjRefresh();
            _refreshTransform();
        }
    });

    /* ── Capo & octave quick controls + enable toggle ─────────────────
     * Mounted into v3's always-reachable plugin slot
     * (window.feedBack.ui.playerControlSlot()) per the documented
     * player-chrome contract. */
    let _crAdjRoot = null;
    let _crAdjEls = null;
    let _crAdjArrClass = 'bass';
    function _crAdjProfileName(t) {
        if (t.id === CR.ACTIVE_TUNING_ID) return CR.ACTIVE_TUNING_NAME + ' (unsaved)';
        const preset = CR.BUILTIN_PRESET_TUNINGS.find(p => p.id === t.id);
        if (preset) return preset.label;
        const custom = _crReadCustomTunings().find(p => p.id === t.id);
        return custom ? custom.name : t.strings.join(' ');
    }
    function _crAdjRefresh() {
        if (!_crAdjEls) return;
        const t = _crResolveActiveTuning(_crAdjArrClass);
        _crAdjEls.name.textContent = 'Retuner · ' + _crAdjProfileName(t);
        _crAdjEls.capoSlider.max = String(t.maxFret - 1);
        _crAdjEls.capoSlider.value = String(t.capo);
        _crAdjEls.capoVal.textContent = t.capo === 0 ? 'off' : String(t.capo);
        _crAdjEls.octSlider.value = String(t.octaveOffset);
        _crAdjEls.octVal.textContent = (t.octaveOffset > 0 ? '+' : '') + t.octaveOffset;
        _crAdjEls.enable.checked = _isActive();
    }
    function _crAdjNoteArrClass(cls) {
        if (cls === _crAdjArrClass) return;
        _crAdjArrClass = cls;
        _crAdjRefresh();
    }
    function _crAdjCommit() {
        if (!_crAdjEls) return;
        const t = _crResolveActiveTuning(_crAdjArrClass);
        const capo = Math.max(0, Math.min(t.maxFret - 1, parseInt(_crAdjEls.capoSlider.value, 10) || 0));
        const oct = Math.max(CR.MIN_OCTAVE_OFFSET, Math.min(CR.MAX_OCTAVE_OFFSET, parseInt(_crAdjEls.octSlider.value, 10) || 0));
        if (t.id === CR.ACTIVE_TUNING_ID) {
            _crWriteActiveTuning({ strings: t.strings, colors: t.colors, maxFret: t.maxFret, capo, octaveOffset: oct });
            return;
        }
        _crWriteTuningAdjustOverride(t.id, capo, oct);
    }
    function _crAdjToggleEnable() {
        if (!_crAdjEls) return;
        if (_crAdjEls.enable.checked) {
            _dispatch('select-provider', { providerId: PROVIDER_ID }).then(() => _crAdjRefresh());
        } else {
            _dispatch('clear-provider').then(() => _crAdjRefresh());
        }
    }
    function _crBuildAdjustControls() {
        const root = document.createElement('div');
        root.id = 'cr-adjust-controls';
        root.style.cssText = 'display:flex;gap:4px 10px;align-items:center;flex-wrap:wrap;padding:4px 8px;font-size:11px;line-height:1.2;';
        const head = document.createElement('label');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;flex-basis:100%;cursor:pointer;';
        head.title = 'Chart Retuner — remap the chart onto the active target tuning (applies live)';
        const enable = document.createElement('input');
        enable.type = 'checkbox';
        const name = document.createElement('span');
        name.style.cssText = 'font-weight:600;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;';
        head.appendChild(enable);
        head.appendChild(name);
        root.appendChild(head);
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
            return { slider, val };
        }
        const capo = row('Capo', 0, CR.DEFAULT_MAX_FRET - 1,
            'Capo fret for the active target tuning (0 = none). One fret = one half-step up per string; frets above (max fret − capo) fall off the neck. Applies live; persists per tuning.');
        const oct = row('Octave', CR.MIN_OCTAVE_OFFSET, CR.MAX_OCTAVE_OFFSET,
            'Shift the whole chart up/down whole octaves — +1 plays an E-standard bass chart on guitar strings note-for-note. Applies live; persists per tuning.');
        enable.addEventListener('change', _crAdjToggleEnable);
        capo.slider.addEventListener('input', _crAdjCommit);
        oct.slider.addEventListener('input', _crAdjCommit);
        _crAdjRoot = root;
        _crAdjEls = { enable, name, capoSlider: capo.slider, capoVal: capo.val, octSlider: oct.slider, octVal: oct.val };
    }
    function _crMountAdjustControls() {
        if (typeof document === 'undefined') return;
        const fb = window.feedBack;
        // Per the documented player-chrome contract: detect v3 via
        // uiVersion and mount into the plugin slot; v2/other hosts get
        // the classic #player-controls bar.
        const isV3 = !!(fb && fb.uiVersion === 'v3');
        const slot = (isV3 && fb.ui && typeof fb.ui.playerControlSlot === 'function')
            ? fb.ui.playerControlSlot()
            : document.getElementById('player-controls');
        if (!slot) return;
        if (_crAdjRoot && slot.contains(_crAdjRoot)) { _crAdjRefresh(); return; }
        if (!_crAdjRoot) _crBuildAdjustControls();
        slot.appendChild(_crAdjRoot);
        _crAdjRefresh();
    }

    /* ── Boot ─────────────────────────────────────────────────────────── */
    const api = _capabilities();
    if (api) {
        _register();
        // Sync the enable toggle + string colors with domain selection.
        try {
            api.subscribe('chart-transform:transform-changed', (detail) => {
                const d = detail || {};
                if (d.to !== PROVIDER_ID) _restoreStringColors();
                _crAdjRefresh();
            });
        } catch (_) { /* subscribe is best-effort */ }
    }
    const bus = window.feedBack;
    if (bus && typeof bus.on === 'function') {
        // Re-check the mount + arrangement class as songs load.
        bus.on('song:ready', () => {
            _crMountAdjustControls();
            const hw = window.highway;
            const info = hw && typeof hw.getSongInfo === 'function' ? hw.getSongInfo() : null;
            if (info) _crAdjNoteArrClass(CR.arrangementClassFor(info.arrangement));
        });
        // New highway surfaces (splitscreen panels): core installs the
        // transform on them via the chart-transform domain; mirror the
        // currently applied per-tuning colors onto them here.
        bus.on('highway:created', (e) => {
            const hw = e && e.detail && e.detail.highway;
            if (!_canColor(hw) || hw === window.highway) return;
            _hwRefs.push(_HasWeakRef ? new WeakRef(hw) : hw);
            if (_appliedColors) _applyColorsTo(hw, _appliedColors);
        });
    }
    _crMountAdjustControls();

    // Diagnostics: active tuning ids only — never song identity.
    if (bus && bus.diagnostics && typeof bus.diagnostics.contribute === 'function') {
        _subscribe(() => {
            try {
                bus.diagnostics.contribute(PLUGIN_ID, {
                    schema: 'chart_retuner.client_diag.v2',
                    profiles: {
                        bass: _readSetting('targetTuningIdBass'),
                        rhythm: _readSetting('targetTuningIdRhythm'),
                        lead: _readSetting('targetTuningIdLead'),
                    },
                    customTuningCount: _crReadCustomTunings().length,
                    active: _isActive(),
                });
            } catch (_) { /* diagnostics are best-effort */ }
        });
    }
})();
