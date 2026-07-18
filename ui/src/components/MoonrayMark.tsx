/**
 * The Moonray emblem: a moon disc cut by a single chord, its minor segment
 * slid apart in gold — the game's mechanic as a mark. Pure SVG, no assets.
 */
export function MoonrayMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
    >
      {/* orbit ring */}
      <circle cx="24" cy="25" r="21" stroke="rgba(168,188,255,0.25)" strokeWidth="1" strokeDasharray="1.5 5" />
      {/* major segment of the sliced moon */}
      <path
        d="M15.36 15.27 A13 13 0 1 0 36.84 26.73 Z"
        fill="rgba(168,188,255,0.2)"
        stroke="#bccbff"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* minor segment, displaced along the cut normal */}
      <path
        d="M15.36 15.27 A13 13 0 0 1 36.84 26.73 Z"
        transform="translate(2.4 -4.2)"
        fill="#edc266"
        stroke="#ffe4a8"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      {/* the isolated moonlet */}
      <circle cx="20.6" cy="29.2" r="2.1" fill="#edc266" />
      <circle cx="20.6" cy="29.2" r="4.4" stroke="rgba(237,194,102,0.45)" strokeWidth="0.8" />
      {/* star specks */}
      <circle cx="6.5" cy="9.5" r="0.9" fill="rgba(232,238,255,0.75)" />
      <circle cx="42.5" cy="13" r="0.7" fill="rgba(232,238,255,0.55)" />
      <circle cx="9" cy="41" r="0.7" fill="rgba(232,238,255,0.5)" />
    </svg>
  )
}
