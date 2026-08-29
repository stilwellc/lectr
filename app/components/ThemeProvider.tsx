'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'costil-theme';
const LEGACY_KEY = 'mobi-theme';

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({
  theme: 'dark',
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Ray ships one look — the dark "Catalogue" ground. No light variant and
    // no OS-pref switch; force dark and clear any stale saved preference.
    localStorage.removeItem(LEGACY_KEY);
    // THE PORCELAIN POC (Aug 28 2026, local review only): `?light=1` arms the
    // light transformation for the session (`?light=0` disarms). It rides a
    // SEPARATE attribute + storage key so the shipped dark look is untouched
    // unless explicitly armed.
    let poc = false;
    try {
      const q = new URLSearchParams(window.location.search).get('light');
      if (q === '1') { localStorage.setItem('lectr-light-poc', '1'); poc = true; }
      else if (q === '0') { localStorage.removeItem('lectr-light-poc'); }
      else poc = localStorage.getItem('lectr-light-poc') === '1';
    } catch { /* private mode */ }
    document.documentElement.toggleAttribute('data-lectr-light', poc);
    setTheme(poc ? 'light' : 'dark');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-theme', theme);
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
