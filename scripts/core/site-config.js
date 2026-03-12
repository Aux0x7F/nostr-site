export const SITE = Object.freeze({
  projectName: "Nostr Site",
  shortName: "Nostr Site",
  tagline: "A portable static-first site template for blogs, archives, and collaborative publishing.",
  donateUrl: "https://example.org/support",
  merchUrl: "https://example.org/store",
  youtubeUrl: "https://youtube.com/@exampleproject",
  contactEmail: "hello@example.org",
  content: {
    seedEntitiesPath: "./content/data/entities.json"
  },
  blobs: {
    baseUrl: "https://blossom.band",
    maxUploadBytes: 2000000,
    requestTimeoutMs: 8000,
    requestPollMs: 900
  },
  map: {
    defaultCenter: [39.5, -98.35],
    defaultZoom: 4,
    minZoom: 3,
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  nostr: {
    appTag: "nostr-site-template",
    clientName: "nostr-site",
    protocolPrefix: "nostr-site",
    storageNamespace: "nostrsite.template",
    relays: ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"],
    inboxPubkey: "",
    rootAdminPubkey: "",
    maxAttachmentBytes: 90000,
    connectTimeoutMs: 3200,
    privateLoadLimit: 200,
    publicLoadLimit: 400,
    filterChunkSize: 12,
    toolScriptPaths: {
      bundle: "./vendor/event-tools.bundle.js",
      shim: "./vendor/event-tools-shim.js"
    },
    kinds: {
      snapshot: 34126,
      tip: 4,
      adminClaim: 34127,
      adminRole: 34128,
      userMod: 34129,
      nameClaim: 34130,
      profile: 34131,
      snapshotRequest: 34132,
      entity: 34133,
      draft: 34134,
      comment: 34135,
      commentMod: 34136,
      submissionStatus: 34137,
      adminKeyShare: 34138,
      blobRequest: 34139,
      blobFulfillment: 34140,
      visitPulse: 34141,
      siteKey: 34142
    }
  }
});

export default SITE;
