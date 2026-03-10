import SITE from "../site-config.js";
import {
  deriveIdentity,
  ensureEventToolsLoaded,
  loadPublicState,
  loadSubmissionThread,
  loadUserSubmissions,
  publishSubmission,
  publishSubmissionChat
} from "../nostr.js";
import { getStoredSession } from "../session.js";

const submitState = {
  session: getStoredSession(),
  viewer: null,
  publicState: null,
  submissions: [],
  formModal: null,
  chatModal: null
};

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-submit-page]")) return;
  bindSubmitPage();
  void refreshSubmitPage();
});

function bindSubmitPage() {
  const shell = document.querySelector("[data-submit-shell]");
  if (!shell) return;

  shell.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("[data-open-submission-modal]")) {
      const submissionId = target.getAttribute("data-open-submission-modal") || "";
      workspaceOpenSubmission(submissionId);
      return;
    }

    if (target.closest("[data-open-submission-chat]")) {
      submitState.chatModal = { submissionId: target.getAttribute("data-open-submission-chat") || "" };
      renderSubmitPage();
      await hydrateChatModal();
      return;
    }

    if (target.closest("[data-submit-modal-close]")) {
      submitState.formModal = null;
      submitState.chatModal = null;
      renderSubmitPage();
    }
  });

  shell.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.matches("[data-submission-form]")) {
      await handleSubmissionSave(form);
      return;
    }
    if (form.matches("[data-submission-chat-form]")) {
      await handleChatSend(form);
    }
  });
}

async function refreshSubmitPage(force = false) {
  submitState.session = getStoredSession();
  if (!submitState.session) {
    renderSubmitPage();
    return;
  }
  await ensureEventToolsLoaded();
  submitState.viewer = deriveIdentity(submitState.session.secretKeyHex);
  submitState.publicState = await loadPublicState(force);
  submitState.submissions = await loadUserSubmissions(submitState.session.secretKeyHex).catch(() => []);
  renderSubmitPage();
}

function renderSubmitPage() {
  const shell = document.querySelector("[data-submit-shell]");
  const lede = document.querySelector("[data-submit-lede]");
  if (!shell || !lede) return;

  if (!submitState.session) {
    lede.textContent = "Log in to submit material, track status changes, and keep a private thread attached to each submission.";
    shell.innerHTML = `
      <section class="surface-panel">
        <div class="eyebrow">Log in required</div>
        <h2>Use a shared account first</h2>
        <p>Submission history and encrypted discussion are tied to your site identity.</p>
        <div class="button-row">
          <a class="button" href="./admin.html?tab=login">Log in</a>
        </div>
      </section>
    `;
    return;
  }

  lede.textContent = "Each submission stays attached to your account, with status updates and a message thread once admins reply from the shared inbox.";
  shell.innerHTML = `
    <section class="surface-panel">
      <div class="workspace-list__row">
        <div>
          <div class="eyebrow">Submit</div>
          <h2>Your submissions</h2>
        </div>
        <button class="button" type="button" data-open-submission-modal="new">Add submission</button>
      </div>
      <div class="roster-list">
        ${
          submitState.submissions.length
            ? submitState.submissions.map((submission) => renderSubmissionRow(submission)).join("")
            : `<div class="empty-state">No submissions yet.</div>`
        }
      </div>
    </section>
    ${renderSubmissionModal()}
    ${renderSubmissionChatModal()}
  `;
}

function renderSubmissionRow(submission) {
  const latest = submission.latest?.payload || {};
  const status = submitState.publicState?.submissionStatuses.get(submission.id)?.status || "received";
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(latest.subject || "Untitled submission")}</strong>
          <span>${escapeHtml(latest.location || "No location supplied")}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(status)}</span>
        </div>
      </div>
      <span>${escapeHtml(trimmed(latest.details || "", 180))}</span>
      <div class="button-row button-row--tight">
        <button class="button-ghost" type="button" data-open-submission-modal="${submission.id}">Edit</button>
        <button class="button-ghost" type="button" data-open-submission-chat="${submission.id}">Chat</button>
      </div>
    </article>
  `;
}

function renderSubmissionModal() {
  if (!submitState.formModal) return "";
  const payload = submitState.formModal.payload || {};
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission</div>
            <h2>${submitState.formModal.mode === "edit" ? "Edit submission" : "Add submission"}</h2>
          </div>
          <button class="button-ghost" type="button" data-submit-modal-close>Close</button>
        </div>
        <form class="tip-form" data-submission-form>
          <input name="submissionId" type="hidden" value="${escapeAttribute(submitState.formModal.submissionId || "")}">
          <div class="tip-form__split">
            <label>
              <span>Submission type</span>
              <select name="category">
                ${renderOption("tip", payload.category)}
                ${renderOption("document", payload.category)}
                ${renderOption("subsidy-audit", payload.category)}
                ${renderOption("policing-record", payload.category)}
              </select>
            </label>
            <label>
              <span>Subject</span>
              <input name="subject" type="text" maxlength="140" value="${escapeAttribute(payload.subject || "")}" required>
            </label>
          </div>
          <label>
            <span>Location or agency</span>
            <input name="location" type="text" maxlength="160" value="${escapeAttribute(payload.location || "")}">
          </label>
          <label>
            <span>Details</span>
            <textarea name="details" required>${escapeHtml(payload.details || "")}</textarea>
          </label>
          <label>
            <span>Source links</span>
            <textarea name="sourceLinks">${escapeHtml((payload.source_links || []).join("\n"))}</textarea>
          </label>
          <div class="tip-form__split">
            <label>
              <span>Name</span>
              <input name="name" type="text" maxlength="120" value="${escapeAttribute(payload.contact?.name || "")}">
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" maxlength="160" value="${escapeAttribute(payload.contact?.email || "")}">
            </label>
          </div>
          <div class="tip-form__split">
            <label>
              <span>Preferred contact method</span>
              <input name="contactMethod" type="text" maxlength="120" value="${escapeAttribute(payload.contact?.preferred_method || "")}">
            </label>
            <label>
              <span>Attachment</span>
              <input name="attachment" type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg">
            </label>
          </div>
          <label class="checkbox">
            <input name="consent" type="checkbox" value="yes" ${payload.consent_to_follow_up ? "checked" : ""}>
            <span>The project may follow up if clarification is needed.</span>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Save submission</button>
          </div>
          <div class="status-box" data-submission-status>${payload.attachment?.name ? `Current attachment: ${escapeHtml(payload.attachment.name)}` : "Small attachments are embedded with the encrypted submission revision."}</div>
        </form>
      </section>
    </div>
  `;
}

function renderSubmissionChatModal() {
  if (!submitState.chatModal) return "";
  const submission = submitState.submissions.find((item) => item.id === submitState.chatModal.submissionId);
  const messages = submitState.chatModal.messages || [];
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission chat</div>
            <h2>${escapeHtml(submission?.latest?.payload?.subject || submitState.chatModal.submissionId)}</h2>
          </div>
          <button class="button-ghost" type="button" data-submit-modal-close>Close</button>
        </div>
        <div class="chat-thread">
          ${
            messages.length
              ? messages
                  .map(
                    (message) => `
                      <article class="chat-message ${message.author === submitState.viewer?.pubkey ? "is-self" : ""}">
                        <strong>${message.author === submitState.viewer?.pubkey ? "You" : "Admin"}</strong>
                        <p>${escapeHtml(message.payload.body || "")}</p>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No messages yet.</div>`
          }
        </div>
        <form class="tip-form" data-submission-chat-form>
          <input name="submissionId" type="hidden" value="${escapeAttribute(submitState.chatModal.submissionId)}">
          <label>
            <span>Reply</span>
            <textarea name="body" placeholder="Write a message to admins" required></textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Send message</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function workspaceOpenSubmission(submissionId) {
  if (submissionId === "new") {
    submitState.formModal = {
      mode: "create",
      submissionId: "",
      payload: {}
    };
    renderSubmitPage();
    return;
  }
  const submission = submitState.submissions.find((item) => item.id === submissionId);
  submitState.formModal = {
    mode: "edit",
    submissionId,
    payload: submission?.latest?.payload || {}
  };
  renderSubmitPage();
}

async function handleSubmissionSave(form) {
  const status = form.querySelector("[data-submission-status]");
  try {
    const payload = await buildSubmissionPayload(form, submitState.formModal?.payload || {});
    await publishSubmission(submitState.session.secretKeyHex, payload);
    if (status) {
      status.textContent = "Submission revision published.";
      status.dataset.state = "success";
    }
    submitState.formModal = null;
    await refreshSubmitPage(true);
  } catch (error) {
    if (status) {
      status.textContent = String(error?.message || error || "Submission failed.");
      status.dataset.state = "error";
    }
  }
}

async function hydrateChatModal() {
  if (!submitState.chatModal || !SITE.nostr.inboxPubkey) return;
  submitState.chatModal.messages = await loadSubmissionThread(
    submitState.session.secretKeyHex,
    submitState.chatModal.submissionId,
    SITE.nostr.inboxPubkey
  ).catch(() => []);
  renderSubmitPage();
}

async function handleChatSend(form) {
  const formData = new FormData(form);
  const body = String(formData.get("body") || "").trim();
  if (!body) return;
  await publishSubmissionChat(submitState.session.secretKeyHex, {
    targetPubkey: SITE.nostr.inboxPubkey,
    submissionId: String(formData.get("submissionId") || ""),
    body,
    role: "submitter"
  });
  await hydrateChatModal();
}

async function buildSubmissionPayload(form, existingPayload) {
  const formData = new FormData(form);
  const nextAttachment = await readAttachment(formData.get("attachment"));
  const sourceLinks = String(formData.get("sourceLinks") || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    submission_id: String(formData.get("submissionId") || "").trim() || cleanSubject(String(formData.get("subject") || "")),
    category: String(formData.get("category") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    location: String(formData.get("location") || "").trim(),
    details: String(formData.get("details") || "").trim(),
    source_links: sourceLinks,
    contact: {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      preferred_method: String(formData.get("contactMethod") || "").trim()
    },
    consent_to_follow_up: formData.has("consent"),
    attachment: nextAttachment || existingPayload.attachment || null
  };
}

async function readAttachment(file) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > SITE.nostr.maxAttachmentBytes) {
    throw new Error(`Attachment exceeds ${Math.round(SITE.nostr.maxAttachmentBytes / 1024)} KB.`);
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Attachment could not be read."));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    encoding: "data-url",
    data: dataUrl
  };
}

function cleanSubject(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `submission-${Date.now()}`;
}

function renderOption(value, current) {
  return `<option value="${value}" ${current === value ? "selected" : ""}>${value}</option>`;
}

function trimmed(value, length) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "");
}
