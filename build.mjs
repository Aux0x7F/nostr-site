import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const dist = path.join(root, "dist");

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const htmlFiles = [
  "index.html",
  "blog.html",
  "post.html",
  "investigations.html",
  "investigation.html",
  "guide.html",
  "submit.html",
  "admin.html",
  "map.html",
  "get-involved.html",
  "about.html",
  "merch.html"
];

for (const entry of ["app.js", "admin.js", "submit.js"]) {
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    minify: true,
    outfile: path.join(dist, entry)
  });
}

const css = await fs.readFile(path.join(root, "styles.css"), "utf8");
const minifiedCss = await esbuild.transform(css, { loader: "css", minify: true });
await fs.writeFile(path.join(dist, "styles.css"), minifiedCss.code, "utf8");

for (const file of htmlFiles) {
  const html = await fs.readFile(path.join(root, file), "utf8");
  const minified = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: false,
    minifyJS: false
  });
  await fs.writeFile(path.join(dist, file), minified, "utf8");
}

await copyDir(path.join(root, "content"), path.join(dist, "content"));
await copyDir(path.join(root, "vendor"), path.join(dist, "vendor"));

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}
