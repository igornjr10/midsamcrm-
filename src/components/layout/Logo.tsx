import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden="true">
      <defs>
        <radialGradient id="midsam-bg" cx="38%" cy="40%" r="90%">
          <stop offset="0%" stopColor="#2E63E7" />
          <stop offset="100%" stopColor="#122E70" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#midsam-bg)" />
      <ellipse
        cx="32"
        cy="32"
        rx="23"
        ry="10.5"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        transform="rotate(-28 32 32)"
      />
      <path
        d="M32 17c1.6 8.6 6.4 13.4 15 15-8.6 1.6-13.4 6.4-15 15-1.6-8.6-6.4-13.4-15-15 8.6-1.6 13.4-6.4 15-15Z"
        fill="#fff"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">Midsam CRM</span>
    </div>
  );
}
