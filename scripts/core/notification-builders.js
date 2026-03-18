import {
  draftOwnerPubkey,
  draftReviewAction,
  normalizeDraftStatus,
  reviewNotificationTitle
} from "./draft-review.js";
import { dedupeStrings as dedupe, trimmed } from "./text-utils.js";

export function createSiteNotificationBuilder({
  deps = {}
} = {}) {
  const loadUserSubmissions = deps.loadUserSubmissions || (async () => []);
  const loadSubmissionThread = deps.loadSubmissionThread || (async () => []);
  const loadAdminKeyShare = deps.loadAdminKeyShare || (async () => null);
  const loadInboxSubmissions = deps.loadInboxSubmissions || (async () => []);

  return async function buildNotifications({ publicState, viewer, sessionSecretKeyHex }) {
    if (!viewer?.pubkey) return [];
    const notifications = [];
    const isAdmin = Array.isArray(publicState?.admins) && publicState.admins.includes(viewer.pubkey);
    const commentMap = new Map((publicState?.allComments || []).map((comment) => [comment.id, comment]));

    for (const comment of publicState?.comments || []) {
      if (!comment.parent_id || comment.author === viewer.pubkey) continue;
      const parent = commentMap.get(comment.parent_id);
      if (!parent || parent.author !== viewer.pubkey) continue;
      notifications.push({
        id: `comment-reply:${comment.id}`,
        createdAt: comment.created_at,
        href: `./post.html?slug=${encodeURIComponent(comment.post_slug)}#comment-${encodeURIComponent(comment.id)}`,
        label: "Comment reply",
        title: "Someone replied to your comment",
        detail: trimmed(comment.markdown, 100)
      });
    }

    for (const draft of publicState?.drafts || []) {
      const reviewAction = draftReviewAction(draft);
      const ownerPubkey = draftOwnerPubkey(draft);
      const isPending = ["candidate", "review", "submitted"].includes(normalizeDraftStatus(draft.status));
      if (ownerPubkey === viewer.pubkey && ["approve", "revise", "deny"].includes(reviewAction)) {
        notifications.push({
          id: `draft-review:${draft.slug}:${draft.created_at}`,
          createdAt: draft.created_at,
          href: normalizeDraftStatus(draft.status) === "revision"
            ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
            : `./post.html?draft=${encodeURIComponent(draft.slug)}`,
          label: "Post review",
          title: reviewNotificationTitle(reviewAction),
          detail: draft.title
        });
      }
      if (isAdmin && isPending) {
        notifications.push({
          id: `pending-draft:${draft.slug}:${draft.created_at}`,
          createdAt: draft.created_at,
          href: `./post.html?draft=${encodeURIComponent(draft.slug)}`,
          label: "Review queue",
          title: "New post pending review",
          detail: draft.title
        });
      }
    }

    if (isAdmin) {
      for (const comment of publicState?.comments || []) {
        if (comment.author === viewer.pubkey) continue;
        notifications.push({
          id: `post-comment:${comment.id}`,
          createdAt: comment.created_at,
          href: `./post.html?slug=${encodeURIComponent(comment.post_slug)}#comment-${encodeURIComponent(comment.id)}`,
          label: "Post reply",
          title: "New comment on a published post",
          detail: trimmed(comment.markdown, 100)
        });
      }
    }

    const submissionNotifications = await loadSubmissionNotifications({
      publicState,
      viewerPubkey: viewer.pubkey,
      isAdmin,
      sessionSecretKeyHex,
      loadUserSubmissions,
      loadSubmissionThread,
      loadAdminKeyShare,
      loadInboxSubmissions
    });
    notifications.push(...submissionNotifications);

    return notifications
      .sort((left, right) => right.createdAt - left.createdAt)
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
  };
}

async function loadSubmissionNotifications({
  publicState,
  viewerPubkey,
  isAdmin,
  sessionSecretKeyHex,
  loadUserSubmissions,
  loadSubmissionThread,
  loadAdminKeyShare,
  loadInboxSubmissions
}) {
  if (!sessionSecretKeyHex) return [];
  const notifications = [];
  const knownSitePubkeys = notificationSitePubkeys(publicState);
  const ownSubmissions = await loadUserSubmissions(sessionSecretKeyHex).catch(() => []);
  const ownThreads = await Promise.all(
    ownSubmissions.slice(0, 8).map(async (submission) => ({
      submissionId: submission.id,
      messages: await loadSubmissionThread(sessionSecretKeyHex, submission.id, knownSitePubkeys).catch(() => [])
    }))
  );
  for (const thread of ownThreads) {
    for (const message of thread.messages) {
      if (message.author === viewerPubkey) continue;
      notifications.push({
        id: `submission-chat:${thread.submissionId}:${message.id}`,
        createdAt: Number(message.event?.created_at || 0),
        href: `./submit.html?chat=${encodeURIComponent(thread.submissionId)}`,
        label: "Submission chat",
        title: "New message in a submission thread",
        detail: trimmed(message.payload?.body || "", 100)
      });
    }
  }
  if (isAdmin) {
    const activeSitePubkey = publicState?.siteInfo?.activePubkey || "";
    const share = activeSitePubkey
      ? await loadAdminKeyShare(sessionSecretKeyHex, activeSitePubkey).catch(() => null)
      : null;
    if (share?.siteSecretKeyHex) {
      const inboxSubmissions = await loadInboxSubmissions(share.siteSecretKeyHex).catch(() => []);
      const inboxThreads = await Promise.all(
        inboxSubmissions.slice(0, 8).map(async (submission) => ({
          submissionId: submission.id,
          messages: await loadSubmissionThread(share.siteSecretKeyHex, submission.id, [submission.author]).catch(() => [])
        }))
      );
      for (const thread of inboxThreads) {
        for (const message of thread.messages) {
          if (message.author === viewerPubkey) continue;
          notifications.push({
            id: `admin-chat:${thread.submissionId}:${message.id}`,
            createdAt: Number(message.event?.created_at || 0),
            href: `./admin.html?tab=submissions`,
            label: "Submission chat",
            title: "New submission message in the shared inbox",
            detail: trimmed(message.payload?.body || "", 100)
          });
        }
      }
    }
  }
  return notifications;
}

function notificationSitePubkeys(publicState) {
  return dedupe([
    publicState?.siteInfo?.activePubkey || "",
    publicState?.siteInfo?.fallbackPubkey || "",
    ...((publicState?.siteInfo?.events || []).map((event) => event.site_pubkey || ""))
  ]);
}
