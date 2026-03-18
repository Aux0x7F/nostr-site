export function createViewerController({
  state,
  site,
  deriveIdentity
} = {}) {
  function primeFromSession() {
    if (!state.session) {
      state.viewer = null;
      return null;
    }
    if (state.viewer?.pubkey) return state.viewer;
    const sessionPubkey = String(state.session.pubkey || "").trim();
    if (sessionPubkey) {
      state.viewer = { pubkey: sessionPubkey };
      return state.viewer;
    }
    try {
      state.viewer = deriveIdentity(state.session.secretKeyHex);
    } catch {
      state.viewer = null;
    }
    return state.viewer;
  }

  async function get() {
    if (state.viewer) return state.viewer;
    state.viewer = deriveIdentity(state.session.secretKeyHex);
    return state.viewer;
  }

  function sessionPubkey() {
    return String(primeFromSession()?.pubkey || "").trim();
  }

  function trustedPubkeys(publicState) {
    const admins = new Set(Array.isArray(publicState?.admins) ? publicState.admins : []);
    const rootAdminPubkey = String(publicState?.rootAdminPubkey || site?.nostr?.rootAdminPubkey || "").trim();
    if (rootAdminPubkey) admins.add(rootAdminPubkey);
    return [...admins];
  }

  function canEdit(publicState) {
    if (!state.session) return false;
    const viewerPubkey = sessionPubkey();
    if (!viewerPubkey) return false;
    return trustedPubkeys(publicState).includes(viewerPubkey);
  }

  return {
    get,
    primeFromSession,
    sessionPubkey,
    trustedPubkeys,
    canEdit
  };
}
