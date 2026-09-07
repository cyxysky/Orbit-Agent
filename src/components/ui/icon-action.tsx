'use client';

import type { ReactNode } from 'react';
import { Tooltip } from '@heroui/react/tooltip';
import { Button } from '@heroui/react/button';

export function IconAction({ label, children, onClick, disabled, className = '' }: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return <Tooltip delay={300}>
    <Button isIconOnly aria-label={label} className={`ui-icon-button ${className}`} isDisabled={disabled} onPress={onClick} type="button" variant="ghost">{children}</Button>
    <Tooltip.Content placement="top">{label}</Tooltip.Content>
  </Tooltip>;
}
