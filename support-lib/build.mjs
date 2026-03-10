import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await esbuild.build({
  entryPoints: [path.join(__dirname, "index.js")],
  outfile: path.join(__dirname, "dist", "nostr-site-support.esm.js"),
  bundle: true,
  format: "esm",
  minify: true
});

await esbuild.build({
  entryPoints: [path.join(__dirname, "index.js")],
  outfile: path.join(__dirname, "dist", "nostr-site-support.iife.js"),
  bundle: true,
  format: "iife",
  globalName: "NostrSiteSupport",
  minify: true
});
