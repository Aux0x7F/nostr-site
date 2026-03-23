import test from "node:test";
import assert from "node:assert/strict";

import { renderNavigationMarkup } from "../scripts/template/surfaces/navigation.js";
import { renderWorkspaceView } from "../scripts/template/surfaces/workspace.js";

test("renderNavigationMarkup builds the template shell from surface markup", () => {
  const markup = renderNavigationMarkup({
    page: "blog",
    navKeys: {
      home: ["home"],
      blog: ["blog"],
      map: ["map"],
      "get-involved": ["get-involved"],
      guide: ["guide"],
      submit: ["submit"],
      about: ["about"],
      merch: ["merch"],
      workspace: ["workspace"]
    },
    isLoggedIn: true,
    isAdmin: true,
    currentUser: { displayName: "Editor" },
    sessionUsername: "editor",
    notifications: [{ id: "1", href: "./admin.html", label: "Review", title: "Pending", detail: "1 waiting" }],
    notificationsLoading: false,
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /Create Post/);
  assert.match(markup, />Map</);
  assert.doesNotMatch(markup, /aria-disabled="true"/);
  assert.match(markup, />Admin</);
  assert.match(markup, /Notifications/);
});

test("renderNavigationMarkup exposes the shell auth trigger when logged out", () => {
  const markup = renderNavigationMarkup({
    page: "home",
    navKeys: {
      home: ["home"],
      blog: ["blog"],
      map: ["map"],
      "get-involved": ["get-involved"],
      guide: ["guide"],
      submit: ["submit"],
      about: ["about"],
      merch: ["merch"],
      workspace: ["workspace"]
    },
    isLoggedIn: false
  });

  assert.match(markup, /data-auth-open/);
  assert.doesNotMatch(markup, /admin\.html\?tab=login/);
});

test("renderWorkspaceView keeps login and comments panes modular", () => {
  const loginView = renderWorkspaceView({
    workspaceState: { session: null, activeTab: "login" },
    deps: {
      tabButtons: () => [{ id: "login", label: "Log in" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`,
      currentUserIsAdmin: () => false
    }
  });

  assert.equal(loginView.title, "Log in");
  assert.match(loginView.paneMarkup, /data-login-form/);

  const commentsView = renderWorkspaceView({
    workspaceState: {
      session: { username: "editor" },
      viewer: { pubkey: "admin" },
      activeTab: "comments",
      publicState: {
        commentsByAuthor: new Map(),
        allComments: [{ id: "c1", author: "user", markdown: "Comment", post_slug: "post", created_at: 1, visibility: "visible" }],
        hiddenComments: []
      }
    },
    deps: {
      tabButtons: () => [{ id: "comments", label: "Comments" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`,
      currentUserIsAdmin: () => true,
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || ""),
      renderModerationComment: (comment) => `<article data-comment-id="${comment.id}">${comment.markdown}</article>`,
      renderEntityModal: () => "",
      renderChatModal: () => "",
      renderLogPane: () => ""
    }
  });

  assert.equal(commentsView.title, "Workspace");
  assert.match(commentsView.paneMarkup, /Review comments/);
  assert.match(commentsView.paneMarkup, /data-comment-id="c1"/);
});

test("renderWorkspaceView keeps the profile handle immutable", () => {
  const profileView = renderWorkspaceView({
    workspaceState: {
      session: { username: "editor" },
      activeTab: "profile",
      viewer: { pubkey: "admin" }
    },
    deps: {
      tabButtons: () => [{ id: "profile", label: "Profile" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`,
      currentUserIsAdmin: () => false,
      currentUser: () => ({ username: "editor", displayName: "Editor", socialLinks: [] }),
      escapeHtml: (value) => String(value || ""),
      renderEntityModal: () => "",
      renderChatModal: () => "",
      renderLogPane: () => ""
    }
  });

  assert.doesNotMatch(profileView.paneMarkup, /name="displayName"/);
  assert.doesNotMatch(profileView.paneMarkup, /Display name/);
});
