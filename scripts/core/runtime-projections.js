import { parseContentDocument, slugify } from "./content-utils.js";
import { fetchJson, fetchText } from "./http.js";

let postsPromise = null;

export async function loadContentPostsProjection() {
  if (!postsPromise) {
    postsPromise = fetchJson("./content/blog/index.json")
      .then((data) => Promise.all((Array.isArray(data?.files) ? data.files : []).map(async (file) => {
        const text = await fetchText(`./content/blog/${file}`);
        const parsed = parseContentDocument(text, {
          file,
          slug: slugify(file.replace(/\.md$/i, ""))
        });
        return {
          ...parsed.meta,
          file,
          slug: parsed.meta.slug || slugify(file.replace(/\.md$/i, "")),
          body: parsed.body
        };
      })))
      .then((posts) =>
        posts
          .filter(Boolean)
          .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
      );
  }
  return postsPromise;
}

export async function loadNotificationsProjection({
  session,
  host,
  buildNotifications = async () => []
} = {}) {
  const cleanViewerPubkey = String(session?.pubkey || "").trim().toLowerCase();
  const sessionSecretKeyHex = String(session?.secretKeyHex || "").trim();
  if (!cleanViewerPubkey || !sessionSecretKeyHex) {
    return { items: [] };
  }

  const getProjectionValue = createProjectionValueReader(host);
  const [publicState, dismissedIds] = await Promise.all([
    getProjectionValue("publicState", {}, { preferFresh: false }),
    getProjectionValue(
      "dismissedNotifications",
      { viewerPubkey: cleanViewerPubkey, __projectionScope: "global" },
      { preferFresh: false }
    )
  ]);

  const nextItems = await buildNotifications({
    publicState,
    viewer: {
      pubkey: cleanViewerPubkey
    },
    sessionSecretKeyHex
  });
  const dismissed = new Set(
    (Array.isArray(dismissedIds) ? dismissedIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  return {
    items: dedupeNotifications(nextItems)
      .filter((item) => !dismissed.has(String(item?.id || "").trim()))
      .slice(0, 12)
  };
}

function createProjectionValueReader(host = {}) {
  if (typeof host?.getProjectionValue === "function") {
    return (channel, params = {}, options = {}) => host.getProjectionValue(channel, params, options);
  }
  return async (channel, params = {}, options = {}) => {
    const projection = await host.getProjection(channel, params, options);
    return projection?.value ?? projection ?? null;
  };
}

function dedupeNotifications(items) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push(item);
  }
  return list;
}
