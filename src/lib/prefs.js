// Per-device preferences (not synced): appearance and which food databases to use.
// Kept in localStorage so they apply instantly, before the profile loads.

const KEY = 'lili:prefs'

export const DEFAULT_PREFS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  usda: true, // USDA FoodData Central
  off: true, // Open Food Facts
  aiChecks: true, // AI estimates look foods up in the databases first
  checkinHours: 3, // Mimi's check-ins: every 2 or 3 hours while the app is open, 0 = off
}

export function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* private mode: preferences just won't persist */
  }
}

// index.html runs the same logic inline before first paint (no flash).
export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme
  else delete root.dataset.theme
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#ffffff'))
}
