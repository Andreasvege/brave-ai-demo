import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        accent: "bg-accent-soft text-accent-ink",
        green: "bg-green-soft text-green-ink",
        amber: "bg-amber-soft text-amber-ink",
        danger: "bg-danger-soft text-danger",
        neutral: "bg-white text-ink-soft",
        faint: "bg-bg text-ink-faint",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-0.5 text-s",
        lg: "px-3, py-1, text-md"
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props} />
  );
}
