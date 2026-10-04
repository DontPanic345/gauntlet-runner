// Persistent player settings (localStorage), applied live through change events.
// The `title` piece builds the settings UI on top of this; everything else just reads.
//
//   settings.get('shake')        settings.set('shake', 0.5)
//   settings.onChange((key, value) => ...)

const STORE_KEY = 'gr.settings.v1';

export const SETTING_DEFAULTS = {
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  shake: 1,          // 0..1 multiplier on all screen shake (accessibility)
  flashes: 1,        // 0..1 multiplier on full-screen flashes (accessibility)
  showFps: false,
  keyDisplay: 'auto', // prompt glyphs: 'auto' (last device used) | 'keyboard' | 'gamepad' (title piece)
};

const values = { ...SETTING_DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    for (const k in SETTING_DEFAULTS) if (typeof saved[k] === typeof SETTING_DEFAULTS[k]) values[k] = saved[k];
  }
} catch { /* storage blocked: defaults */ }

const listeners = new Set();

export const settings = {
  get: (key) => values[key],
  set(key, value) {
    if (!(key in SETTING_DEFAULTS)) throw new Error(`settings: unknown key "${key}"`);
    values[key] = value;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(values)); } catch { /* ignore */ }
    for (const fn of listeners) fn(key, value);
  },
  all: () => ({ ...values }),
  reset() { for (const k in SETTING_DEFAULTS) settings.set(k, SETTING_DEFAULTS[k]); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
