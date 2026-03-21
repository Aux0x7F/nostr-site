export function createWorkspaceAccountController({
  state,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    rebroadcastAccount: async () => {},
    signInWithCredentials: async () => {
      throw new Error("signInWithCredentials is not configured.");
    },
    uploadPublicBlob: async () => {
      throw new Error("uploadPublicBlob is not configured.");
    },
    ...deps
  };

  const hooks = {
    currentUser: () => null,
    refreshWorkspace: async () => {},
    ...callbacks
  };

  function setLoginPending(button, pending) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = pending;
    button.dataset.busy = pending ? "yes" : "no";
    button.innerHTML = pending
      ? `<span class="loading-spinner" aria-hidden="true"></span><span>Opening account...</span>`
      : "Create/Login";
  }

  async function handleLogin(form) {
    const status = form.querySelector("[data-workspace-status]");
    const submitButton = form.querySelector("[data-login-submit]");
    try {
      setLoginPending(submitButton, true);
      if (status) {
        status.textContent = "Opening account...";
        status.dataset.state = "pending";
      }
      const formData = new FormData(form);
      const session = await runtime.signInWithCredentials(
        formData.get("username"),
        formData.get("password")
      );
      await runtime.rebroadcastAccount(session);
      if (status) {
        status.textContent = `Signed in as @${session.username}.`;
        status.dataset.state = "success";
      }
      await hooks.refreshWorkspace(true);
    } catch (error) {
      if (status) {
        status.textContent = String(error?.message || error || "Login failed.");
        status.dataset.state = "error";
      }
    } finally {
      setLoginPending(submitButton, false);
    }
  }

  async function handleProfileSave(form) {
    const status = form.querySelector("[data-workspace-status]");
    try {
      const formData = new FormData(form);
      const current = hooks.currentUser();
      let avatarUrl = String(current?.avatarUrl || "").trim();
      let avatarBlob = current?.avatarBlob || null;
      const avatarFile = formData.get("avatarFile");
      if (avatarFile instanceof File && avatarFile.size > 0) {
        const upload = await runtime.uploadPublicBlob(state.session.secretKeyHex, avatarFile, {
          purpose: "avatar"
        });
        avatarUrl = upload.url;
        avatarBlob = upload;
      }
      await runtime.rebroadcastAccount(state.session, {
        displayName: formData.get("displayName"),
        avatarUrl,
        avatarBlob,
        bio: formData.get("bio"),
        socialLinks: String(formData.get("socialLinks") || "")
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      });
      if (status) {
        status.textContent = "Profile updated.";
        status.dataset.state = "success";
      }
      await hooks.refreshWorkspace(true);
    } catch (error) {
      if (status) {
        status.textContent = String(error?.message || error || "Profile save failed.");
        status.dataset.state = "error";
      }
    }
  }

  return {
    handleLogin,
    handleProfileSave
  };
}
