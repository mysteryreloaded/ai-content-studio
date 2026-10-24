// Thin canvas/DOM glue for the favicon dot (issue #58's AC). Left
// untested, like the rest of this file's siblings that only call browser
// APIs — `tabTitle.ts`'s `faviconDotFor` is what decides the colour.

/** The repo has no fixed "danger"/"destructive" token (see useSiteSettings.ts); this is this feature's own. */
export const FAILURE_DOT_COLOR = "#dc2626";

let originalHref: string | null | undefined;

function getOrCreateIconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (originalHref === undefined) originalHref = link.getAttribute("href");
  return link;
}

function drawDot(baseImage: HTMLImageElement | null, color: string): string {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  if (baseImage) ctx.drawImage(baseImage, 0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size - 7, 7, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return canvas.toDataURL("image/png");
}

/** `color: null` restores whatever favicon was there before this feature touched it. */
export function setFaviconDot(
  color: string | null,
  logoUrl: string | null,
): void {
  const link = getOrCreateIconLink();
  if (color === null) {
    if (originalHref) link.setAttribute("href", originalHref);
    else link.remove();
    return;
  }

  if (!logoUrl) {
    link.setAttribute("href", drawDot(null, color));
    return;
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => link.setAttribute("href", drawDot(image, color));
  image.onerror = () => link.setAttribute("href", drawDot(null, color));
  image.src = logoUrl;
}
