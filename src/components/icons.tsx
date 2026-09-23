import type { SVGProps } from 'react';

// ─────────────────────────────────────────────
// ICONS (decorative, 24×24 stroke icons using currentColor; always aria-hidden)
// ─────────────────────────────────────────────

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </Icon>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5v14M16 5v14" strokeWidth={3} />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12 5 5 9-10" />
    </Icon>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" />
      <path d="M4 4v4.6h4.6" />
    </Icon>
  );
}

/** App logo: sun above a tilted panel. */
export function LogoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true" focusable="false" {...props}>
      <circle cx="22" cy="9" r="5" fill="var(--sun)" />
      <path d="M4 17h14l-4 11H0z" fill="var(--panel-cell)" stroke="var(--panel-edge)" strokeWidth="1.2" />
      <path
        d="M7.5 17 3.5 28M11 17 7 28M2 22.5h14"
        stroke="var(--panel-edge)"
        strokeWidth="0.9"
        opacity="0.7"
      />
      <path d="M4 17h14" stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
