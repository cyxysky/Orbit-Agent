'use client';

import { useEffect, useState } from 'react';
import type { BrowserChatOutputPerformance } from '@/lib/browser-chat-activity';
import { useI18n } from '@/i18n/I18nProvider';

export function formatOutputTokensPerSecond(outputPerformance?: BrowserChatOutputPerformance) {
  const tokensPerSecond = outputPerformance?.outputTokensPerSecond;
  if (typeof tokensPerSecond !== 'number' || !Number.isFinite(tokensPerSecond) || tokensPerSecond < 0) return '— TPS';
  return `${outputPerformance?.estimated ? '≈' : ''}${tokensPerSecond.toFixed(1)} TPS`;
}

export function outputTokensPerSecondTitle(outputPerformance?: BrowserChatOutputPerformance) {
  return outputPerformance?.includesFirstOutputWait
    ? '请求平均输出速度（包含首包等待）' : '输出生成速度';
}

const DRIVE_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

function useElapsedTime(enabled = true, startedAt?: number | string) {
  const [fallbackStartedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const parsedStartedAt = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt || '');
  const startedAtMs = Number.isFinite(parsedStartedAt) ? parsedStartedAt : fallbackStartedAt;

  useEffect(() => {
    if (!enabled) return undefined;
    const update = () => setNowMs(Date.now());
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [enabled]);

  if (!enabled) return '';

  const seconds = Math.max(0, nowMs - startedAtMs) / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export function BeautifulLoadingState({
  className = '',
  detail,
  label,
  outputPerformance,
  showElapsed = false,
  showTokensPerSecond = false,
  startedAt,
  variant = 'grid',
}: {
  className?: string;
  detail?: string;
  label: string;
  outputPerformance?: BrowserChatOutputPerformance;
  showElapsed?: boolean;
  showTokensPerSecond?: boolean;
  startedAt?: number | string;
  variant?: 'grid' | 'orbit';
}) {
  const { t } = useI18n();
  const elapsed = useElapsedTime(showElapsed, startedAt);

  return (
    <div className={`beautiful-loading-state${className ? ` ${className}` : ''}`} role="status">
      {variant === 'orbit' ? (
        <span aria-hidden="true" className="beautiful-loading-orbit" />
      ) : (
        <span aria-hidden="true" className="beautiful-loading-grid">
          {DRIVE_DELAYS.map((delay, index) => (
            <span
              className="beautiful-loading-pixel"
              key={index}
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      )}
      <span className="beautiful-loading-copy">
        <span className="beautiful-loading-label">{label}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
      {showElapsed || showTokensPerSecond ? (
        <span className="beautiful-loading-elapsed" title={showTokensPerSecond ? t(outputTokensPerSecondTitle(outputPerformance)) : undefined}>
          {showElapsed ? elapsed : null}
          {showElapsed && showTokensPerSecond ? ' · ' : null}
          {showTokensPerSecond ? formatOutputTokensPerSecond(outputPerformance) : null}
        </span>
      ) : null}
    </div>
  );
}
