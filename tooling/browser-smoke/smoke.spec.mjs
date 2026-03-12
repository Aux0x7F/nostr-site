import { expect, test } from "@playwright/test";

const adminUser = requiredEnv("SMOKE_ADMIN_USERNAME");
const adminPass = requiredEnv("SMOKE_ADMIN_PASSWORD");
const submitterUser = requiredEnv("SMOKE_USER_USERNAME");
const submitterPass = requiredEnv("SMOKE_USER_PASSWORD");
const runId = `${Date.now()}`;
const entityName = `Smoke Entity ${runId}`;
const subjectLine = `Smoke Submission ${runId}`;
const followUpSubjectLine = `Smoke Submission After Revoke ${runId}`;
const commentText = `Smoke comment ${runId}`;

test("anonymous users see login gates", async ({ page }) => {
  await page.goto("/submit.html");
  await expect(page.getByText("Log in required")).toBeVisible();

  const postUrl = await openFirstPost(page);
  await page.goto(postUrl);
  await expect(page.getByText("Log in to join the discussion.")).toBeVisible();
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
  await expect(submissionCard).toBeVisible();
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
  await expect(row.getByText("approved")).toBeVisible();
  await row.getByRole("button", { name: "Chat" }).click();
  await expect(submitterReviewPage.getByText(`Admin reply ${runId}`)).toBeVisible();

  const postUrl = await openFirstPost(submitterReviewPage);
  await submitterReviewPage.goto(postUrl);
  await submitterReviewPage.locator("[data-comment-form] textarea[name=\"markdown\"]").fill(commentText);
  await submitterReviewPage.locator("[data-comment-form]").getByRole("button", { name: "Post comment" }).click();
  await expect(submitterReviewPage.getByText(commentText)).toBeVisible();
  await submitterReviewPage.close();

  const adminCommentPage = await browser.newPage({ baseURL });
  await login(adminCommentPage, adminUser, adminPass);
  await adminCommentPage.goto("/admin.html?tab=comments");
  const commentCard = adminCommentPage.locator(".roster-item", { hasText: commentText }).first();
  await expect(commentCard).toBeVisible();
  await commentCard.getByRole("button", { name: "Hide" }).click();
  const updatedCommentCard = adminCommentPage.locator(".roster-item", { hasText: commentText }).first();
  await expect(updatedCommentCard).toContainText("hidden");
  await expect(updatedCommentCard.getByRole("button", { name: "Restore" })).toBeVisible();
  await adminCommentPage.close();

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
  await temporaryAdminPage.close();

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
  await expect(followUpCard).toBeVisible();
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

async function openFirstPost(page) {
  await page.goto("/investigations.html");
  const link = page.locator('a[href*="slug="]').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("No post link found on investigations page.");
  return href;
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
