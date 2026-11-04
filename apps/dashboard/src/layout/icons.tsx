import type * as React from "react";

// Lucide icon paths (ISC), inline as in Design's handoff markup; decorative.
const lucide =
  (name: string, body: React.ReactNode) =>
  ({ className }: { className?: string }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        className
          ? `lucide lucide-${name} ${className}`
          : `lucide lucide-${name}`
      }
      aria-hidden="true"
    >
      {body}
    </svg>
  );

export const CopyIcon = lucide(
  "copy",
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>,
);
export const CircleAlertIcon = lucide(
  "circle-alert",
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </>,
);
export const RotateCwIcon = lucide(
  "rotate-cw",
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>,
);
export const EllipsisIcon = lucide(
  "ellipsis",
  <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </>,
);
export const LaptopIcon = lucide(
  "laptop",
  <>
    <path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z" />
    <path d="M20.054 15.987H3.946" />
  </>,
);
export const RadioIcon = lucide(
  "radio",
  <>
    <path d="M16.247 7.761a6 6 0 0 1 0 8.478" />
    <path d="M19.075 4.933a10 10 0 0 1 0 14.134" />
    <path d="M4.925 19.067a10 10 0 0 1 0-14.134" />
    <path d="M7.753 16.239a6 6 0 0 1 0-8.478" />
    <circle cx="12" cy="12" r="2" />
  </>,
);
export const GlobeIcon = lucide(
  "globe",
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </>,
);
export const CirclePauseIcon = lucide(
  "circle-pause",
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="10" x2="10" y1="15" y2="9" />
    <line x1="14" x2="14" y1="15" y2="9" />
  </>,
);
export const SettingsIcon = lucide(
  "settings",
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
