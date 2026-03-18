export function normalizeDraftStatus(status) {
  return String(status || "").trim().toLowerCase();
}

export function draftReviewAction(draft) {
  const tag = Array.isArray(draft?._event?.tags)
    ? draft._event.tags.find((item) => Array.isArray(item) && item[0] === "review")
    : null;
  return String(tag?.[1] || "").trim().toLowerCase();
}

export function draftStatusLabel(status, reviewAction = "") {
  const clean = normalizeDraftStatus(status);
  const action = String(reviewAction || "").trim().toLowerCase();
  if (["candidate", "review", "submitted"].includes(clean)) return "Submitted";
  if (clean === "approved") return "Approved";
  if (clean === "revision" || action === "revise") return "Revision requested";
  if (clean === "denied" || action === "deny") return "Denied";
  return "Draft";
}

export function draftOwnerPubkey(draft) {
  const revisions = Array.isArray(draft?.revisions) ? draft.revisions : [];
  const oldest = revisions.length ? revisions[revisions.length - 1] : null;
  return String(oldest?.author || draft?.author || "").trim().toLowerCase();
}

export function draftToPostPreview(draft) {
  const reviewAction = draftReviewAction(draft);
  return {
    ...draft,
    body: draft.markdown || "",
    statusLabel: draftStatusLabel(draft.status, reviewAction),
    records: [],
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    title: draft.title || "Untitled post",
    summary: draft.summary || "No summary added yet.",
    location: draft.location || "Draft location pending"
  };
}

export function reviewStatusForAction(action) {
  if (action === "approve") return "approved";
  if (action === "deny") return "denied";
  return "revision";
}

export function reviewActionMessage(action) {
  if (action === "approve") return "Post approved for publish.";
  if (action === "deny") return "Post denied.";
  return "Revision requested.";
}

export function reviewNotificationTitle(action) {
  if (action === "approve") return "Your post was approved";
  if (action === "deny") return "A post was denied";
  return "Revision was requested on your post";
}

export function shortReviewKey(value) {
  const clean = String(value || "").trim();
  return clean.length > 12 ? `${clean.slice(0, 8)}...${clean.slice(-4)}` : clean || "Editor";
}
