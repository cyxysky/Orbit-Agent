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
import { resolveWorkspaceBrand } from './product';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


const PREFIX_STORAGE_KEY = 'orbit.brandPrefix';
const TEXT_STORAGE_KEY = 'orbit.brandText';
const LEGACY_PREFIX_STORAGE_KEY = 'webpilotqa.brandPrefix';
const LEGACY_TEXT_STORAGE_KEY = 'webpilotqa.brandText';
const MAX_BRAND_PART_LENGTH = 48;
const { brandPrefix: DEFAULT_BRAND_PREFIX, brandText: DEFAULT_BRAND_TEXT } = resolveWorkspaceBrand();

type WorkspaceBrandContextValue = {
  brandPrefix: string;
  brandText: string;
  setBrandPrefix: (value: string) => void;
  setBrandText: (value: string) => void;
};

const WorkspaceBrandContext = createContext<WorkspaceBrandContextValue | undefined>(undefined);

function boundedBrandPart(value: string) {
  return value.slice(0, MAX_BRAND_PART_LENGTH);
}

export function WorkspaceBrandProvider({ children }: { children: ReactNode }) {
  const [brandPrefix, setBrandPrefixState] = useState(DEFAULT_BRAND_PREFIX);
  const [brandText, setBrandTextState] = useState(DEFAULT_BRAND_TEXT);

  useEffect(() => {
    const syncStoredBrand = () => {
      try {
        const brand = resolveWorkspaceBrand({
          prefix: window.localStorage.getItem(PREFIX_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_PREFIX_STORAGE_KEY) ?? DEFAULT_BRAND_PREFIX,
          text: window.localStorage.getItem(TEXT_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_TEXT_STORAGE_KEY) ?? DEFAULT_BRAND_TEXT,
        });
        setBrandPrefixState(brand.brandPrefix);
        setBrandTextState(brand.brandText);
        if (window.localStorage.getItem(PREFIX_STORAGE_KEY) !== brand.brandPrefix) window.localStorage.setItem(PREFIX_STORAGE_KEY, brand.brandPrefix);
        if (window.localStorage.getItem(TEXT_STORAGE_KEY) !== brand.brandText) window.localStorage.setItem(TEXT_STORAGE_KEY, brand.brandText);
      } catch { /* Browser storage may be unavailable in embedded/private sessions. */ }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PREFIX_STORAGE_KEY || event.key === TEXT_STORAGE_KEY) {
        syncStoredBrand();
      }
    };
    syncStoredBrand();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setBrandPrefix = useCallback((value: string) => {
    const nextValue = boundedBrandPart(value);
    setBrandPrefixState(nextValue);
    window.localStorage.setItem(PREFIX_STORAGE_KEY, nextValue);
  }, []);

  const setBrandText = useCallback((value: string) => {
    const nextValue = boundedBrandPart(value);
    setBrandTextState(nextValue);
    window.localStorage.setItem(TEXT_STORAGE_KEY, nextValue);
  }, []);

  const contextValue = useMemo<WorkspaceBrandContextValue>(() => ({
    brandPrefix,
    brandText,
    setBrandPrefix,
    setBrandText,
  }), [brandPrefix, brandText, setBrandPrefix, setBrandText]);

  return (
    <WorkspaceBrandContext.Provider value={contextValue}>
      {children}
    </WorkspaceBrandContext.Provider>
  );
}

export function useWorkspaceBrand() {
  const context = useContext(WorkspaceBrandContext);
  if (!context) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'useWorkspaceBrand must be used inside WorkspaceBrandProvider');
  return context;
}
