import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed shadow-[0_1px_2px_hsl(var(--shadow-color)/0.04)] ring-offset-background placeholder:text-muted-foreground/60 transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
