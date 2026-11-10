import { GraduationCap } from "lucide-react";
import clsx from "clsx";
import type { AppSettings } from "@/lib/anamnese/settings";

export function Brand({
  s,
  className,
  light,
}: {
  s: Pick<AppSettings, "brandName" | "brandTagline" | "logoUrl">;
  className?: string;
  light?: boolean;
}) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      {s.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.logoUrl} alt={`Logotipo ${s.brandName}`} className="h-10 w-auto max-w-[160px] object-contain" />
      ) : (
        <span
          aria-hidden
          className={clsx(
            "grid h-10 w-10 place-items-center rounded-xl",
            light ? "bg-white/15 text-white" : "bg-primary text-white",
          )}
        >
          <GraduationCap className="h-5 w-5" />
        </span>
      )}
      <span className="leading-tight">
        <span className={clsx("block font-headline text-base font-bold", light ? "text-white" : "text-primary")}>
          {s.brandName}
        </span>
        <span className={clsx("block text-xs", light ? "text-white/80" : "text-secondary")}>{s.brandTagline}</span>
      </span>
    </div>
  );
}
