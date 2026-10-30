'use client';

import { useEffect, useState } from 'react';
import { AppInput } from '@/components/ui/app-input';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { DEFAULT_THEME_COLOR } from '@/theme/palette';

export function ThemeColorControl() {
  const { t } = useI18n();
  const { color, setColor } = useTheme();
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);

  return (
    <div className="settings-control theme-palette-control">
      <input aria-label={t('主题色')} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      <AppInput
        aria-label={t('主题色色值')}
        maxLength={7}
        onBlur={() => setDraft(color)}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          if (/^#[\da-f]{6}$/i.test(value)) setColor(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            setDraft(color);
          }
        }}
        value={draft}
      />
      <button className="ui-button ui-button--neutral" disabled={color === DEFAULT_THEME_COLOR} onClick={() => setColor(DEFAULT_THEME_COLOR)} type="button">
        {t('恢复默认配色')}
      </button>
    </div>
  );
}
