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

test("template notification state filters dismissed items after hydrate", async () => {
  const storage = new Map();
  const notifications = createNotificationState({
    storageNamespace: "nostr-site.test",
    getSession: () => ({ username: "editor" }),
    getViewerPubkey: () => "editor-pubkey",
    getPublicState: async () => ({}),
    buildNotifications: async () => [
      { id: "x", createdAt: 2 },
      { id: "y", createdAt: 1 }
    ],
    readStorage: (key) => storage.get(key) || null,
    writeStorage: (key, value) => storage.set(key, value)
  });

  await notifications.hydrate();
  assert.equal(countNotificationItems(notifications.items), 2);
  notifications.dismiss("x");
  await notifications.hydrate();
  assert.deepEqual(notifications.items.map((item) => item.id), ["y"]);
});
