export function refreshTemplateSiteNavigation({
  features,
  state,
  hydrateNotifications
} = {}) {
  features?.siteShellFeature?.renderNavigation?.();
  if (state?.session) {
    void hydrateNotifications?.(true);
  }
}

export function startTemplateSiteBackgroundPrefetch({
  scheduleNonCriticalTask,
  postsStore
} = {}) {
  scheduleNonCriticalTask?.(() => {
    void postsStore?.hydrateCache?.().catch(() => []);
  }, { initialDelayMs: 900 });
}

export function initTemplateSiteLinkPrefetch({
  document,
  window
} = {}) {
  const prefetched = new Set();
  const maybePrefetch = (value) => {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin || prefetched.has(url.href)) return;
      prefetched.add(url.href);
      fetch(url.href, { cache: "force-cache" }).catch(() => null);
    } catch {
      return;
    }
  };
  const primeTarget = (target) => {
    if (!(target instanceof Element)) return;
    const link = target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    maybePrefetch(link.href);
  };
  document?.addEventListener?.("pointerover", (event) => primeTarget(event.target), { passive: true });
  document?.addEventListener?.("focusin", (event) => primeTarget(event.target));
}
