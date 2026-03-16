import SITE from "./site-config.js";
import { createNostrCmsClient } from "../../portable/nostr-cms-core.js";
import { createBlobStoreApi } from "../../portable/blob-store.js";

const client = createNostrCmsClient(SITE);
const blobs = createBlobStoreApi(SITE, client);

export const {
  getEventTools,
  hasNostrTools,
  ensureEventToolsLoaded,
  shortKey,
  normalizeUsername,
  cleanSlug,
  deriveIdentity,
  generateSecretKeyHex,
  resolveSitePubkey,
  loadPublicState,
  publicStateNeedsRepair,
  requestPublicStateRepair,
  startPublicStateRepairPeer,
  stopPublicStateRepairPeer,
  publishTaggedJson,
  publishEncryptedJson,
  publishSubmission,
  publishSubmissionChat,
  publishAdminKeyShare,
  publishAdminKeyRequest,
  publishSiteKeyEvent,
  loadAdminKeyShares,
  loadAdminKeyShare,
  lookupUsers,
  loadUserSubmissions,
  loadInboxSubmissions,
  loadSubmissionThread
} = client;

export const {
  uploadPublicBlob,
  uploadEncryptedBlob,
  decryptUploadedBlob,
  ensureBlobAvailable,
  publishBlobRequest,
  waitForBlobFulfillment
} = blobs;

export default {
  ...client,
  ...blobs
};
