function normalizeComment(comment) {
  if (!comment || typeof comment !== "object") return null;
  const id = String(comment.id || "").trim();
  const postSlug = String(comment.post_slug || "").trim();
  if (!id || !postSlug) return null;
  return {
    ...comment,
    id,
    post_slug: postSlug,
    parent_id: String(comment.parent_id || "").trim(),
    root_id: String(comment.root_id || "").trim()
  };
}

export function compareCommentRepliesChronologically(left, right) {
  const leftTime = Number(left?.created_at || 0);
  const rightTime = Number(right?.created_at || 0);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function compareCommentRootsByScore(left, right) {
  const leftScore = Number(left?.score || 0);
  const rightScore = Number(right?.score || 0);
  if (leftScore !== rightScore) return rightScore - leftScore;
  return compareCommentRepliesChronologically(left, right);
}

export function buildCommentThreadState(comments, {
  rootComparator = compareCommentRootsByScore,
  replyComparator = compareCommentRepliesChronologically
} = {}) {
  const normalized = (Array.isArray(comments) ? comments : [])
    .map((comment) => normalizeComment(comment))
    .filter(Boolean)
    .sort(compareCommentRepliesChronologically);
  const commentsById = new Map(normalized.map((comment) => [comment.id, comment]));
  const childrenByParent = new Map();
  const rootsByPost = new Map();
  const orphansByPost = new Map();

  for (const comment of normalized) {
    const parentId = comment.parent_id;
    if (!parentId) {
      pushGroup(rootsByPost, comment.post_slug, comment.id);
      continue;
    }
    const parent = commentsById.get(parentId) || null;
    if (isValidCommentParent(parent, comment, commentsById)) {
      pushGroup(childrenByParent, parent.id, comment.id);
      continue;
    }
    pushGroup(orphansByPost, comment.post_slug, comment.id);
  }

  const threadsByPost = new Map();
  for (const [postSlug, rootIds] of rootsByPost.entries()) {
    const roots = rootIds
      .map((rootId) => buildThreadNode(rootId, commentsById, childrenByParent, replyComparator, 0, rootId))
      .filter(Boolean)
      .sort(rootComparator);
    threadsByPost.set(postSlug, roots);
  }

  const orphanNodesByPost = new Map();
  for (const [postSlug, orphanIds] of orphansByPost.entries()) {
    const nodes = orphanIds
      .map((commentId) => buildOrphanNode(commentId, commentsById))
      .filter(Boolean)
      .sort(replyComparator);
    orphanNodesByPost.set(postSlug, nodes);
  }

  return {
    commentsById,
    childrenByParent,
    threadsByPost,
    orphansByPost: orphanNodesByPost
  };
}

function buildThreadNode(commentId, commentsById, childrenByParent, replyComparator, depth, rootId) {
  const comment = commentsById.get(commentId) || null;
  if (!comment) return null;
  const childIds = (childrenByParent.get(commentId) || []).slice();
  const replies = childIds
    .map((childId) => buildThreadNode(childId, commentsById, childrenByParent, replyComparator, depth + 1, rootId))
    .filter(Boolean)
    .sort(replyComparator);
  return {
    ...comment,
    depth,
    root_id: depth === 0 ? comment.id : rootId,
    replies
  };
}

function buildOrphanNode(commentId, commentsById) {
  const comment = commentsById.get(commentId) || null;
  if (!comment) return null;
  return {
    ...comment,
    depth: 0,
    replies: [],
    orphaned: true
  };
}

function isValidCommentParent(parent, node, commentsById) {
  if (!parent || !node) return false;
  if (parent.id === node.id) return false;
  if (parent.post_slug !== node.post_slug) return false;
  let current = parent;
  const seen = new Set([node.id]);
  while (current) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    const parentId = String(current.parent_id || "").trim();
    current = parentId ? commentsById.get(parentId) || null : null;
    if (current && current.post_slug !== node.post_slug) return false;
  }
  return true;
}

function pushGroup(map, key, value) {
  const bucket = map.get(key) || [];
  bucket.push(value);
  map.set(key, bucket);
}
