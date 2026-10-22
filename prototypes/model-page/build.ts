// PROTOTYPE build: bun prototypes/model-page/build.ts
// Writes index.html (open it directly in a browser) and artifact.html (the same
// page without the document skeleton, as published on claude.ai). Sample media
// from media/ (made by make-media.sh) is inlined as base64.
const dir = import.meta.dir;
const result = await Bun.build({ entrypoints: [`${dir}/src/main.jsx`], format: "iife", minify: false, tsconfig: `${dir}/tsconfig.json` } as any);
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const js = (await result.outputs[0].text()).replaceAll("</script", "<\\/script");
const css = await Bun.file(`${dir}/src/styles.css`).text();

const TYPES: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg", mp3: "audio/mpeg" };
const media: Record<string, { type: string; b64: string }> = {};
for (const name of new Bun.Glob("*.{mp4,jpg,mp3}").scanSync(`${dir}/media`)) {
  const bytes = await Bun.file(`${dir}/media/${name}`).arrayBuffer();
  media[name] = { type: TYPES[name.split(".").pop()!], b64: Buffer.from(bytes).toString("base64") };
}

const head = `<title>Model Page Prototype</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}
</style>`;
const body = `<div id="root"></div>
<script>window.__MEDIA = ${JSON.stringify(media)};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>
${js}
</script>`;

await Bun.write(`${dir}/artifact.html`, `${head}\n${body}\n`);
await Bun.write(`${dir}/index.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`);
const kb = (n: number) => Math.round(n / 1024);
console.log(`Built index.html and artifact.html (${kb(js.length)} KB script, ${kb(JSON.stringify(media).length)} KB media)`);
