// constants.js — shared constants for StageBuilder

export const APP_VERSION = '1.0';

export const UNITS = 'ft';
export const GRID_SIZE = 0.5;         // ft default snap
export const SNAP_DIST = 0.5;         // ft proximity for object snap
export const UNDO_DEPTH = 100;

// Arrow-key nudge. The plain step is the snap grid itself; holding Shift
// multiplies it. Expressed as a multiplier rather than a fixed distance so
// metric inherits the same relationship (0.5m grid -> 2m coarse nudge) without
// needing a second constant.
export const NUDGE_COARSE_MULT = 4;   // Shift+Arrow = 4 grid squares (2ft imperial)

// Centerline alignment guide — the flash shown when an item lands on x=0 or z=0.
export const CENTER_GUIDE_HOLD = 260;   // ms held at full opacity after release
export const CENTER_GUIDE_FADE = 420;   // ms fade-out once the hold expires
export const STORAGE_KEY = 'atlas_stage_v2';

export const STAGE_DEFAULTS = {
  concert: { w: 60, d: 40, label: 'Concert / Festival' },
  theater: { w: 50, d: 35, label: 'Theater (Proscenium)' },
  arena:   { w: 80, d: 80, label: 'Arena / 360' },
  club:    { w: 24, d: 20, label: 'Club / Black Box' },
};

export const LAYER_Y = {
  floor:  0.01,   // just above ground plane
  desk:   0.05,
  truss:  10,
  fly:    20,
};

export const DEPARTMENTS = ['audio', 'lighting', 'video', 'staging', 'instruments', 'custom', 'misc', 'labels'];

export const DEPT_COLORS = {
  audio:       '#ef4444',
  lighting:    '#111111',
  video:       '#eab308',
  staging:     '#22c55e',
  instruments: '#3b82f6',
  custom:      '#8b5cf6',   // matches the Elite upsell accent
  misc:        '#94a3b8',
  labels:      '#94a3b8',
};

// UI accent colors (sidebar dots, headers) — same as DEPT_COLORS unless
// the item default color is too dark for UI elements on a dark background.
// Lighting fixtures are black bodies (#111) but need a visible UI accent.
export const DEPT_UI_COLORS = {
  ...DEPT_COLORS,
  lighting: '#f97316',
};

/** Resolve an item's effective color — falls back to department color when colorHex is null (i.e. not customized). */
export function getItemColor(item) {
  return item.colorHex ?? DEPT_COLORS[item.department] ?? '#cccccc';
}

export const TRUSS_FACES = ['bottom', 'back', 'top', 'front'];

export const DEPT_LABELS = {
  audio:       'Audio',
  lighting:    'Lighting',
  video:       'Video',
  staging:     'Staging',
  instruments: 'Instruments',
  custom:      'Custom',
  misc:        'Misc',
  labels:      'Labels',
};
