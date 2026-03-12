import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const strict = process.argv.includes("--strict");

const failures = [];
const warnings = [];
const passes = [];

checkExists("support library bundle", "support-lib/dist/nostr-site-support.esm.js");
checkExists("peer pinner bundle", "peer-pinner/dist/peer-pinner.js");
checkExists("browser smoke harness", "tooling/browser-smoke/package.json");
checkExists("security checklist", "SECURITY_CHECKLIST.md");

const siteConfig = readText("scripts/core/site-config.js");
if (/inboxPubkey:\s*""/.test(siteConfig)) {
  passes.push("generic site config ships with an empty inbox pubkey");
} else {
  failures.push("generic site config should not ship with a populated inbox pubkey");
}

if (/rootAdminPubkey:\s*""/.test(siteConfig)) {
  passes.push("generic site config ships with an empty root admin pubkey");
} else {
  failures.push("generic site config should not ship with a populated root admin pubkey");
}

const rootReadme = readText("README.md");
if (rootReadme.includes("GitHub access should be limited to branch + PR automation")) {
  passes.push("root README documents the PR-only bakedown trust split");
} else {
  failures.push("root README should explicitly document branch + PR-only GitHub access");
}

const pinnerReadme = readText("peer-pinner/README.md");
if (pinnerReadme.includes("Give the pinner branch + PR rights, not direct write access")) {
  passes.push("peer pinner README warns against direct deploy-branch writes");
} else {
  failures.push("peer pinner README should warn against direct deploy-branch writes");
}

const pinnerSource = readText("peer-pinner/peer-pinner.js");
if (pinnerSource.includes("validateGithubSnapshotConfig")) {
  passes.push("peer pinner runtime validates GitHub bakedown config at startup");
} else {
  failures.push("peer pinner runtime is missing GitHub bakedown config validation");
}

const envSnapshot = {
  githubRepo: String(process.env.GITHUB_REPO || "").trim(),
  snapshotRepoDir: String(process.env.SNAPSHOT_REPO_DIR || "").trim(),
  baseBranch: String(process.env.GITHUB_BASE_BRANCH || "main").trim() || "main",
  branchPrefix: String(process.env.GITHUB_BRANCH_PREFIX || "nostr-site-bake").trim() || "nostr-site-bake",
  appTag: String(process.env.APP_TAG || "nostr-site-template").trim() || "nostr-site-template",
  rootAdminPubkey: String(process.env.ROOT_ADMIN_PUBKEY || "").trim().toLowerCase(),
  blobCacheBaseUrl: String(process.env.BLOB_CACHE_BASE_URL || "").trim(),
  upstreamRelays: String(process.env.UPSTREAM_RELAYS || "").trim()
};

if (envSnapshot.githubRepo && !/^[^/\s]+\/[^/\s]+$/.test(envSnapshot.githubRepo)) {
  failures.push(`GITHUB_REPO is invalid: ${envSnapshot.githubRepo}`);
}

if (envSnapshot.githubRepo && !envSnapshot.snapshotRepoDir) {
  failures.push("GITHUB_REPO is set but SNAPSHOT_REPO_DIR is empty");
}

const bakeBranch = `${sanitizeBranchSegment(envSnapshot.branchPrefix)}/${sanitizeBranchSegment(envSnapshot.appTag)}`;
const baseBranch = sanitizeBranchSegment(envSnapshot.baseBranch);
if (bakeBranch === baseBranch) {
  failures.push(`bakedown branch ${bakeBranch} must not match base branch ${baseBranch}`);
} else {
  passes.push(`bakedown branch resolves to ${bakeBranch} and stays off the base branch ${baseBranch}`);
}

if (envSnapshot.rootAdminPubkey && !/^[0-9a-f]{64}$/.test(envSnapshot.rootAdminPubkey)) {
  failures.push("ROOT_ADMIN_PUBKEY is set but is not 64 hex characters");
}

if (envSnapshot.blobCacheBaseUrl && !/^https?:\/\//i.test(envSnapshot.blobCacheBaseUrl)) {
  failures.push(`BLOB_CACHE_BASE_URL should be an http(s) URL: ${envSnapshot.blobCacheBaseUrl}`);
}

if (envSnapshot.upstreamRelays) {
  const insecureRelays = envSnapshot.upstreamRelays
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^wss?:\/\//i.test(item));
  if (insecureRelays.length) {
    warnings.push(`UPSTREAM_RELAYS contains non-ws relay entries: ${insecureRelays.join(", ")}`);
  }
}

const scanFiles = collectScanFiles(repoRoot);
const failPatterns = [
  {
    label: "private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    label: "GitHub classic token",
    regex: /\bghp_[A-Za-z0-9]{20,}\b/
  },
  {
    label: "GitHub fine-grained token",
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/
  },
  {
    label: "bearer token literal",
    regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/
  },
  {
    label: "plaintext PuTTY password flag",
    regex: /(?:^|\s)-pw\s+['"][^'"\r\n]+['"]/
  }
];

const warnPatterns = [
  {
    label: "direct SSH user@ip example",
    regex: /\b[a-z0-9._-]+@(?:\d{1,3}\.){3}\d{1,3}\b/i
  },
  {
    label: "non-localhost IP address",
    regex: /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b/
  },
  {
    label: "inline password assignment",
    regex: /\bpassword\b\s*[:=]\s*['"][^'"\r\n]{6,}['"]/i
  }
];

for (const file of scanFiles) {
  const content = fs.readFileSync(file, "utf8");
  const relative = toRelative(file);
  for (const pattern of failPatterns) {
    const match = content.match(pattern.regex);
    if (match) failures.push(`${pattern.label} in ${relative}`);
  }
  for (const pattern of warnPatterns) {
    const match = content.match(pattern.regex);
    if (match) warnings.push(`${pattern.label} in ${relative}`);
  }
}

console.log("nostr-site security audit");
for (const item of passes) console.log(`PASS  ${item}`);
for (const item of warnings) console.log(`WARN  ${item}`);
for (const item of failures) console.log(`FAIL  ${item}`);

const failCount = failures.length + (strict ? warnings.length : 0);
console.log("");
console.log(`Summary: ${passes.length} pass, ${warnings.length} warn, ${failures.length} fail`);

if (failCount > 0) {
  process.exitCode = 1;
}

function checkExists(label, relativePath) {
  if (fs.existsSync(path.join(repoRoot, relativePath))) {
    passes.push(`${label} exists (${relativePath})`);
  } else {
    failures.push(`${label} is missing (${relativePath})`);
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectScanFiles(root) {
  const includeExtensions = new Set([".md", ".js", ".mjs", ".cjs", ".json", ".sh", ".ps1", ".html"]);
  const skipDirectories = new Set([".git", "node_modules", "vendor", "dist"]);
  const files = [];
  walk(root);
  return files;

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relative = toRelative(fullPath);
      if (entry.isDirectory()) {
        if (skipDirectories.has(entry.name)) continue;
        if (relative === "tooling/security-audit") continue;
        walk(fullPath);
        continue;
      }
      if (!includeExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (relative.startsWith("support-lib/dist/")) continue;
      if (relative.startsWith("peer-pinner/dist/")) continue;
      files.push(fullPath);
    }
  }
}

function sanitizeBranchSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/^\/+|\/+$/g, "") || "snapshot";
}

function toRelative(value) {
  return path.relative(repoRoot, value).replace(/\\/g, "/");
}
