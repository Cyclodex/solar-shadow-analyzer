import type { ComponentProps, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ComponentProps<'button'> {
  /** Visual style. Default 'secondary'. */
  variant?: ButtonVariant;
  /** Default 'md' (≥ 36 px touch target); 'sm' for dense toolbars (32 px on desktop, 36 px on touch/mobile). */
  size?: 'sm' | 'md';
  /** Leading icon (decorative, aria-hidden). */
  icon?: ReactNode;
  /** Toggle buttons: sets aria-pressed and the pressed style. */
  pressed?: boolean;
  /** Icon-only button: children are hidden visually but kept as the accessible name. */
  iconOnly?: boolean;
}

/** Button with type="button" by default. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  pressed,
  iconOnly = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const cls = [styles.button, styles[variant], styles[size], iconOnly && styles.iconOnly, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} aria-pressed={pressed} {...rest}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  );
}
