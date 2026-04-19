import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** rechts ausgerichtete Aktionen (Buttons o. Ä.) */
  actions?: ReactNode;
  /** kleines Eyebrow-Label über dem Titel */
  eyebrow?: ReactNode;
  className?: string;
};

export function AdminPageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: Props) {
  return (
    <header
      className={[
        "flex flex-col gap-3 border-b border-black/10 pb-4 sm:flex-row sm:items-end sm:justify-between",
        className ?? "",
      ].join(" ")}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[11px] font-black uppercase tracking-[0.12em] text-black/45">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mt-0.5 text-xl font-black tracking-tight text-black sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm font-bold text-black/60 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}
