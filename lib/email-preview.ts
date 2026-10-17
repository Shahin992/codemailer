/**
 * A full HTML page for showing an email inside an <iframe srcDoc>. It fits the frame's width:
 * images and wide tables shrink and long words wrap, so a phone never has to scroll sideways.
 */
export function emailPreviewDoc(bodyHtml: string, { openLinksInNewTab = false } = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${
    openLinksInNewTab ? '<base target="_blank">' : ""
  }<style>body{font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:16px;overflow-wrap:anywhere}img,video{max-width:100%!important;height:auto!important}table{max-width:100%!important}pre{white-space:pre-wrap}</style></head><body>${bodyHtml}</body></html>`;
}
