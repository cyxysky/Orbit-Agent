'use client';

import { LiquidGlassLoader } from '@/components/LiquidGlassLoader';
import { useI18n } from '@/i18n/I18nProvider';

export function AiOperationsLoading() {
  const { language } = useI18n();
  return (
    <div className="workspace-route-loading" role="status">
      <LiquidGlassLoader />
      <span>{language === 'en' ? 'Loading AI operations…' : '正在加载 AI 运营数据…'}</span>
    </div>
  );
}
