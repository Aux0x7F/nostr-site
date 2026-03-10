const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let eventToolsPromise = null;

function loadOrCreatePeerPinnerIdentity(identityFile, aliasOverride) {
  const file = String(identityFile || "").trim();
  if (!file) throw new Error("identity file path required");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const secretKeyHex = String(raw.secret_key_hex || raw.secretKeyHex || "").toLowerCase();
      if (isHex64(secretKeyHex)) {
        const pubkey = derivePubkey(secretKeyHex);
        if (isHex64(pubkey)) {
          const alias = cleanAlias(String(aliasOverride || raw.alias || ""));
          return {
            protocol: "nostr-site-peer-pinner-identity/v1",
            created_at: Number(raw.created_at || 0) || Math.floor(Date.now() / 1000),
            alias: alias || aliasFromPubkey(pubkey),
            pubkey,
            secret_key_hex: secretKeyHex,
          };
        }
      }
    } catch {
      // Fall through to regenerate.
    }
  }

  const secretKeyHex = generateSecretKeyHex();
  const pubkey = derivePubkey(secretKeyHex);
  const alias = cleanAlias(String(aliasOverride || aliasFromPubkey(pubkey)));
  const out = {
    protocol: "nostr-site-peer-pinner-identity/v1",
    created_at: Math.floor(Date.now() / 1000),
    alias,
    pubkey,
    secret_key_hex: secretKeyHex,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Non-posix filesystems may ignore mode.
  }
  return out;
}

function derivePubkey(secretKeyHex) {
  const sk = Buffer.from(String(secretKeyHex || "").trim(), "hex");
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(sk);
  const uncompressed = ecdh.getPublicKey(null, "uncompressed");
  return Buffer.from(uncompressed).subarray(1, 33).toString("hex");
}

function generateSecretKeyHex() {
  const secpOrder = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  while (true) {
    const bytes = crypto.randomBytes(32);
    const value = BigInt(`0x${bytes.toString("hex")}`);
    if (value > 0n && value < secpOrder) {
      return bytes.toString("hex");
    }
  }
}

function cleanAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function aliasFromPubkey(pubkey) {
  const partA = [
    "amber", "atlas", "brisk", "cedar", "clear", "cobalt", "copper", "crisp",
    "delta", "ember", "fable", "fierce", "flint", "glint", "gold", "granite",
    "harbor", "hollow", "ion", "iron", "juniper", "kindle", "lattice", "lunar",
    "marble", "mesa", "mint", "moss", "nova", "onyx", "opal", "orbit",
    "pine", "plume", "pulse", "quartz", "rally", "ridge", "river", "rust",
    "sage", "scarlet", "signal", "silver", "slate", "solar", "sparrow", "spruce",
    "stone", "swift", "timber", "topaz", "trail", "union", "velvet", "vivid",
    "wave", "west", "whistle", "wild", "winter", "zenith", "zephyr", "zinc",
  ];
  const partB = [
    "anchor", "arrow", "beacon", "blaze", "branch", "bridge", "brook", "canyon",
    "castle", "circle", "cloud", "comet", "crow", "dawn", "drift", "echo",
    "elm", "falcon", "field", "flare", "forest", "forge", "glacier", "grove",
    "harvest", "horizon", "isle", "junction", "lake", "lantern", "meadow", "meridian",
    "mountain", "north", "oak", "ocean", "path", "peak", "prairie", "ray",
    "reef", "resin", "road", "rook", "shore", "sierra", "sky", "spring",
    "star", "summit", "thunder", "tide", "torch", "tower", "valley", "vista",
    "voyage", "water", "willow", "wind", "wolf", "yard", "yonder", "zen",
  ];
  const partC = [
    "alliance", "anthem", "arc", "banner", "beat", "bridge", "cadence", "call",
    "chorus", "collective", "current", "drum", "echo", "flame", "flow", "frame",
    "fuse", "gather", "groove", "harbor", "harmony", "hinge", "hymn", "line",
    "link", "march", "marker", "matrix", "movement", "north", "orbit", "origin",
    "pattern", "peak", "phase", "pulse", "rally", "record", "relay", "rhythm",
    "rise", "route", "signal", "spark", "spectrum", "spirit", "stone", "stream",
    "stride", "thread", "tide", "tone", "track", "union", "vector", "verse",
    "vibe", "voice", "wave", "waypoint", "wing", "witness", "yard", "zero",
  ];
  const hash = crypto.createHash("sha256").update(Buffer.from(pubkey, "hex")).digest();
  const first = partA[hash[0] % partA.length];
  const second = partB[hash[13] % partB.length];
  const third = partC[hash[27] % partC.length];
  return `${first}-${second}-${third}`;
}

async function signJsonEvent({
  secretKeyHex,
  kind,
  tags = [],
  content = "",
  appTag = "",
  clientName = "nostr-site-peer-pinner",
  createdAt = Math.floor(Date.now() / 1000),
}) {
  const { finalizeEvent } = await loadEventTools();
  const event = {
    kind: Number(kind),
    created_at: Number(createdAt),
    tags: withAppTag(tags, appTag, clientName),
    content: typeof content === "string" ? content : JSON.stringify(content),
  };
  return finalizeEvent(event, hexToBytes(secretKeyHex));
}

async function createEncryptedJsonEvent({
  secretKeyHex,
  targetPubkey,
  kind,
  tags = [],
  content = "",
  appTag = "",
  clientName = "nostr-site-peer-pinner",
  createdAt = Math.floor(Date.now() / 1000),
}) {
  const { nip04 } = await loadEventTools();
  const cipherText = await nip04.encrypt(
    hexToBytes(secretKeyHex),
    String(targetPubkey || "").trim().toLowerCase(),
    typeof content === "string" ? content : JSON.stringify(content)
  );
  return signJsonEvent({
    secretKeyHex,
    kind,
    tags: [["p", String(targetPubkey || "").trim().toLowerCase()], ...tags],
    content: cipherText,
    appTag,
    clientName,
    createdAt,
  });
}

async function createPeerPinnerBootstrapEvents({
  serviceIdentity,
  appTag,
  protocolPrefix = "",
  pinnerName = "Nostr Site Peer Pinner",
  pinnerDescription = "Mirrors + pins tagged relay events for downstream Nostr site consumers",
  rootAdminPubkey = "",
  siteIdentity = null,
  kinds = {},
}) {
  if (!serviceIdentity?.secret_key_hex || !serviceIdentity?.pubkey || !serviceIdentity?.alias) {
    throw new Error("service identity is required");
  }
  const prefix = normalizeProtocolPrefix(protocolPrefix || appTag || "nostr-site");
  const nameKind = Number(kinds.nameClaim || 34130);
  const profileKind = Number(kinds.profile || 34131);
  const adminKeyShareKind = Number(kinds.adminKeyShare || 34138);
  const createdAt = Math.floor(Date.now() / 1000);
  const events = [
    await signJsonEvent({
      secretKeyHex: serviceIdentity.secret_key_hex,
      kind: nameKind,
      tags: [["d", `user:${serviceIdentity.alias}`], ["u", serviceIdentity.alias]],
      content: {
        username: serviceIdentity.alias,
        username_normalized: serviceIdentity.alias,
        service: true,
      },
      appTag,
      createdAt,
    }),
    await signJsonEvent({
      secretKeyHex: serviceIdentity.secret_key_hex,
      kind: profileKind,
      tags: [["d", "profile"]],
      content: {
        username: serviceIdentity.alias,
        display_name: String(pinnerName || "").trim() || serviceIdentity.alias,
        bio: String(pinnerDescription || "").trim(),
        service: true,
      },
      appTag,
      createdAt,
    }),
  ];

  if (siteIdentity?.secret_key_hex && isHex64(rootAdminPubkey)) {
    events.push(await createEncryptedJsonEvent({
      secretKeyHex: serviceIdentity.secret_key_hex,
      targetPubkey: rootAdminPubkey,
      kind: adminKeyShareKind,
      tags: [["d", `site-key:${siteIdentity.pubkey}`], ["k", "admin-key-share"]],
      content: {
        protocol: protocolName(prefix, "admin-key-share"),
        site_pubkey: siteIdentity.pubkey,
        site_secret_key_hex: siteIdentity.secret_key_hex,
        shared_at: new Date(createdAt * 1000).toISOString(),
      },
      appTag,
      createdAt,
    }));
  }

  return events;
}

function protocolName(prefix, suffix) {
  const normalizedPrefix = normalizeProtocolPrefix(prefix);
  const normalizedSuffix = normalizeProtocolPrefix(suffix);
  return normalizedSuffix ? `${normalizedPrefix}-${normalizedSuffix}/v1` : `${normalizedPrefix}/v1`;
}

async function loadEventTools() {
  if (!eventToolsPromise) {
    eventToolsPromise = import("nostr-tools");
  }
  return eventToolsPromise;
}

function normalizeProtocolPrefix(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "nostr-site";
}

function withAppTag(tags, appTag, clientName) {
  const next = Array.isArray(tags) ? tags.filter(Array.isArray).map((tag) => [...tag]) : [];
  const cleanTag = String(appTag || "").trim();
  if (cleanTag && !next.some((tag) => tag[0] === "t" && tag.includes(cleanTag))) {
    next.push(["t", cleanTag]);
  }
  if (clientName && !next.some((tag) => tag[0] === "client")) {
    next.push(["client", clientName]);
  }
  return next;
}

function hexToBytes(value) {
  return new Uint8Array(Buffer.from(String(value || "").trim(), "hex"));
}

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

module.exports = {
  aliasFromPubkey,
  cleanAlias,
  createEncryptedJsonEvent,
  createPeerPinnerBootstrapEvents,
  derivePubkey,
  generateSecretKeyHex,
  isHex64,
  loadOrCreatePeerPinnerIdentity,
  normalizeProtocolPrefix,
  protocolName,
  signJsonEvent,
};
