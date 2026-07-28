import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden="true">
      <defs>
        <linearGradient id="midsam-spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7FB3DF" />
          <stop offset="100%" stopColor="#5A95CE" />
        </linearGradient>
      </defs>
      <ellipse
        cx="32"
        cy="32"
        rx="29"
        ry="13.5"
        fill="none"
        stroke="#EDF2F7"
        strokeWidth="5.4"
        transform="rotate(40 32 32)"
      />
      <ellipse
        cx="32"
        cy="32"
        rx="29"
        ry="13.5"
        fill="none"
        stroke="#A3C8E8"
        strokeWidth="5.4"
        transform="rotate(-40 32 32)"
      />
      <path
        d="M32 19c1.2 7.6 5.2 11.6 12.8 12.8C37.2 33 33.2 37 32 44.6 30.8 37 26.8 33 19.2 31.8 26.8 30.6 30.8 26.6 32 19Z"
        fill="url(#midsam-spark)"
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
