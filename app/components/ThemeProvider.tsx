'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { storageGet, storageRemove, storageSet } from '../lib/safe-storage';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'costil-theme';
const LEGACY_KEY = 'mobi-theme';

const DARK_KEY = 'lectr-dark';

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({
  theme: 'light',
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // every storage touch goes through safe-storage: a browser that blocks
    // site data (Safari private, "Block all") throws on the property itself
    storageRemove(LEGACY_KEY);
    // THE PORCELAIN is the shipped default (Aug 29 2026) — the boot script in
    // layout.tsx <head> already painted it before hydration; this mirrors the
    // same logic so React state agrees. `?light=0` opts a session back to the
    // dark catalogue (stored in DARK_KEY), `?light=1` clears the opt-out.
    let dark = false;
    try {
      const q = new URLSearchParams(window.location.search).get('light');
      if (q === '0') storageSet(DARK_KEY, '1');
      else if (q === '1') storageRemove(DARK_KEY);
      dark = q === '0' || (q !== '1' && storageGet(DARK_KEY) === '1');
    } catch { /* no URL */ }
    storageRemove('lectr-light-poc'); // retired POC opt-in key
    setTheme(dark ? 'dark' : 'light');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-theme', theme);
    // the porcelain attribute travels with the theme — every light rule keys
    // on the data-theme="light" + data-lectr-light pair
    document.documentElement.toggleAttribute('data-lectr-light', theme === 'light');
    storageSet(STORAGE_KEY, theme); // blocked: the theme still applies this visit
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
