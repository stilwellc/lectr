'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

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
    localStorage.removeItem(LEGACY_KEY);
    // THE PORCELAIN is the shipped default (Aug 29 2026) — the boot script in
    // layout.tsx <head> already painted it before hydration; this mirrors the
    // same logic so React state agrees. `?light=0` opts a session back to the
    // dark catalogue (stored in DARK_KEY), `?light=1` clears the opt-out.
    let dark = false;
    try {
      const q = new URLSearchParams(window.location.search).get('light');
      if (q === '0') localStorage.setItem(DARK_KEY, '1');
      else if (q === '1') localStorage.removeItem(DARK_KEY);
      localStorage.removeItem('lectr-light-poc'); // retired POC opt-in key
      dark = localStorage.getItem(DARK_KEY) === '1';
    } catch { /* private mode */ }
    setTheme(dark ? 'dark' : 'light');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-theme', theme);
    // the porcelain attribute travels with the theme — every light rule keys
    // on the data-theme="light" + data-lectr-light pair
    document.documentElement.toggleAttribute('data-lectr-light', theme === 'light');
    localStorage.setItem(STORAGE_KEY, theme);
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
