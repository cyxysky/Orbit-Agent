'use client';

import { Button } from '@heroui/react/button';
import type { ComponentProps } from 'react';

type CreativeButtonProps = Omit<ComponentProps<typeof Button>, 'onPress' | 'onClick'> & {
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
};

export function CreativeButton({ disabled, onClick, className, ...props }: CreativeButtonProps) {
  return <Button size="sm" variant="secondary" {...props} className={`creative-button${props.isIconOnly ? ' creative-button-icon' : ''}${className ? ` ${className}` : ''}`} isDisabled={disabled || props.isDisabled} onPress={onClick} />;
}
