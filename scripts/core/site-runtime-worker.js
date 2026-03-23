import SITE from "./site-config.js";
import { loadPublicState } from "./nostr.js";
import {
  loadAdminKeyShare,
  loadInboxSubmissions,
  loadSubmissionThread,
  loadUserSubmissions
} from "./nostr.js";
import { createSiteNotificationBuilder } from "./notification-builders.js";
import {
  loadContentPostsProjection,
  loadNotificationsProjection
} from "./runtime-projections.js";
import {
  rebroadcastAccount,
  rotateAccountCredentials,
  signInWithCredentials
} from "./session.js";
import { createIndexedRuntimeDatabase } from "../../portable/runtime-db.js";
import { createRuntimeHost } from "../../portable/runtime-host.js";
import { attachSharedRuntimeWorker } from "../../portable/runtime-worker.js";

const buildNotifications = createSiteNotificationBuilder({
  deps: {
    publicStateHasAdminPubkey: (publicState, pubkey = "") => {
      const cleanPubkey = String(pubkey || "").trim().toLowerCase();
      return Boolean(
        cleanPubkey &&
          (
            (Array.isArray(publicState?.admins) ? publicState.admins : [])
              .map((value) => String(value || "").trim().toLowerCase())
              .includes(cleanPubkey) ||
            cleanPubkey === String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase()
          )
      );
    },
    loadAdminKeyShare,
    loadInboxSubmissions,
    loadSubmissionThread,
    loadUserSubmissions
  }
});

const host = createRuntimeHost({
  database: createIndexedRuntimeDatabase({
    namespace: SITE.nostr.storageNamespace
  }),
  auth: {
    async signIn({ username, password }) {
      const session = await signInWithCredentials(username, password, {
        persistSession: false
      });
      let warning = "";
      try {
        await rebroadcastAccount(session);
      } catch (error) {
        warning = String(error?.message || error || "Signed in, but network broadcast is still catching up.");
      }
      return {
        session,
        warning
      };
    },
    async signOut() {
      return {
        session: null
      };
    },
    async rotatePassword({ session, nextPassword }) {
      if (!session?.secretKeyHex || !session?.username) {
        throw new Error("Sign in before changing this password.");
      }
      const rotation = await rotateAccountCredentials(session, nextPassword, {
        persistSession: false
      });
      return {
        ...rotation,
        session: rotation.session
      };
    }
  },
  actions: {
    async "activity.recordVisitPulse"(payload = {}, { session, host: runtimeHost }) {
      const secretKeyHex = String(session?.secretKeyHex || payload?.secretKeyHex || "").trim().toLowerCase();
      const day = String(payload?.day || new Date().toISOString().slice(0, 10)).trim();
      const page = String(payload?.page || "site").trim().toLowerCase() || "site";
      if (!secretKeyHex || !day || !SITE?.nostr?.kinds?.visitPulse) return null;
      const markerParams = {
        day,
        __projectionScope: "global"
      };
      const marker = await runtimeHost.getProjectionValue("visitPulseMarker", markerParams, {
        preferFresh: false
      }).catch(() => null);
      if (marker) return marker;
      await host.publish({
        kind: SITE.nostr.kinds.visitPulse,
        secretKeyHex,
        tags: [
          ["t", SITE.nostr.appTag],
          ["k", page]
        ],
        content: {
          day,
          page
        }
      });
      const saved = {
        page,
        recordedAt: Date.now()
      };
      await runtimeHost.rememberProjection("visitPulseMarker", markerParams, saved, {
        source: "visit-pulse"
      });
      return saved;
    }
  },
  projectionLoaders: {
    async publicState({ params }) {
      return loadPublicState(Boolean(params?.force));
    },
    async contentPosts(context) {
      return loadContentPostsProjection(context);
    },
    async notifications(context) {
      return loadNotificationsProjection({
        ...context,
        buildNotifications
      });
    }
  }
});

attachSharedRuntimeWorker(host);
