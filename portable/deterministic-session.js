export function createDeterministicSessionApi(config, deps) {
  const {
    deriveIdentity,
    ensureEventToolsLoaded,
    normalizeUsername,
    publishTaggedJson
  } = deps;
  const storageKey = `${config.nostr.storageNamespace}.session`;
  const guestStorageKey = `${config.nostr.storageNamespace}.guest`;

  function getStoredSession() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.username || !parsed.secretKeyHex) return null;
      return {
        username: normalizeUsername(parsed.username),
        secretKeyHex: String(parsed.secretKeyHex || "").trim().toLowerCase(),
        pubkey: String(parsed.pubkey || "").trim().toLowerCase()
      };
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        username: normalizeUsername(session.username),
        secretKeyHex: String(session.secretKeyHex || "").trim().toLowerCase(),
        pubkey: String(session.pubkey || "").trim().toLowerCase()
      })
    );
  }

  function clearSession() {
    localStorage.removeItem(storageKey);
  }

  function getStoredGuestSession() {
    try {
      const raw = localStorage.getItem(guestStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.secretKeyHex) return null;
      return {
        kind: "guest",
        guestId: String(parsed.guestId || "").trim(),
        secretKeyHex: String(parsed.secretKeyHex || "").trim().toLowerCase(),
        pubkey: String(parsed.pubkey || "").trim().toLowerCase(),
        createdAt: String(parsed.createdAt || "").trim()
      };
    } catch {
      return null;
    }
  }

  function saveGuestSession(session) {
    localStorage.setItem(
      guestStorageKey,
      JSON.stringify({
        guestId: String(session.guestId || "").trim(),
        secretKeyHex: String(session.secretKeyHex || "").trim().toLowerCase(),
        pubkey: String(session.pubkey || "").trim().toLowerCase(),
        createdAt: String(session.createdAt || "").trim()
      })
    );
  }

  function clearGuestSession() {
    localStorage.removeItem(guestStorageKey);
  }

  async function signInWithCredentials(username, password, options = {}) {
    const normalized = normalizeUsername(username);
    if (!normalized) throw new Error("Enter a username.");
    if (!String(password || "").trim()) throw new Error("Enter a password.");
    const secretKeyHex = await deriveSecretKeyHex(normalized, password);
    await ensureEventToolsLoaded();
    const identity = deriveIdentity(secretKeyHex);
    const session = {
      username: normalized,
      secretKeyHex,
      pubkey: identity.pubkey
    };
    if (typeof options?.validateSession === "function") {
      await options.validateSession(session);
    }
    saveSession(session);
    return session;
  }

  async function getOrCreateGuestSession() {
    const existing = getStoredGuestSession();
    if (existing?.secretKeyHex && existing?.pubkey) return existing;
    await ensureEventToolsLoaded();
    let attempt = 0;
    while (attempt < 8) {
      const secretKeyHex = await randomSecretKeyHex();
      try {
        const identity = deriveIdentity(secretKeyHex);
        const session = {
          kind: "guest",
          guestId: await randomGuestId(),
          secretKeyHex,
          pubkey: identity.pubkey,
          createdAt: new Date().toISOString()
        };
        saveGuestSession(session);
        return session;
      } catch {
        attempt += 1;
      }
    }
    throw new Error("Could not derive a valid guest identity.");
  }

  async function rebroadcastAccount(session, profile = {}, options = {}) {
    if (!session?.secretKeyHex || !session?.username) return null;
    const username = normalizeUsername(session.username);
    if (typeof options?.validateSession === "function") {
      await options.validateSession(session);
    }
    const publishProfile = () =>
      publishTaggedJson({
        kind: config.nostr.kinds.profile,
        secretKeyHex: session.secretKeyHex,
        tags: [["d", "profile"]],
        content: {
          username,
          display_name: String(profile.displayName || "").trim(),
          avatar_url: String(profile.avatarUrl || "").trim(),
          avatar_blob: profile.avatarBlob || null,
          bio: String(profile.bio || "").trim(),
          social_links: Array.isArray(profile.socialLinks)
            ? profile.socialLinks.map((item) => String(item || "").trim()).filter(Boolean)
            : []
        }
      });
    const publishClaim = () =>
      publishTaggedJson({
        kind: config.nostr.kinds.nameClaim,
        secretKeyHex: session.secretKeyHex,
        tags: [["d", `user:${username}`], ["u", username]],
        content: {
          username,
          username_normalized: username
        }
      });

    let claimResult = await publishClaim();
    let profileResult = await publishProfile();

    if (!claimResult.ok && !profileResult.ok) {
      await delay(900);
      claimResult = await publishClaim();
      profileResult = await publishProfile();
    }

    if (!claimResult.ok && !profileResult.ok) {
      throw new Error("Could not reach any relay for this account update.");
    }

    return session;
  }

  async function rotateAccountCredentials(session, nextPassword, options = {}) {
    const currentUsername = normalizeUsername(session?.username || "");
    if (!session?.secretKeyHex || !currentUsername) throw new Error("Sign in before rotating this account.");
    if (!String(nextPassword || "").trim()) throw new Error("Enter a new password.");
    const nextUsername = normalizeUsername(options?.nextUsername || currentUsername);
    if (nextUsername !== currentUsername) {
      throw new Error("Username changes are not supported during password rotation.");
    }
    const nextSecretKeyHex = await deriveSecretKeyHex(nextUsername, nextPassword);
    await ensureEventToolsLoaded();
    const currentIdentity = deriveIdentity(session.secretKeyHex);
    const nextIdentity = deriveIdentity(nextSecretKeyHex);
    const nextSession = {
      username: nextUsername,
      secretKeyHex: nextSecretKeyHex,
      pubkey: nextIdentity.pubkey
    };
    if (typeof options?.validateCurrentSession === "function") {
      await options.validateCurrentSession(session);
    }
    const rotationId = String(options?.rotationId || `rotate:${currentIdentity.pubkey}:${nextIdentity.pubkey}`).trim();
    const createdAt = Math.floor(Date.now() / 1000);
    const commonTags = [
      ["d", rotationId],
      ["from", currentIdentity.pubkey],
      ["to", nextIdentity.pubkey],
      ["u", nextUsername]
    ];
    const content = {
      protocol: String(config?.nostr?.protocolPrefix || config?.nostr?.clientName || config?.nostr?.appTag || "nostr-site"),
      rotation_id: rotationId,
      old_pubkey: currentIdentity.pubkey,
      new_pubkey: nextIdentity.pubkey,
      username: nextUsername,
      rotated_at: new Date(createdAt * 1000).toISOString()
    };
    const publishPropose = () =>
      publishTaggedJson({
        kind: config.nostr.kinds.identityRotation,
        secretKeyHex: session.secretKeyHex,
        tags: [...commonTags],
        createdAt,
        content: {
          ...content,
          action: "propose"
        }
      });
    const publishAccept = () =>
      publishTaggedJson({
        kind: config.nostr.kinds.identityRotation,
        secretKeyHex: nextSecretKeyHex,
        tags: [...commonTags, ["p", currentIdentity.pubkey]],
        createdAt,
        content: {
          ...content,
          action: "accept"
        }
      });

    let proposeResult = { ok: false };
    let acceptResult = { ok: false };
    let attempts = 0;
    while (attempts < 3 && (!proposeResult.ok || !acceptResult.ok)) {
      if (!proposeResult.ok) {
        proposeResult = await publishPropose();
      }
      if (!acceptResult.ok) {
        acceptResult = await publishAccept();
      }
      attempts += 1;
      if (!proposeResult.ok || !acceptResult.ok) {
        await delay(900 * attempts);
      }
    }
    if (!proposeResult.ok || !acceptResult.ok) {
      throw new Error("Could not fully publish this password rotation. Keep using the current password and try again.");
    }
    saveSession(nextSession);
    return {
      session: nextSession,
      previousPubkey: currentIdentity.pubkey,
      rotationId,
      proposed: Boolean(proposeResult.ok),
      accepted: Boolean(acceptResult.ok)
    };
  }

  async function deriveSecretKeyHex(username, password) {
    const normalized = normalizeUsername(username);
    if (!normalized) throw new Error("Enter a username.");
    let attempt = 0;
    while (attempt < 8) {
      const input = `${config.nostr.appTag}\n${normalized}\n${String(password || "")}\n${attempt}`;
      const bytes = await digestText(input);
      const hex = bytesToHex(bytes);
      try {
        await ensureEventToolsLoaded();
        deriveIdentity(hex);
        return hex;
      } catch {
        attempt += 1;
      }
    }
    throw new Error("Could not derive a valid keypair from these credentials.");
  }

  return {
    getStoredSession,
    saveSession,
    clearSession,
    getStoredGuestSession,
    saveGuestSession,
    clearGuestSession,
    getOrCreateGuestSession,
    signInWithCredentials,
    rebroadcastAccount,
    rotateAccountCredentials,
    deriveSecretKeyHex
  };
}

export default createDeterministicSessionApi;

async function digestText(value) {
  const encoded = new TextEncoder().encode(String(value || ""));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(hash);
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function randomSecretKeyHex() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function randomGuestId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `guest-${bytesToHex(bytes)}`;
}

function delay(ms) {
  const timeout = typeof globalThis?.setTimeout === "function" ? globalThis.setTimeout.bind(globalThis) : setTimeout;
  return new Promise((resolve) => timeout(resolve, Number(ms) || 0));
}
