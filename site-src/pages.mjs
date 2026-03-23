export const siteTemplate = {
  lang: "en",
  themeColor: "#121212",
  csp:
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; script-src 'self' https://unpkg.com; connect-src 'self' https: wss:; font-src 'self' data: https:; object-src 'none'; media-src 'self' blob: https:; manifest-src 'self'; worker-src 'self' blob:;",
  referrer: "strict-origin-when-cross-origin",
  permissionsPolicy: "camera=(), microphone=(), geolocation=()",
  brandMark: "NS",
  brandTitle: "Nostr Site",
  brandTagline: "Static-first publishing with relay-backed collaboration.",
  footer: {
    brandEyebrow: "Nostr Site Template",
    brandTitle: "Portable publishing for small teams.",
    brandBody: "Use this starter when you want markdown, relay-backed state, and a low-maintenance public site instead of a heavier CMS stack.",
    columnOneTitle: "Explore",
    columnOneLinks: [
      { href: "./blog.html", label: "Blog" },
      { href: "./map.html", label: "Map" },
      { href: "./guide.html", label: "Guide" }
    ],
    columnTwoTitle: "Support",
    columnTwoLinks: [
      { href: "./get-involved.html", label: "Get involved" },
      { href: "./submit.html", label: "Submit" },
      { href: "./about.html", label: "About" },
      { href: "./merch.html", label: "Merch" }
    ]
  }
};

export const pageDefinitions = [
  {
    fileName: "index.html",
    dataPage: "home",
    title: "Nostr Site Template",
    description: "A static-first Nostr-backed site template for archives, guides, submissions, maps, and lightweight moderation.",
    mainSource: "index.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "landing",
      contentCollections: ["posts"],
      interactiveMounts: ["homePosts"]
    }
  },
  {
    fileName: "blog.html",
    dataPage: "blog",
    title: "Blog | Nostr Site Template",
    description: "Browse posts in the Nostr Site template archive.",
    mainSource: "blog.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "collection",
      contentCollections: ["posts"],
      interactiveMounts: ["postList", "archiveFilters"]
    }
  },
  {
    fileName: "post.html",
    dataPage: "post",
    title: "Post | Nostr Site Template",
    description: "Read a post from the Nostr Site template archive.",
    mainSource: "post.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "detail",
      contentCollections: ["posts"],
      interactiveMounts: ["article", "commentThread"]
    }
  },
  {
    fileName: "editor.html",
    dataPage: "editor",
    title: "Create Post | Nostr Site Template",
    description: "Write and review post drafts in the Nostr Site template.",
    mainSource: "editor.html",
    extraStyles: ["./vendor/toastui-editor.min.css"],
    extraScripts: [{ src: "./vendor/toastui-editor-all.min.js" }],
    entryScripts: ["./scripts/shell.js", "./scripts/editor.js"],
    bakedown: {
      templateKind: "editor",
      contentCollections: [],
      interactiveMounts: ["editorShell"]
    }
  },
  {
    fileName: "guide.html",
    dataPage: "guide",
    title: "Guide | Nostr Site Template",
    description: "Read the sample publishing and collaboration guide for the Nostr Site template.",
    mainSource: "guide.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "guide",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "submit.html",
    dataPage: "submit",
    title: "Submit | Nostr Site Template",
    description: "Submit private tips, messages, and supporting files into the Nostr Site template workflow.",
    mainSource: "submit.html",
    entryScripts: ["./scripts/shell.js", "./scripts/submit.js"],
    bakedown: {
      templateKind: "intake",
      contentCollections: [],
      interactiveMounts: ["submitShell"]
    }
  },
  {
    fileName: "admin.html",
    dataPage: "workspace",
    title: "Log In | Nostr Site Template",
    description: "Log in to manage your profile, comments, submissions, and role-based workspace tools.",
    mainSource: "admin.html",
    entryScripts: ["./scripts/shell.js", "./scripts/admin.js"],
    bakedown: {
      templateKind: "workspace",
      contentCollections: [],
      interactiveMounts: ["workspaceShell"]
    }
  },
  {
    fileName: "map.html",
    dataPage: "map",
    title: "Map | Nostr Site Template",
    description: "Entity map and geographic index for the Nostr Site template.",
    mainSource: "map.html",
    extraStyles: [
      {
        href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
        integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
        crossorigin: ""
      }
    ],
    extraScripts: [
      {
        src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
        integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
        crossorigin: ""
      }
    ],
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "map",
      contentCollections: ["entities", "posts"],
      interactiveMounts: ["mapCanvas", "mapList"]
    }
  },
  {
    fileName: "get-involved.html",
    dataPage: "get-involved",
    title: "Get Involved | Nostr Site Template",
    description: "Use the sample support and participation page in the Nostr Site template.",
    mainSource: "get-involved.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "support",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "about.html",
    dataPage: "about",
    title: "About | Nostr Site Template",
    description: "Learn how the Nostr Site template is structured and what it is for.",
    mainSource: "about.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "about",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "merch.html",
    dataPage: "merch",
    title: "Merch | Nostr Site Template",
    description: "Sample merch and support page for the Nostr Site template.",
    mainSource: "merch.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "support",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "investigations.html",
    title: "Redirecting…",
    redirectTo: "./blog.html",
    redirectLabel: "Continue to the blog."
  },
  {
    fileName: "investigation.html",
    title: "Redirecting…",
    redirectTo: "./post.html",
    redirectLabel: "Continue to the post."
  }
];

export default {
  pageDefinitions,
  siteTemplate
};
