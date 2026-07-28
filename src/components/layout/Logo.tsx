import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden="true">
      <defs>
        <linearGradient id="midsam-spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--primary) / 0.72)" />
        </linearGradient>
      </defs>
      {/* Órbitas cruzadas: usam a cor primária do tema, então acompanham claro/escuro */}
      <ellipse
        cx="32"
        cy="32"
        rx="29"
        ry="13.5"
        fill="none"
        stroke="hsl(var(--primary) / 0.22)"
        strokeWidth="5.4"
        transform="rotate(40 32 32)"
      />
      <ellipse
        cx="32"
        cy="32"
        rx="29"
        ry="13.5"
        fill="none"
        stroke="hsl(var(--primary) / 0.45)"
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
      <LogoMark className="h-8 w-8" />
      <span className="text-base font-bold tracking-tight">
        Midsam <span className="text-primary">CRM</span>
      </span>
    </div>
  );
}
