import SITE from "./site-config.js";
import { createNostrCmsClient } from "./portable/nostr-cms-core.js";

const client = createNostrCmsClient(SITE);

export const {
  getEventTools,
  hasNostrTools,
  ensureEventToolsLoaded,
  shortKey,
  normalizeUsername,
  cleanSlug,
  deriveIdentity,
  loadPublicState,
  publishTaggedJson,
  publishEncryptedJson,
  publishSubmission,
  publishSubmissionChat,
  publishAdminKeyShare,
  loadAdminKeyShare,
  loadUserSubmissions,
  loadInboxSubmissions,
  loadSubmissionThread
} = client;

export default client;
