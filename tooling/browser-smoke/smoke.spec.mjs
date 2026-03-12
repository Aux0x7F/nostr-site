import { expect, test } from "@playwright/test";

const adminUser = requiredEnv("SMOKE_ADMIN_USERNAME");
const adminPass = requiredEnv("SMOKE_ADMIN_PASSWORD");
const submitterUser = requiredEnv("SMOKE_USER_USERNAME");
const submitterPass = requiredEnv("SMOKE_USER_PASSWORD");
const runId = `${Date.now()}`;
const entityName = `Smoke Entity ${runId}`;
const subjectLine = `Smoke Submission ${runId}`;
const commentText = `Smoke comment ${runId}`;

test("anonymous users see login gates", async ({ page }) => {
  await page.goto("/submit.html");
  await expect(page.getByText("Log in required")).toBeVisible();

  const postUrl = await openFirstPost(page);
  await page.goto(postUrl);
  await expect(page.getByText("Log in to join the discussion.")).toBeVisible();
});

test("admin and submitter flows round-trip", async ({ browser, baseURL }) => {
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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env ${name}.`);
  }
  return value;
}
