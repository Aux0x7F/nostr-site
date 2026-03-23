import SITE from "./core/site-config.js";
import { createImmediateSiteShell } from "./core/immediate-site-shell.js";
import { getSiteRuntimeClient } from "./core/runtime-client.js";
import { registerSiteServiceWorker } from "./core/service-worker.js";
import NAV_KEYS from "./template/core/nav-keys.js";
import { createSiteAuthModalFeature } from "./template/features/site-auth-modal.js";
import { renderNavigationMarkup } from "./template/surfaces/navigation.js";

const GLOBAL_SHELL_KEY = "__nostrSiteImmediateShell";
const GLOBAL_AUTH_KEY = "__nostrSiteAuthModal";

function mountImmediateShell() {
  window[GLOBAL_SHELL_KEY]?.destroy?.();
  window[GLOBAL_AUTH_KEY]?.destroy?.();
  const shell = createImmediateSiteShell({
    site: SITE,
    navKeys: NAV_KEYS,
    renderNavigationMarkup,
    sessionChangedEventName: "nostrsite:session-changed"
  });
  const authModal = createSiteAuthModalFeature({
    sessionChangedEventName: "nostrsite:session-changed"
  });
  window[GLOBAL_SHELL_KEY] = shell;
  window[GLOBAL_AUTH_KEY] = authModal;
  shell.mount();
  authModal.mount();
  void getSiteRuntimeClient().catch(() => null);
  registerSiteServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountImmediateShell, { once: true });
} else {
  mountImmediateShell();
}
