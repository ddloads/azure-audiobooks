import { useId } from "react";

interface AppLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  imageClassName?: string;
  textClassName?: string;
}

export default function AppLogo({ size = 26, showWordmark = true, className = "" }: AppLogoProps) {
  const uid = useId().replace(/:/g, "");
  const g1 = `${uid}g1`;
  const g2 = `${uid}g2`;

  return (
    <div className={`app-logo${className ? ` ${className}` : ""}`}>
      <svg
        className="app-logo-mark"
        width={size}
        height={size}
        viewBox="0 0 240 240"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={g1} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#67d3fb" />
            <stop offset="60%"  stopColor="#1f9be4" />
            <stop offset="100%" stopColor="#0e4471" />
          </linearGradient>
          <linearGradient id={g2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#1e7dc9" />
          </linearGradient>
        </defs>

        {/* Headphones arc */}
        <path d="M52 124 C52 78, 84 50, 120 50 S188 78, 188 124"
          fill="none" stroke="#03111e" strokeWidth="11" strokeLinecap="round" />
        {/* Earcups */}
        <rect x="40" y="108" width="34" height="56" rx="10" fill="#03111e" />
        <rect x="46" y="118" width="22" height="36" rx="6" fill="#1f3a5e" />
        <rect x="166" y="108" width="34" height="56" rx="10" fill="#03111e" />
        <rect x="172" y="118" width="22" height="36" rx="6" fill="#1f3a5e" />

        {/* Cloud */}
        <path d="M82 112 C82 88, 102 74, 122 78 C132 64, 158 64, 162 84 C176 86, 182 104, 172 116 L82 116 Z"
          fill={`url(#${g1})`} />

        {/* Open book — left page */}
        <path d="M82 116 L82 174 C82 174, 100 168, 120 178 L120 122 C100 114, 82 116, 82 116 Z"
          fill={`url(#${g2})`} />
        {/* Open book — right page */}
        <path d="M158 116 L158 174 C158 174, 140 168, 120 178 L120 122 C140 114, 158 116, 158 116 Z"
          fill="#1e7dc9" />
        {/* Page highlight stripes */}
        <path d="M86 124 L114 130 L114 134 L86 128 Z" fill="rgba(255,255,255,.18)" />
        <path d="M126 130 L154 124 L154 128 L126 134 Z" fill="rgba(255,255,255,.12)" />

        {/* Waveform — left page */}
        <g fill="#eaf3ff">
          <rect x="92"  y="138" width="3" height="22" rx="1.5" />
          <rect x="98"  y="132" width="3" height="34" rx="1.5" />
          <rect x="104" y="142" width="3" height="14" rx="1.5" />
          <rect x="110" y="136" width="3" height="26" rx="1.5" />
        </g>
        {/* Waveform — right page */}
        <g fill="#eaf3ff">
          <rect x="128" y="136" width="3" height="26" rx="1.5" opacity=".95" />
          <rect x="134" y="142" width="3" height="14" rx="1.5" opacity=".95" />
          <rect x="140" y="130" width="3" height="38" rx="1.5" opacity=".95" />
          <rect x="146" y="140" width="3" height="18" rx="1.5" opacity=".95" />
        </g>

        {/* Server stack */}
        <rect x="74" y="184" width="92" height="14" rx="3" fill="#03111e" />
        <circle cx="156" cy="191" r="2" fill="#38bdf8" />
        <circle cx="150" cy="191" r="2" fill="#67d3fb" opacity=".7" />
        <rect x="80" y="189" width="22" height="3" fill="#1f3a5e" />
        <rect x="74" y="202" width="92" height="14" rx="3" fill="#0a2138" />
        <circle cx="156" cy="209" r="2" fill="#67d3fb" />
        <circle cx="150" cy="209" r="2" fill="#38bdf8" opacity=".7" />
        <rect x="80" y="207" width="22" height="3" fill="#1f3a5e" />
      </svg>

      {showWordmark && <span className="app-logo-wordmark">Azure</span>}
    </div>
  );
}
