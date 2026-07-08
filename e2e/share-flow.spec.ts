/**
 * The headline flow, end to end against a real browser + local Supabase:
 * client-side encrypt → upload → gate → client-side decrypt, plus the
 * server-enforced promises around it (burn-after-read, retry without a
 * double burn, post-create top-up). This is the regression guard the app
 * lacked — every prior verification was manual.
 */
import { expect, test } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

async function sealMessage(
  page: import("@playwright/test").Page,
  secret: string,
  opts: { views?: string; password?: string } = {},
): Promise<{ shareUrl: string; manageUrl: string }> {
  await page.goto("/");
  await page.getByPlaceholder("Write the message to seal…").fill(secret);
  if (opts.views) await page.getByLabel(/View limit/).selectOption(opts.views);
  if (opts.password) await page.locator('input[type="password"]').fill(opts.password);
  await page.getByRole("button", { name: /Seal & create link/ }).click();

  const shareUrl = (await page
    .locator("code", { hasText: "/s/" })
    .first()
    .textContent()) as string;
  const manageUrl = (await page
    .locator("code", { hasText: "/manage/" })
    .first()
    .textContent()) as string;
  expect(shareUrl).toContain("/s/");
  expect(shareUrl).toContain("#"); // the link key rides in the fragment
  expect(manageUrl).toContain("/manage/");
  return { shareUrl, manageUrl };
}

test("quick share round-trips without a password", async ({ page }) => {
  const secret = `quick share ${Date.now()}`;
  const { shareUrl } = await sealMessage(page, secret);

  await page.goto(shareUrl);
  await page.getByRole("button", { name: "Decrypt & open" }).click();
  await expect(page.getByText(secret)).toBeVisible();
  await expect(page.getByText("decrypted locally")).toBeVisible();
});

test("burn-after-read lifecycle: wrong-password retry, burn, top-up revival", async ({
  page,
}) => {
  const secret = `sealed at ${Date.now()}`;
  const { shareUrl, manageUrl } = await sealMessage(page, secret, {
    views: "1",
    password: PASSWORD,
  });

  // Open the share: a wrong password consumes the single view (the server
  // released the ciphertext) but decryption fails locally…
  await page.goto(shareUrl);
  await page.locator('input[type="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Decrypt & open" }).click();
  await expect(page.getByText(/Decryption failed — wrong password/)).toBeVisible();

  // …and retrying with the right password must NOT need a second view.
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Decrypt & open" }).click();
  await expect(page.getByText(secret)).toBeVisible();
  await expect(page.getByText(/burned — this link will not open again/)).toBeVisible();

  // A fresh visit finds the share exhausted. goto() to the SAME url (only the
  // fragment differs from the address bar's) is a same-document navigation
  // that would keep the decrypted SPA state — reload to actually re-enter.
  await page.goto(shareUrl);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No views remain." })).toBeVisible();

  // Manage page: the audit ledger shows the consumed view, then a top-up
  // (PATCH edit) revives the burned share without re-encrypting anything.
  await page.goto(manageUrl);
  await expect(page.getByRole("heading", { name: "Your share" })).toBeVisible();
  await expect(page.getByText("exhausted")).toBeVisible();
  await page.getByLabel("Add views").fill("2");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("dd").filter({ hasText: /^2$/ })).toBeVisible();
  // The edit itself lands in the audit trail.
  await expect(page.getByRole("cell", { name: /edit/ })).toBeVisible();

  // The revived link opens again.
  await page.goto(shareUrl);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Decrypt & open" }).click();
  await expect(page.getByText(secret)).toBeVisible();

  // Extend expiry from the manage page and confirm the strip updates.
  await page.goto(manageUrl);
  await page.getByLabel(/Extend expiry/).selectOption("30d");
  await page.getByRole("button", { name: "Extend", exact: true }).click();
  await expect(page.getByText(/in 30 days|in a month/)).toBeVisible();

  // Finally: revoke forever, and the link goes dark.
  await page.getByRole("button", { name: "Revoke…" }).click();
  await page.getByRole("button", { name: "Yes, revoke forever" }).click();
  await expect(page.getByRole("heading", { name: "Revoked." })).toBeVisible();
  await page.goto(shareUrl);
  await expect(page.getByRole("heading", { name: "Nothing here." })).toBeVisible();
});
