// PROTOTYPE build: bun prototypes/model-editor/build.ts
// Writes index.html (open it directly in a browser) and artifact.html (the same
// page without the document skeleton, as published on claude.ai).
const dir = import.meta.dir;
const result = await Bun.build({ entrypoints: [`${dir}/src/main.jsx`], format: "iife", minify: false, tsconfig: `${dir}/tsconfig.json` } as any);
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const js = (await result.outputs[0].text()).replaceAll("</script", "<\\/script");
const css = await Bun.file(`${dir}/src/styles.css`).text();

const head = `<title>Model Editor Prototype</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}
</style>`;
const body = `<div id="root"></div>
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
console.log(`Built index.html and artifact.html (${Math.round(js.length / 1024)} KB of script)`);
