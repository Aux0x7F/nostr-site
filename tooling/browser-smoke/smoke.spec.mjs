import { expect, test } from "@playwright/test";

const adminUser = requiredEnv("SMOKE_ADMIN_USERNAME");
const adminPass = requiredEnv("SMOKE_ADMIN_PASSWORD");
const submitterUser = requiredEnv("SMOKE_USER_USERNAME");
const submitterPass = requiredEnv("SMOKE_USER_PASSWORD");
const runId = `${Date.now()}`;
const delegateUser = `delegate-${runId}`;
const delegatePass = `delegate-${runId}`;
const entityName = `Smoke Entity ${runId}`;
const subjectLine = `Smoke Submission ${runId}`;
const followUpSubjectLine = `Smoke Submission After Revoke ${runId}`;
const commentText = `Smoke comment ${runId}`;
const replyText = `Smoke reply ${runId}`;

test("anonymous users see login gates", async ({ page }) => {
  await page.goto("/submit.html");
  await expect(page.getByText("Log in required")).toBeVisible();

  const postUrl = await openFirstPost(page);
  await page.goto(postUrl);
  await expect(page.getByText("Log in to comment or reply.")).toBeVisible();
});

test("admin and submitter flows round-trip", async ({ browser, baseURL }) => {
  test.setTimeout(180000);
  const adminPage = await browser.newPage({ baseURL });
  await login(adminPage, adminUser, adminPass);
  await adminPage.goto("/admin.html?tab=entities");
  await adminPage.getByRole("button", { name: "Add entity" }).click();
  await adminPage.locator('[data-entity-form] input[name="name"]').fill(entityName);
  await adminPage.locator('[data-entity-form] input[name="location"]').fill("Phoenix, Arizona");
  await adminPage.locator('[data-entity-form] input[name="type"]').fill("demo target");
  await adminPage.locator('[data-entity-form] textarea[name="notes"]').fill("Smoke-test entity note.");
  await adminPage.locator('[data-entity-form]').getByRole("button", { name: "Publish entity" }).click();
  await expect(adminPage.getByText(entityName)).toBeVisible();
  await adminPage.close();

  const submitterPage = await browser.newPage({ baseURL });
  await login(submitterPage, submitterUser, submitterPass);
  await submitterPage.goto("/submit.html");
  await submitterPage.getByRole("button", { name: "Add submission" }).click();
  await submitterPage.locator('[data-submission-form] input[name="subject"]').fill(subjectLine);
  await submitterPage.locator('[data-submission-form] input[name="location"]').fill("Phoenix, Arizona");
  await submitterPage.locator('[data-submission-form] input[name="entityRefs"]').fill(entityName);
  await submitterPage.locator('[data-submission-form] textarea[name="details"]').fill("Smoke-test submission details.");
  await submitterPage.locator('[data-submission-form]').getByRole("button", { name: "Save submission" }).click();
  await expect(submitterPage.getByText(subjectLine)).toBeVisible();
  await submitterPage.close();

  const adminReviewPage = await browser.newPage({ baseURL });
  await login(adminReviewPage, adminUser, adminPass);
  await adminReviewPage.goto("/admin.html?tab=submissions");
  const submissionCard = adminReviewPage.locator(".roster-item", { hasText: subjectLine }).first();
  await expect(submissionCard).toBeVisible({ timeout: 45000 });
  await submissionCard.getByRole("button", { name: "Approve" }).click();
  await expect(submissionCard.getByText("approved")).toBeVisible();
  await submissionCard.getByRole("button", { name: "Chat" }).click();
  await adminReviewPage.locator('[data-chat-form] textarea[name="body"]').fill(`Admin reply ${runId}`);
  await adminReviewPage.locator('[data-chat-form]').getByRole("button", { name: "Send message" }).click();
  await expect(adminReviewPage.getByText(`Admin reply ${runId}`)).toBeVisible();
  await adminReviewPage.close();

  const submitterReviewPage = await browser.newPage({ baseURL });
  await login(submitterReviewPage, submitterUser, submitterPass);
  await submitterReviewPage.goto("/submit.html");
  const row = submitterReviewPage.locator(".roster-item", { hasText: subjectLine }).first();
  await expect(row.getByText("approved")).toBeVisible({ timeout: 45000 });
  await row.getByRole("button", { name: "Chat" }).click();
  await expect(submitterReviewPage.getByText(`Admin reply ${runId}`)).toBeVisible({ timeout: 45000 });

  const postUrl = await openFirstPost(submitterReviewPage);
  await submitterReviewPage.goto(postUrl);
  await submitterReviewPage.locator("[data-comment-form] textarea[name=\"markdown\"]").fill(commentText);
  await submitterReviewPage.locator("[data-comment-form]").getByRole("button", { name: "Post comment" }).click();
  await expect(submitterReviewPage.getByText(commentText)).toBeVisible();
  await submitterReviewPage.close();

  const adminReplyPage = await browser.newPage({ baseURL });
  await login(adminReplyPage, adminUser, adminPass);
  await adminReplyPage.goto(postUrl);
  const publicCommentCard = adminReplyPage.locator(".comment-card", { hasText: commentText }).first();
  await expect(publicCommentCard).toBeVisible();
  await publicCommentCard.getByRole("button", { name: "Reply" }).click();
  await adminReplyPage.locator("[data-comment-form] textarea[name=\"markdown\"]").fill(replyText);
  await adminReplyPage.locator("[data-comment-form]").getByRole("button", { name: "Reply" }).click();
  await expect(adminReplyPage.getByText(replyText)).toBeVisible();
  await adminReplyPage.close();

  const adminCommentPage = await browser.newPage({ baseURL });
  await login(adminCommentPage, adminUser, adminPass);
  await adminCommentPage.goto("/admin.html?tab=comments");
  const commentCard = adminCommentPage.locator(".roster-item", { hasText: commentText }).first();
  await expect(commentCard).toBeVisible({ timeout: 45000 });
  await commentCard.getByRole("button", { name: "Hide" }).click();
  const updatedCommentCard = adminCommentPage.locator(".roster-item", { hasText: commentText }).first();
  await expect(updatedCommentCard).toContainText("hidden");
  await expect(updatedCommentCard.getByRole("button", { name: "Restore" })).toBeVisible();
  await adminCommentPage.close();

  await createUserAccount(browser, baseURL, delegateUser, delegatePass);

  const adminUsersPage = await browser.newPage({ baseURL });
  await login(adminUsersPage, adminUser, adminPass);
  await adminUsersPage.goto("/admin.html?tab=users");
  await ensureAdminState(adminUsersPage, submitterUser, true);
  await adminUsersPage.close();

  const temporaryAdminPage = await browser.newPage({ baseURL });
  await login(temporaryAdminPage, submitterUser, submitterPass);
  await temporaryAdminPage.goto("/admin.html?tab=dashboard");
  await expect(temporaryAdminPage.locator("[data-workspace-title]")).toContainText("Workspace");
  await expect(temporaryAdminPage.getByRole("button", { name: "Dashboard" })).toBeVisible();
  await temporaryAdminPage.getByRole("button", { name: "Comments" }).click();
  await expect(temporaryAdminPage.getByText("Your comments")).toBeVisible();
  await temporaryAdminPage.getByRole("button", { name: "Profile" }).click();
  await expect(temporaryAdminPage.getByText("Profile settings")).toBeVisible();
  await temporaryAdminPage.goto("/admin.html?tab=users");
  await ensureAdminState(temporaryAdminPage, delegateUser, true);
  await temporaryAdminPage.close();

  const delegateAdminPage = await browser.newPage({ baseURL });
  await login(delegateAdminPage, delegateUser, delegatePass);
  await delegateAdminPage.goto("/admin.html?tab=dashboard");
  await expect(delegateAdminPage.locator("[data-workspace-title]")).toContainText("Workspace");
  await expect(delegateAdminPage.getByRole("button", { name: "Dashboard" })).toBeVisible();
  await delegateAdminPage.goto("/admin.html?tab=submissions");
  await expect(delegateAdminPage.getByText("Shared inbox")).toBeVisible();
  await delegateAdminPage.close();

  const adminRevokePage = await browser.newPage({ baseURL });
  await login(adminRevokePage, adminUser, adminPass);
  await adminRevokePage.goto("/admin.html?tab=users");
  await ensureAdminState(adminRevokePage, submitterUser, false);
  await adminRevokePage.goto("/admin.html?tab=log");
  await expect(adminRevokePage.getByText("Site key rotation")).toBeVisible();
  await adminRevokePage.close();

  const revokedUserPage = await browser.newPage({ baseURL });
  await login(revokedUserPage, submitterUser, submitterPass);
  await revokedUserPage.goto("/admin.html");
  await expect(revokedUserPage.locator("[data-workspace-title]")).toContainText("Profile options");
  await expect(revokedUserPage.getByRole("button", { name: "Dashboard" })).toHaveCount(0);
  await revokedUserPage.close();

  const delegateAfterRevokePage = await browser.newPage({ baseURL });
  await login(delegateAfterRevokePage, delegateUser, delegatePass);
  await delegateAfterRevokePage.goto("/admin.html?tab=submissions");
  await expect(delegateAfterRevokePage.getByText("Shared inbox")).toBeVisible();
  await expect(delegateAfterRevokePage.getByText(subjectLine)).toBeVisible();
  await delegateAfterRevokePage.close();

  const submitterAfterRevokePage = await browser.newPage({ baseURL });
  await login(submitterAfterRevokePage, submitterUser, submitterPass);
  await submitterAfterRevokePage.goto("/submit.html");
  await submitterAfterRevokePage.getByRole("button", { name: "Add submission" }).click();
  await submitterAfterRevokePage.locator('[data-submission-form] input[name="subject"]').fill(followUpSubjectLine);
  await submitterAfterRevokePage.locator('[data-submission-form] input[name="location"]').fill("Phoenix, Arizona");
  await submitterAfterRevokePage.locator('[data-submission-form] input[name="entityRefs"]').fill(entityName);
  await submitterAfterRevokePage.locator('[data-submission-form] textarea[name="details"]').fill("Smoke-test follow-up details after revoke.");
  await submitterAfterRevokePage.locator('[data-submission-form]').getByRole("button", { name: "Save submission" }).click();
  await expect(submitterAfterRevokePage.getByText(followUpSubjectLine)).toBeVisible();
  await submitterAfterRevokePage.close();

  const adminFinalReviewPage = await browser.newPage({ baseURL });
  await login(adminFinalReviewPage, adminUser, adminPass);
  await adminFinalReviewPage.goto("/admin.html?tab=submissions");
  const followUpCard = adminFinalReviewPage.locator(".roster-item", { hasText: followUpSubjectLine }).first();
  await expect(followUpCard).toBeVisible({ timeout: 45000 });
  await followUpCard.getByRole("button", { name: "Approve" }).click();
  await expect(followUpCard.getByText("approved")).toBeVisible();
  await adminFinalReviewPage.close();
});

async function login(page, username, password) {
  await page.goto("/admin.html?tab=login");
  await page.locator('[data-login-form] input[name="username"]').fill(username);
  await page.locator('[data-login-form] input[name="password"]').fill(password);
  await page.locator('[data-login-form]').getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("[data-workspace-title]")).toContainText(/Workspace|Profile options/);
}

async function createUserAccount(browser, baseURL, username, password) {
  const page = await browser.newPage({ baseURL });
  await login(page, username, password);
  await page.close();
}

async function openFirstPost(page) {
  for (const path of ["/investigations.html", "/blog.html"]) {
    await page.goto(path);
    const link = page.locator('a[href*="slug="]').first();
    try {
      await link.waitFor({ state: "visible", timeout: 10000 });
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      if (href) return href;
    } catch {
      continue;
    }
  }
  throw new Error("No post link found on blog index.");
}

async function ensureAdminState(page, username, shouldBeAdmin) {
  const userCard = page.locator(".roster-item", { hasText: username }).first();
  await expect(userCard).toBeVisible();
  const makeAdminButton = userCard.getByRole("button", { name: "Make admin" });
  const removeAdminButton = userCard.getByRole("button", { name: "Remove admin" });
  if (shouldBeAdmin) {
    if (await makeAdminButton.count()) {
      await makeAdminButton.click();
    }
    await expect(userCard.getByText("admin")).toBeVisible();
    return;
  }
  if (await removeAdminButton.count()) {
    await removeAdminButton.click();
  }
  await expect(userCard.getByRole("button", { name: "Make admin" })).toBeVisible();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env ${name}.`);
  }
  return value;
}
