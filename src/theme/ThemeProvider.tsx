'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME_COLOR, deriveThemePalette, normalizeThemeColor } from './palette';

const MODE_STORAGE_KEY = 'webpilotqa.themeMode';
const COLOR_STORAGE_KEY = 'webpilotqa.themeColor';
export type ThemeMode = 'dark' | 'light';

type ThemeContextValue = {
  color: string;
  setColor: (color: string) => void;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle('dark', mode === 'dark');
  root.style.setProperty('color-scheme', mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [color, setColorState] = useState(DEFAULT_THEME_COLOR);

  useEffect(() => {
    setModeState(normalizeThemeMode(window.localStorage.getItem(MODE_STORAGE_KEY)));
    setColorState(normalizeThemeColor(window.localStorage.getItem(COLOR_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    applyThemeMode(mode);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const reference: Record<string, string> = {};
    for (const property of Array.from(styles)) {
      if (property.startsWith('--palette-')) reference[property.slice(10)] = styles.getPropertyValue(property).trim();
    }
    for (const [key, value] of Object.entries(deriveThemePalette(reference, color))) {
      root.style.setProperty(`--theme-${key}`, value);
    }
  }, [color]);

  const setColor = useCallback((nextColor: string) => {
    const normalized = normalizeThemeColor(nextColor);
    setColorState(normalized);
    window.localStorage.setItem(COLOR_STORAGE_KEY, normalized);
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    const normalized = normalizeThemeMode(nextMode);
    applyThemeMode(normalized);
    setModeState(normalized);
    window.localStorage.setItem(MODE_STORAGE_KEY, normalized);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const value = useMemo(() => ({ color, setColor, mode, setMode, toggleMode }), [color, setColor, mode, setMode, toggleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
