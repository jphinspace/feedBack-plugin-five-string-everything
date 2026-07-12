// Five-String Everything — per-string color role resolution + hex
// handling. Pure, no dependency on Three.js or screen.js's closure state
// (screen.js owns the actual palette values — PALETTES.default,
// FSE.lowBColor()'s live "Low B" lookup — and maps the symbolic roles
// this module produces to real colors via its own small role->color
// table). One of four modules the fse-retune.js barrel aggregates into
// the `FSE` namespace — see that file for the full picture.

import { parseTargetNote } from './pitch.js';
import { EXTENDED_DEFAULT_TARGET_TUNING } from './target-tuning.js';

// Symbolic color ROLE per note in the extended BEADG chain
// (target-tuning.js's EXTENDED_DEFAULT_TARGET_TUNING), in the same
// low-to-high order. Built once from that array rather than duplicating
// its MIDI values in a second hardcoded table, so the two can't drift out
// of sync.
const EXTENDED_COLOR_ROLES = ['lowExt2', 'lowExt1', 'lowB', 'e', 'a', 'd', 'g', 'highB', 'highE'];
const _colorRoleByMidi = new Map(
    EXTENDED_DEFAULT_TARGET_TUNING.map((spec, i) => [parseTargetNote(spec).midi, EXTENDED_COLOR_ROLES[i]])
);

// Symbolic color ROLE for a note produced by FSE.defaultExtensionNote (or
// any note matching one of the BEADG-chain pitches above) — deliberately
// NOT an actual color value, since the real palette is screen.js/Three.js-
// owned data this module has no business embedding. Any note outside the
// known chain (3rd+ extension in either direction, or a non-default/
// custom tuning's own notes) returns 'gray' — screen.js resolves that to
// a fixed light-gray fallback (LIGHT_GRAY_COLOR below); an accepted edge
// case (two added strings can look identical), not a bug — the user can
// always repaint via the per-string color picker.
//
// NOTE-based, not position-based — only meaningful for a NEWLY ADDED
// extension string, whose only stable identity is the note
// FSE.defaultExtensionNote just computed for it. The base 5 BEADG-derived
// positions (a fresh tuning's seed, or migrating a pre-existing 5-string
// profile) use BEADG_COLOR_ROLES (index-based) instead — colors there are
// pinned to STRING POSITION, not note identity, by longstanding design (a
// custom tuning like AEADG has a non-B note at position 0, but that
// position still gets the "Low B" role).
export function colorRoleForNote(midi) {
    return _colorRoleByMidi.get(midi) || 'gray';
}

// Index-based color roles for the 5 BEADG core positions — see
// colorRoleForNote's doc comment for why this is index-based rather than
// note-based. Used both to backfill a pre-existing 5-string custom
// profile's missing `colors` (reproducing its exact historical rendering)
// and to seed color swatches for a brand-new tuning's editor session.
export const BEADG_COLOR_ROLES = ['lowB', 'e', 'a', 'd', 'g'];

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
export function lowBColor() {
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
// Inverse of hexToInt — numeric 0xRRGGBB -> "#rrggbb" string, for building
// the hex-string colors a tuning profile persists.
export function intToHex(n) {
    return '#' + (n >>> 0).toString(16).padStart(6, '0');
}
// Fallback color for a note/slot with no meaningful default (see
// colorRoleForNote's 'gray' case) — plain CSS "light gray". An accepted
// edge case per explicit product direction (two added strings can render
// identically), not a bug.
export const LIGHT_GRAY_COLOR = 0xd3d3d3;

// Resolves a possibly-partial/invalid user-supplied colors array into a
// fully-populated one of exactly `length` hex strings: `colorsIn[i]` is
// kept when it's a valid hex string, otherwise `defaults[i]` is used.
// Handles every input shape uniformly — `colorsIn` missing entirely, the
// wrong length, or individually-invalid entries all just fall through to
// the per-index default — so callers don't need separate "migrate a
// wholly-missing colors array" vs "patch a partially-invalid one" code
// paths. `defaults` must already be `length` hex strings (screen.js
// resolves those via its own role->color table, since the actual palette
// values are that module's data, not this one's).
export function resolveColorsArray(colorsIn, length, defaults) {
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
        const c = Array.isArray(colorsIn) ? colorsIn[i] : undefined;
        out[i] = (typeof c === 'string' && hexToInt(c) != null) ? c : defaults[i];
    }
    return out;
}
