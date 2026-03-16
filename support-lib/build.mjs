import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const yjsEntry = path.join(__dirname, "..", "node_modules", "yjs", "dist", "yjs.mjs");

const yjsResolver = {
  name: "resolve-yjs",
  setup(build) {
    build.onResolve({ filter: /^yjs$/ }, () => ({ path: yjsEntry }));
  }
};

await esbuild.build({
  entryPoints: [path.join(__dirname, "index.js")],
  outfile: path.join(__dirname, "dist", "nostr-site-support.esm.js"),
  bundle: true,
  format: "esm",
  minify: true,
  plugins: [yjsResolver]
});

await esbuild.build({
  entryPoints: [path.join(__dirname, "index.js")],
  outfile: path.join(__dirname, "dist", "nostr-site-support.iife.js"),
  bundle: true,
  format: "iife",
  globalName: "NostrSiteSupport",
  minify: true,
  plugins: [yjsResolver]
});
