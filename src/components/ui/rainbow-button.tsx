import React from 'react';
import { cn } from '@/lib/utils';

const sizes = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-11 px-8',
  icon: 'size-10 p-0',
};
const variants = {
  default: 'magic-rainbow-button--default',
  outline: 'magic-rainbow-button--outline',
};

export interface RainbowButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: keyof typeof sizes;
  variant?: keyof typeof variants;
}

export const RainbowButton = React.forwardRef<HTMLButtonElement, RainbowButtonProps>(
  ({ className, size = 'default', variant = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          'magic-rainbow-button relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap outline-none transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
          variants[variant], sizes[size], className,
        )}
        data-slot="rainbow-button"
        ref={ref}
        {...props}
      />
    );
  },
);

RainbowButton.displayName = 'RainbowButton';
