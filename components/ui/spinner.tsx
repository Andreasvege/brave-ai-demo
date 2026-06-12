import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("spinner", className)} {...props} />;
}
