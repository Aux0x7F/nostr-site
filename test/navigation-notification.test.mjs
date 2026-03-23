import test from "node:test";
import assert from "node:assert/strict";

import {
  clampNotificationsPanel,
  closeProfileMenu,
  createNavigationUiState,
  keepProfileMenuOpen,
  toggleNotificationsPanel,
  toggleProfileMenu
} from "../scripts/core/navigation-state.js";
import {
  countNotificationItems,
  createNotificationState
} from "../scripts/core/notification-state.js";

test("template navigation ui state keeps notification visibility deterministic", () => {
  const state = createNavigationUiState();
  assert.equal(toggleProfileMenu(state), true);
  assert.equal(toggleNotificationsPanel(state, { count: 1, loading: false }), true);
  assert.equal(clampNotificationsPanel(state, { count: 0, loading: false }), false);
  keepProfileMenuOpen(state);
  assert.equal(state.profileMenuOpen, true);
  closeProfileMenu(state);
  assert.deepEqual(state, { profileMenuOpen: false, notificationsExpanded: false });
});

test("template notification state filters runtime-backed dismissed items after hydrate", async () => {
  const persisted = new Map();
  const notifications = createNotificationState({
    storageNamespace: "nostr-site.test",
    getSession: () => ({ username: "editor" }),
    getViewerPubkey: () => "editor-pubkey",
    getPublicState: async () => ({}),
    buildNotifications: async () => [
      { id: "x", createdAt: 2 },
      { id: "y", createdAt: 1 }
    ],
    loadDismissedIds: async (pubkey) => persisted.get(pubkey) || [],
    saveDismissedIds: async (pubkey, ids) => {
      persisted.set(pubkey, [...ids]);
    }
  });

  await notifications.hydrate();
  assert.equal(countNotificationItems(notifications.items), 2);
  notifications.dismiss("x");
  assert.deepEqual(persisted.get("editor-pubkey"), ["x"]);
  await notifications.hydrate();
  assert.deepEqual(notifications.items.map((item) => item.id), ["y"]);
});

test("template notification state supports runtime-backed dismissed ids", async () => {
  const persisted = new Map();
  const notifications = createNotificationState({
    storageNamespace: "nostr-site.test",
    getSession: () => ({ username: "editor" }),
    getViewerPubkey: () => "editor-pubkey",
    getPublicState: async () => ({}),
    buildNotifications: async () => [
      { id: "x", createdAt: 2 },
      { id: "y", createdAt: 1 }
    ],
    loadDismissedIds: async (pubkey) => persisted.get(pubkey) || [],
    saveDismissedIds: async (pubkey, ids) => {
      persisted.set(pubkey, [...ids]);
    }
  });

  await notifications.hydrate();
  notifications.dismiss("x");
  notifications.clear();

  assert.deepEqual(persisted.get("editor-pubkey"), ["x", "y"]);
});
