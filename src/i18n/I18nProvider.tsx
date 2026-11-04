'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { normalizeLanguage, type Language } from '@/i18n/language';
import { translateText } from '@/i18n/translations';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { subscribeSettingsPreferences, updateSettingsPreference } from '@/lib/settings-preferences';


const STORAGE_KEY = 'webpilotqa.language';
type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (value: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function readInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'zh';
  return normalizeLanguage(window.localStorage.getItem(STORAGE_KEY));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');

  useEffect(() => {
    setLanguageState(readInitialLanguage());
    return subscribeSettingsPreferences(values => setLanguageState(normalizeLanguage(values.UI_LANGUAGE)));
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    const normalized = normalizeLanguage(nextLanguage);
    setLanguageState(normalized);
    if (typeof window === 'undefined') return;
    updateSettingsPreference('UI_LANGUAGE', normalized);
  }, []);

  const t = useCallback((value: string, params?: Record<string, string | number>) => (
    translateText(language, value, params)
  ), [language]);

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'useI18n must be used inside I18nProvider');
  return context;
}
