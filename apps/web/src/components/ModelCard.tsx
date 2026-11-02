import { Link } from "react-router-dom";

/** The enabled-Model summary the card displays (issue #42's four fields, #33). */
export interface ModelCardModel {
  name: string;
  description: string;
  modeCount: number;
  attribution: string;
}

interface ModelCardProps {
  model: ModelCardModel;
  /** A router destination (the Models home). */
  to?: string;
  /** A plain anchor (the landing page's sign-in redirect, with `return_to`). */
  href?: string;
}

/**
 * The Workbench prototype's Model card (issue #175): the whole card is
 * one link. The spec (#33) lists exactly name, description, Mode count
 * and Attribution — no preview image.
 */
export function ModelCard({ model, to, href }: ModelCardProps) {
  const body = (
    <span className="flex flex-col gap-1.5 px-3.5">
      <span className="font-heading text-[19px] font-semibold leading-[1.2]">
        {model.name}
      </span>
      <span className="text-muted-foreground">{model.description}</span>
      <span className="text-[12.5px] text-faint">
        {model.modeCount === 1 ? "1 Mode" : `${model.modeCount} Modes`}
        {model.attribution ? ` · ${model.attribution}` : ""}
      </span>
    </span>
  );

  const cardClass =
    "flex flex-col gap-2.5 overflow-hidden rounded-[10px] border border-border bg-card pb-3.5 text-foreground text-left hover:border-input hover:shadow-md";

  if (to !== undefined) {
    return (
      <Link to={to} className={cardClass}>
        {body}
      </Link>
    );
  }
  return (
    <a href={href} className={cardClass}>
      {body}
    </a>
  );
}
