export function navLinkClass(page, navKeys, key, disabled = false) {
  const parts = ["nav-link"];
  if (navKeys[key]?.includes(page)) parts.push("is-current");
  if (disabled) parts.push("is-disabled");
  return parts.join(" ");
}

export function profileInitials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Me";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

export function profileBadgeMarkup(user, sessionUsername, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  if (user?.avatarUrl) {
    const label = user.displayName || user.username || "Profile";
    const blob = user.avatarBlob;
    const blobAttrs = blob?.sha256
      ? ` data-avatar-sha="${escapeAttribute(blob.sha256)}" data-avatar-url="${escapeAttribute(blob.url || user.avatarUrl)}" data-avatar-type="${escapeAttribute(blob.type || "")}" data-avatar-name="${escapeAttribute(blob.name || "")}"`
      : "";
    return `<img src="${escapeAttribute(user.avatarUrl)}" alt="${escapeAttribute(label)}"${blobAttrs}>`;
  }
  if (!sessionUsername) return "Create/Login";
  return escapeHtml(profileInitials(user?.displayName || sessionUsername));
}

export function renderNotificationItem(item, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <a class="profile-menu__notice-item" href="${escapeAttribute(item.href)}" data-notification-link="${escapeAttribute(item.id)}">
      <span class="profile-menu__notice-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail || "")}</span>
    </a>
  `;
}

export function renderNavigationMarkup({
  page = "",
  navKeys = {},
  isLoggedIn = false,
  isAdmin = false,
  currentUser = null,
  sessionUsername = "",
  notifications = [],
  notificationsLoading = false,
  mapEnabled = true,
  deps = {}
} = {}) {
  const profileMarkup = isLoggedIn
    ? `
      <div class="profile-menu ${navKeys.workspace?.includes(page) ? "is-current" : ""}" data-profile-menu>
        <button class="profile-menu__toggle ${currentUser?.avatarUrl ? "has-avatar" : ""}" type="button" data-profile-toggle aria-label="Profile options">
          <span class="profile-menu__badge ${currentUser?.avatarUrl ? "has-avatar" : ""}">${profileBadgeMarkup(currentUser, sessionUsername, deps)}</span>
          ${notifications.length ? `<span class="profile-menu__notice">${Math.min(notifications.length, 9)}${notifications.length > 9 ? "+" : ""}</span>` : ""}
        </button>
        <div class="profile-menu__panel">
          ${
            notificationsLoading
              ? `<div class="profile-menu__section"><div class="loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up notifications...</span></div></div>`
              : notifications.length
                ? `
                  <div class="profile-menu__section">
                    <div class="profile-menu__section-title">Notifications</div>
                    <div class="profile-menu__notifications">
                      ${notifications.map((item) => renderNotificationItem(item, deps)).join("")}
                    </div>
                  </div>
                `
                : ""
          }
          <a href="./admin.html?tab=profile">Profile</a>
          ${isAdmin ? `<a href="./admin.html?tab=dashboard">Admin</a>` : ""}
          <button type="button" data-signout>Sign out</button>
        </div>
      </div>
    `
    : `<a class="profile-cta" href="./admin.html?tab=login" aria-label="Create or log in">Create/Login</a>`;

  return `
    <a class="${navLinkClass(page, navKeys, "home")}" href="./index.html">Home</a>
    ${
      isAdmin
        ? `
          <div class="nav-group ${navKeys.blog?.includes(page) ? "is-current" : ""}" data-nav-group>
            <button class="nav-group__toggle" type="button" data-submenu-toggle>
              Blog
            </button>
            <div class="nav-group__panel">
              <a class="${navLinkClass(page, navKeys, "blog")}" href="./blog.html">View Blog</a>
              <a href="./editor.html">Create Post</a>
            </div>
          </div>
        `
        : `<a class="${navLinkClass(page, navKeys, "blog")}" href="./blog.html">Blog</a>`
    }
    <a class="${navLinkClass(page, navKeys, "map", !mapEnabled && !navKeys.map?.includes(page))}" href="./map.html" ${!mapEnabled && !navKeys.map?.includes(page) ? 'aria-disabled="true"' : ""}>Map</a>
    <div class="nav-group ${navKeys["get-involved"]?.includes(page) ? "is-current" : ""}" data-nav-group>
      <button class="nav-group__toggle" type="button" data-submenu-toggle>
        Get Involved
      </button>
      <div class="nav-group__panel">
        <a class="${navLinkClass(page, navKeys, "get-involved")}" href="./get-involved.html">Get Involved</a>
        <a class="${navLinkClass(page, navKeys, "guide")}" href="./guide.html">Guide</a>
        <a class="${navLinkClass(page, navKeys, "submit")}" href="./submit.html">Submit</a>
      </div>
    </div>
    <a class="${navLinkClass(page, navKeys, "about")}" href="./about.html">About</a>
    <a class="${navLinkClass(page, navKeys, "merch")}" href="./merch.html">Merch</a>
    ${profileMarkup}
  `;
}
