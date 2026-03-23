import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderPageHtml, renderRedirectHtml } from "../site-src/layout.mjs";
import { pageDefinitions, siteTemplate } from "../site-src/pages.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const pageSourceRoot = path.join(root, "site-src", "main");
const legacyRootPages = [
  "index.html",
  "about.html",
  "admin.html",
  "blog.html",
  "editor.html",
  "get-involved.html",
  "guide.html",
  "investigation.html",
  "investigations.html",
  "map.html",
  "merch.html",
  "post.html",
  "submit.html"
];

test("page definitions point at existing sources or redirects", async () => {
  for (const page of pageDefinitions) {
    if (page.redirectTo) {
      assert.ok(page.redirectTo, `${page.fileName} should declare redirectTo`);
      continue;
    }
    await fs.access(path.join(pageSourceRoot, page.mainSource));
    assert.ok(page.bakedown, `${page.fileName} should declare bakedown metadata`);
    assert.ok(Array.isArray(page.bakedown.interactiveMounts), `${page.fileName} should list interactive mounts`);
  }
});

test("renderPageHtml respects external page assets", async () => {
  const mapPage = pageDefinitions.find((page) => page.fileName === "map.html");
  assert.ok(mapPage);
  const mainHtml = await fs.readFile(path.join(pageSourceRoot, mapPage.mainSource), "utf8");
  const rendered = renderPageHtml({
    page: mapPage,
    site: siteTemplate,
    mainHtml
  });

  assert.match(rendered, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
  assert.match(rendered, /integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="/);
  assert.match(rendered, /scripts\/app\.js/);
});

test("renderRedirectHtml builds redirect pages from definitions", () => {
  const redirectPage = pageDefinitions.find((page) => page.fileName === "investigations.html");
  assert.ok(redirectPage);
  const rendered = renderRedirectHtml({
    page: redirectPage,
    site: siteTemplate
  });

  assert.match(rendered, /http-equiv="refresh" content="0; url=\.\/blog\.html"/);
  assert.match(rendered, /Continue to the blog\./);
});

test("legacy root html pages are removed and generated output lives under dist", async () => {
  for (const fileName of legacyRootPages) {
    await assert.rejects(fs.access(path.join(root, fileName)));
    await fs.access(path.join(root, "dist", fileName));
  }
});
