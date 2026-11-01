import { useCallback, useEffect, useState } from 'react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { storage } from '../storage/storage';

export type Theme = 'light' | 'dark';

const KEY = 'miTempTheme'; // same key as before, so the saved preference is kept

/** The inline script in index.html already applied this before first paint. */
function initialTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#f5f5f5');
    if (Capacitor.isNativePlatform()) {
      // Status/navigation bar icons: light icons on the dark theme and vice versa.
      void SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      storage.set(KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
