const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const {
  createPeerPinnerBootstrapEvents,
  derivePubkey,
  generateSecretKeyHex,
  isHex64,
  loadOrCreatePeerPinnerIdentity,
  normalizeProtocolPrefix,
} = require("./identity");

const DEFAULTS = {
  appTag: String(process.env.APP_TAG || "nostr-site-template").trim() || "nostr-site-template",
  protocolPrefix: normalizeProtocolPrefix(process.env.PROTOCOL_PREFIX || process.env.APP_TAG || "nostr-site"),
  alias: String(process.env.PINNER_ALIAS || "").trim(),
  pinnerName: String(process.env.PINNER_NAME || "Nostr Site Peer Pinner").trim() || "Nostr Site Peer Pinner",
  pinnerDescription: String(
    process.env.PINNER_DESCRIPTION || "Mirrors + pins tagged relay events for downstream Nostr site consumers"
  ).trim() || "Mirrors + pins tagged relay events for downstream Nostr site consumers",
  identityFile: path.resolve(
    String(process.env.IDENTITY_FILE || path.join(__dirname, "data", "peer-pinner-identity.json")).trim()
  ),
  envFile: path.resolve(path.join(__dirname, ".env.peer-pinner.local")),
  outputDir: path.resolve(path.join(__dirname, "setup-output")),
  gitRemote: String(process.env.GIT_REMOTE || "origin").trim() || "origin",
  repoDir: String(process.env.SNAPSHOT_REPO_DIR || "").trim(),
  repo: String(process.env.GITHUB_REPO || "").trim(),
  baseBranch: String(process.env.GITHUB_BASE_BRANCH || "main").trim() || "main",
  rootAdminPubkey: String(process.env.ROOT_ADMIN_PUBKEY || "").trim().toLowerCase(),
  relays: parseRelays(process.env.UPSTREAM_RELAYS || ""),
  clientName: "nostr-site-peer-pinner",
  kinds: {
    adminKeyShare: 34138,
    nameClaim: 34130,
    profile: 34131,
  },
};
let eventToolsPromise = null;

void main().catch((error) => {
  console.error(String(error?.message || error || "Setup wizard failed."));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = {
    appTag: args.appTag || DEFAULTS.appTag,
    protocolPrefix: normalizeProtocolPrefix(args.protocolPrefix || DEFAULTS.protocolPrefix),
    alias: args.alias || DEFAULTS.alias,
    pinnerName: args.pinnerName || DEFAULTS.pinnerName,
    pinnerDescription: args.pinnerDescription || DEFAULTS.pinnerDescription,
    identityFile: path.resolve(args.identityFile || DEFAULTS.identityFile),
    envFile: path.resolve(args.localEnvFile || args.envFile || DEFAULTS.envFile),
    outputDir: path.resolve(args.outputDir || DEFAULTS.outputDir),
    gitRemote: args.gitRemote || DEFAULTS.gitRemote,
    repoDir: String(args.repoDir || DEFAULTS.repoDir || "").trim(),
    repo: String(args.repo || DEFAULTS.repo || "").trim(),
    baseBranch: String(args.baseBranch || DEFAULTS.baseBranch || "main").trim() || "main",
    rootAdminPubkey: String(args.rootAdminPubkey || DEFAULTS.rootAdminPubkey || "").trim().toLowerCase(),
    relays: parseRelays(args.relays || DEFAULTS.relays.join(",")),
    checkOnly: Boolean(args.checkOnly),
    nonInteractive: Boolean(args.nonInteractive),
    publishBootstrap: Boolean(args.publishBootstrap),
    skipSiteKey: Boolean(args.skipSiteKey),
  };

  if (config.rootAdminPubkey && !isHex64(config.rootAdminPubkey)) {
    throw new Error("ROOT_ADMIN_PUBKEY must be a 64-character hex pubkey.");
  }

  if (!config.checkOnly && !config.nonInteractive && input.isTTY && output.isTTY) {
    await promptForMissingValues(config);
  }

  const github = runGithubChecks({
    repo: config.repo,
    baseBranch: config.baseBranch,
  });

  if (config.checkOnly) {
    printCheckSummary(config, github);
    return;
  }

  const serviceIdentity = loadOrCreatePeerPinnerIdentity(config.identityFile, config.alias);
  const outputDir = ensureDir(config.outputDir);
  const generatedAt = new Date().toISOString();
  let siteIdentity = null;
  if (!config.skipSiteKey && config.rootAdminPubkey) {
    const secretKeyHex = generateSecretKeyHex();
    siteIdentity = {
      secret_key_hex: secretKeyHex,
      pubkey: derivePubkey(secretKeyHex),
    };
  }

  const bootstrapEvents = await createPeerPinnerBootstrapEvents({
    serviceIdentity,
    appTag: config.appTag,
    protocolPrefix: config.protocolPrefix,
    pinnerName: config.pinnerName,
    pinnerDescription: config.pinnerDescription,
    rootAdminPubkey: config.rootAdminPubkey,
    siteIdentity,
    kinds: DEFAULTS.kinds,
  });

  const bootstrapPayload = {
    generated_at: generatedAt,
    app_tag: config.appTag,
    protocol_prefix: config.protocolPrefix,
    relays: config.relays,
    service_identity: {
      alias: serviceIdentity.alias,
      pubkey: serviceIdentity.pubkey,
      identity_file: config.identityFile,
    },
    root_admin_pubkey: config.rootAdminPubkey,
    site_inbox_pubkey: siteIdentity?.pubkey || "",
    events: bootstrapEvents,
  };
  const bootstrapFile = path.join(outputDir, "bootstrap-events.json");
  writeJsonFile(bootstrapFile, bootstrapPayload);

  let publishResult = null;
  if (config.publishBootstrap && config.relays.length) {
    publishResult = await publishEvents(config.relays, bootstrapEvents);
  }

  const envValues = {
    IDENTITY_FILE: toPortablePath(config.identityFile),
    PINNER_ALIAS: serviceIdentity.alias,
    ROOT_ADMIN_PUBKEY: config.rootAdminPubkey,
    APP_TAG: config.appTag,
    PROTOCOL_PREFIX: config.protocolPrefix,
    SNAPSHOT_REPO_DIR: toPortablePath(config.repoDir),
    GITHUB_REPO: config.repo,
    GITHUB_BASE_BRANCH: config.baseBranch,
    GIT_REMOTE: config.gitRemote,
  };
  writeEnvFile(config.envFile, envValues);

  const siteConfigSnippet = {
    nostr: {
      appTag: config.appTag,
      protocolPrefix: config.protocolPrefix,
      rootAdminPubkey: config.rootAdminPubkey,
      inboxPubkey: siteIdentity?.pubkey || "",
    },
  };
  const siteConfigFile = path.join(outputDir, "site-config-snippet.json");
  writeJsonFile(siteConfigFile, siteConfigSnippet);

  const summary = {
    generated_at: generatedAt,
    service_identity: {
      alias: serviceIdentity.alias,
      pubkey: serviceIdentity.pubkey,
      identity_file: config.identityFile,
    },
    site_inbox_pubkey: siteIdentity?.pubkey || "",
    root_admin_pubkey: config.rootAdminPubkey,
    env_file: config.envFile,
    bootstrap_file: bootstrapFile,
    site_config_file: siteConfigFile,
    github,
    publish_result: publishResult,
    notes: buildWizardNotes(config, github, publishResult),
  };
  const summaryFile = path.join(outputDir, "wizard-summary.json");
  writeJsonFile(summaryFile, summary);
  printSetupSummary(summary);
}

async function promptForMissingValues(config) {
  const rl = readline.createInterface({ input, output });
  try {
    config.alias = await promptValue(
      rl,
      "Pinner alias",
      config.alias || path.basename(config.identityFile, path.extname(config.identityFile)).replace(/[^a-z0-9-]+/gi, "-").toLowerCase()
    );
    config.rootAdminPubkey = String(
      await promptValue(rl, "Root admin pubkey", config.rootAdminPubkey)
    ).trim().toLowerCase();
    if (config.rootAdminPubkey && !isHex64(config.rootAdminPubkey)) {
      throw new Error("Root admin pubkey must be 64 hex characters.");
    }
    config.repoDir = await promptValue(rl, "Snapshot repo dir", config.repoDir);
    config.repo = await promptValue(rl, "GitHub repo (owner/repo)", config.repo);
    config.baseBranch = await promptValue(rl, "GitHub base branch", config.baseBranch);
    config.publishBootstrap = await promptYesNo(rl, "Publish bootstrap events to relays now", config.publishBootstrap);
    if (config.rootAdminPubkey) {
      config.skipSiteKey = !(await promptYesNo(rl, "Generate and wrap a site inbox key for the root admin", !config.skipSiteKey));
    }
  } finally {
    rl.close();
  }
}

function runGithubChecks({ repo, baseBranch }) {
  const ghVersion = runCommand("gh", ["--version"]);
  const installed = ghVersion.ok;
  const authStatus = installed ? runCommand("gh", ["auth", "status", "-h", "github.com"]) : null;
  const scopes = installed && authStatus?.ok ? inspectGithubScopes() : [];
  const repoCheck = installed && authStatus?.ok && repo ? inspectGithubRepo(repo, baseBranch) : null;
  const recommendations = [];
  if (!installed) {
    recommendations.push("Install the GitHub CLI or set GITHUB_TOKEN explicitly for PR automation.");
  } else if (!authStatus?.ok) {
    recommendations.push("Run `gh auth login --web --git-protocol https` on the pinner host before enabling PR sync.");
  }
  if (installed && authStatus?.ok && scopes.length && !scopes.includes("repo")) {
    recommendations.push("Current gh auth does not expose the classic `repo` scope. Fine-grained auth is acceptable, but it must include Contents write and Pull requests write for the target repo.");
  }
  if (repo && repoCheck && !repoCheck.ok) {
    recommendations.push(`GitHub CLI cannot currently read ${repo}. Check repo spelling and token access.`);
  }
  return {
    installed,
    version: installed ? firstLine(ghVersion.stdout) : "",
    authenticated: Boolean(authStatus?.ok),
    auth_detail: authStatus ? trimBlock([authStatus.stdout, authStatus.stderr].filter(Boolean).join("\n")) : "",
    scopes,
    repo: repoCheck,
    recommendations,
  };
}

function inspectGithubScopes() {
  const result = runCommand("gh", ["api", "-i", "user"]);
  if (!result.ok) return [];
  const match = /x-oauth-scopes:\s*(.+)/i.exec(result.stdout);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inspectGithubRepo(repo, baseBranch) {
  const repoResult = runCommand("gh", ["api", `repos/${repo}`]);
  if (!repoResult.ok) {
    return {
      ok: false,
      repo,
      detail: trimBlock([repoResult.stdout, repoResult.stderr].filter(Boolean).join("\n")),
    };
  }
  let payload = null;
  try {
    payload = JSON.parse(repoResult.stdout);
  } catch {
    payload = null;
  }
  const branchResult = baseBranch
    ? runCommand("gh", ["api", `repos/${repo}/branches/${encodeURIComponent(baseBranch)}`])
    : null;
  return {
    ok: true,
    repo,
    default_branch: String(payload?.default_branch || "").trim(),
    branch_ok: Boolean(branchResult?.ok || !baseBranch),
    branch_detail: branchResult && !branchResult.ok
      ? trimBlock([branchResult.stdout, branchResult.stderr].filter(Boolean).join("\n"))
      : "",
  };
}

function runCommand(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
    };
  } catch (error) {
    return {
      ok: false,
      status: -1,
      stdout: "",
      stderr: String(error?.message || error || `${command} failed`),
    };
  }
}

async function publishEvents(relays, events) {
  const { SimplePool } = await loadEventTools();
  const usableRelays = parseRelays((Array.isArray(relays) ? relays : []).join(","));
  if (!usableRelays.length || !Array.isArray(events) || !events.length) {
    return {
      ok: false,
      relays: usableRelays,
      event_count: Array.isArray(events) ? events.length : 0,
      published: 0,
      failures: ["No usable relays were configured."],
    };
  }
  const pool = new SimplePool();
  try {
    let published = 0;
    const failures = [];
    for (const event of events) {
      const receipts = await Promise.allSettled(pool.publish(usableRelays, event));
      const successCount = receipts.filter((item) => item.status === "fulfilled").length;
      if (successCount > 0) {
        published += 1;
      } else {
        failures.push(`Event ${event.id} failed on all relays.`);
      }
    }
    return {
      ok: failures.length === 0,
      relays: usableRelays,
      event_count: events.length,
      published,
      failures,
    };
  } finally {
    pool.close(usableRelays);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const eqIndex = value.indexOf("=");
    const rawKey = eqIndex >= 0 ? value.slice(2, eqIndex) : value.slice(2);
    const inlineValue = eqIndex >= 0 ? value.slice(eqIndex + 1) : null;
    const key = rawKey;
    if (["check-only", "non-interactive", "publish-bootstrap", "skip-site-key"].includes(key)) {
      out[toCamel(key)] = true;
      continue;
    }
    if (inlineValue !== null) {
      out[toCamel(key)] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (typeof next === "undefined" || next.startsWith("--")) {
      out[toCamel(key)] = "";
      continue;
    }
    out[toCamel(key)] = next;
    index += 1;
  }
  return out;
}

async function promptValue(rl, label, fallback) {
  const answer = await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `);
  const trimmed = String(answer || "").trim();
  return trimmed || String(fallback || "").trim();
}

async function promptYesNo(rl, label, defaultValue) {
  const fallback = defaultValue ? "Y/n" : "y/N";
  const answer = String(await rl.question(`${label} [${fallback}]: `) || "").trim().toLowerCase();
  if (!answer) return Boolean(defaultValue);
  return ["y", "yes"].includes(answer);
}

function buildWizardNotes(config, github, publishResult) {
  const notes = [
    "The pinner service key is stored locally because it signs blob fulfillments, bakedowns, and PR receipts.",
    "The shared site inbox key is wrapped to the configured root admin pubkey and is not written to the pinner env file.",
    "PR automation should stay branch-and-PR only. Direct write access to the live deploy branch makes the pinner effectively root-equivalent.",
  ];
  if (!github.authenticated) {
    notes.push("GitHub CLI auth is not currently ready. PR sync will require `gh auth login` or a GITHUB_TOKEN in the pinner environment.");
  }
  if (config.rootAdminPubkey && !publishResult?.ok) {
    notes.push("The encrypted site-key share is written to bootstrap-events.json. Publish that event to relays before expecting admins to load the inbox key through the site UI.");
  }
  return notes;
}

function printCheckSummary(config, github) {
  console.log("Peer pinner GitHub check");
  console.log(`- app tag: ${config.appTag}`);
  console.log(`- protocol prefix: ${config.protocolPrefix}`);
  console.log(`- gh installed: ${github.installed ? "yes" : "no"}`);
  console.log(`- gh authenticated: ${github.authenticated ? "yes" : "no"}`);
  if (github.version) console.log(`- gh version: ${github.version}`);
  if (github.scopes.length) console.log(`- gh scopes: ${github.scopes.join(", ")}`);
  if (github.repo) {
    console.log(`- repo access: ${github.repo.ok ? "ok" : "failed"} (${github.repo.repo})`);
    if (github.repo.default_branch) console.log(`- repo default branch: ${github.repo.default_branch}`);
    if (!github.repo.branch_ok && github.repo.branch_detail) {
      console.log(`- base branch detail: ${github.repo.branch_detail}`);
    }
  }
  for (const note of github.recommendations) {
    console.log(`- note: ${note}`);
  }
}

function printSetupSummary(summary) {
  console.log("Peer pinner setup complete");
  console.log(`- service alias: ${summary.service_identity.alias}`);
  console.log(`- service pubkey: ${summary.service_identity.pubkey}`);
  console.log(`- identity file: ${summary.service_identity.identity_file}`);
  console.log(`- env file: ${summary.env_file}`);
  console.log(`- bootstrap events: ${summary.bootstrap_file}`);
  console.log(`- site config snippet: ${summary.site_config_file}`);
  if (summary.site_inbox_pubkey) {
    console.log(`- site inbox pubkey: ${summary.site_inbox_pubkey}`);
  }
  if (summary.publish_result) {
    console.log(`- bootstrap publish: ${summary.publish_result.ok ? "ok" : "partial/failed"}`);
  }
  for (const note of summary.notes) {
    console.log(`- note: ${note}`);
  }
}

function writeEnvFile(filePath, values) {
  const existing = parseEnvFile(filePath);
  for (const [key, value] of Object.entries(values)) {
    if (!key) continue;
    if (String(value || "").trim()) {
      existing.set(key, String(value).trim());
    } else {
      existing.delete(key);
    }
  }
  const lines = [
    "# Generated by peer-pinner/setup-wizard.js",
    ...[...existing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`),
    "",
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function parseEnvFile(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  const lines = String(fs.readFileSync(filePath, "utf8") || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    map.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
  }
  return map;
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function parseRelays(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw || "").split(",")) {
    const value = String(part || "").trim();
    if (!value || seen.has(value)) continue;
    if (!(value.startsWith("wss://") || value.startsWith("ws://"))) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function toPortablePath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function trimBlock(value) {
  return String(value || "").trim();
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function toCamel(value) {
  return String(value || "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function loadEventTools() {
  if (!eventToolsPromise) {
    eventToolsPromise = import("nostr-tools");
  }
  return eventToolsPromise;
}
