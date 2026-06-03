/* Icons.tsx — line icon set + shared primitives (Logo, Tag, Avatar). */

import type { CSSProperties, ReactNode } from "react";

const ICON_PATHS: Record<string, string> = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  rows: "M4 5h16M4 12h16M4 19h16",
  masonry: "M4 4h6v9H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 17h6v3H4z",
  heart: "M12 20s-7-4.6-9.3-9A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9.3 5C19 15.4 12 20 12 20Z",
  download: "M12 3v12M7 11l5 5 5-5M5 21h14",
  upload: "M12 21V9M7 13l5-5 5 5M5 3h14",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  server: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.1 1.5H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z",
  plus: "M12 5v14M5 12h14",
  edit: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  layers: "M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 18l10 5 10-5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  tag: "M3 11.5V5a2 2 0 0 1 2-2h6.5L21 12.5 13.5 20 3 11.5ZM7 7h.01",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  x: "M6 6l12 12M18 6 6 18",
  check: "M5 12l5 5 9-11",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  ruler: "M5 3h4v18H5zM9 7h4M9 11h4M9 15h4M13 3h6v6M13 21h6v-6",
  slice: "M3 7h18M3 12h18M3 17h18",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5Z",
  sort: "M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3",
  sparkles: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3L12 3ZM18 14l.9 2.3L21 17l-2.1.7L18 20l-.9-2.3L15 17l2.1-.7L18 14Z",
  arrowLeft: "M19 12H5M11 18l-6-6 6-6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  link: "M9 15l6-6M10 7l1-1a4 4 0 0 1 6 6l-1 1M14 17l-1 1a4 4 0 0 1-6-6l1-1",
  dots: "M12 6h.01M12 12h.01M12 18h.01",
  trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.5 10.6a3 3 0 0 0 4 4M6.5 6.6C4 8.2 2 12 2 12s4 7 10 7a9.8 9.8 0 0 0 4.5-1.1M9.8 5.2A9.9 9.9 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-2.4 3.2",
  cube: "M12 2 3 7v10l9 5 9-5V7l-9-5ZM3 7l9 5 9-5M12 12v10",
  printer: "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  scale: "M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7ZM19 7l-3 6a3 3 0 0 0 6 0l-3-6Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  home: "M3 11l9-8 9 8M5 9v11h14V9",
  bookmark: "M6 3h12v18l-6-4-6 4V3Z",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  star: "M12 3l2.6 6.3L21 9.8l-5 4.3 1.6 6.6L12 17l-5.6 3.7L8 14.1l-5-4.3 6.4-.5L12 3Z",
  drag: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  wand: "M15 4V2M15 10V8M11 6H9M21 6h-2M6 21l11-11-2-2L4 19l2 2Z",
};

interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
  fill?: string;
}

export function Icon({ name, size = 20, stroke = 1.8, className, style, fill }: IconProps) {
  const d = ICON_PATHS[name] || "";
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
         fill={fill || "none"} stroke="currentColor" strokeWidth={stroke}
         strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {d.split("M").filter(Boolean).map((seg, i) => <path key={i} d={"M" + seg} />)}
    </svg>
  );
}

export function TroveMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
      <g stroke="var(--accent-ink)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path d="M16 6 L25 13.5 L16 26 L7 13.5 Z" />
        <path d="M7 13.5 H25" />
        <path d="M16 6 L12.5 13.5 L16 26" />
        <path d="M16 6 L19.5 13.5 L16 26" />
      </g>
    </svg>
  );
}

export function Logo({ size = 28, showText = true, tagline = true }: { size?: number; showText?: boolean; tagline?: boolean }) {
  return (
    <div className="spool-logo">
      <TroveMark size={size} />
      {showText && (
        <span className="spool-logo-textwrap">
          <span className="spool-logo-text">trove</span>
          {tagline && <span className="spool-logo-tagline">by spoolr.io</span>}
        </span>
      )}
    </div>
  );
}

export function Tag({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className={"spool-tag" + (active ? " is-active" : "")} onClick={onClick}>
      {children}
    </button>
  );
}

export function Avatar({ name, tone, size = 36 }: { name: string; tone: string; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="spool-avatar" style={{ width: size, height: size, background: tone, fontSize: size * 0.36 }}>
      {initials}
    </div>
  );
}
