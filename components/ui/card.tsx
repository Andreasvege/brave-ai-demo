import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

/* Fremhevet kortheader med aksentfarge — brukes på action-kortene (CRM, møte). */
export function CardAccentHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-b border-accent-border bg-accent-soft px-6 py-3",
        className
      )}
      {...props}
    >
      <h2 className="text-[13px] font-semibold text-accent-ink">{children}</h2>
    </div>
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...props} />;
}

/* Etikett i småkapitéler over kortinnhold. */
export function Kicker({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("kicker", className)} {...props} />;
}
