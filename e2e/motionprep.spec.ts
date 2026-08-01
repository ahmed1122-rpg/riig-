import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const imageFixture = path.resolve(
  "artifacts/fixtures/alpha-components.png",
);
const diagnostics = new Map<string, string[]>();

test.beforeEach(async ({ page }, testInfo) => {
  const events: string[] = [];
  diagnostics.set(testInfo.testId, events);
  page.on("pageerror", (error) => {
    events.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      events.push(`console.error: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    events.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });
});

test.afterEach(async ({ page: _page }, testInfo) => {
  const events = diagnostics.get(testInfo.testId) ?? [];
  diagnostics.delete(testInfo.testId);
  if (events.length === 0) return;
  await testInfo.attach("browser-diagnostics", {
    body: Buffer.from(events.join("\n"), "utf8"),
    contentType: "text/plain",
  });
});

test("public entry and guest authentication boundary are accessible", async ({
  page,
}) => {
  await openApplication(page);
  await expect(
    page.getByRole("heading", {
      name: "حوّل صورة واحدة أو ملف PDF إلى طبقات جاهزة للتحريك.",
    }),
  ).toBeVisible();
  await assertNoSeriousAccessibilityViolations(page);

  await page
    .getByRole("button", { name: "فتح الاستوديو كضيف" })
    .first()
    .click();
  await page.getByRole("button", { name: "مشروع جديد" }).click();
  await page.getByRole("button", { name: "فتح مساحة العمل" }).click();
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles(imageFixture);
  await expect(
    page.getByRole("heading", { name: "مرحبًا بعودتك" }),
  ).toBeVisible();
  await assertNoSeriousAccessibilityViolations(page);
});

test("keyboard dismisses the project dialog and mobile drawer", async ({
  page,
}, testInfo) => {
  await openApplication(page);
  await page
    .getByRole("button", { name: "فتح الاستوديو كضيف" })
    .first()
    .click();

  await expect(page.getByLabel("حالة بيانات العرض")).toHaveCount(0);
  const projectTrigger = page.getByRole("button", { name: "مشروع جديد" });
  await projectTrigger.click();
  await expect(page.getByRole("dialog", { name: "مشروع جديد" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "مشروع جديد" })).toHaveCount(0);
  await expect(projectTrigger).toBeFocused();

  if (!testInfo.project.name.includes("mobile")) return;
  const menuTrigger = page.locator(".mobile-menu");
  await menuTrigger.click();
  await expect(menuTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "التنقل الرئيسي" })).toBeVisible();
  await expect(page.locator(".app-main")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "التنقل الرئيسي" })).toHaveCount(0);
  await expect(menuTrigger).toBeFocused();
});

test("authenticated pages render without serious accessibility regressions", async ({
  page,
}, testInfo) => {
  await openApplication(page);
  await page
    .getByRole("button", { name: "فتح الاستوديو كضيف" })
    .first()
    .click();
  await openRegistration(page);
  await registerCreatorAccount(
    page,
    `pages-${testInfo.project.name}-${Date.now()}@example.test`,
  );

  for (const view of [
    "dashboard",
    "projects",
    "exports",
    "billing",
    "settings",
    "help",
  ]) {
    const response = await page.goto(`/?view=${view}`, {
      waitUntil: "networkidle",
    });
    expect(response?.ok()).toBe(true);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.locator(".app-main")).toBeVisible();
    await assertNoSeriousAccessibilityViolations(page);
  }
});

test("creates an account, processes an image, saves review, and downloads export", async ({
  page,
}, testInfo) => {
  await openApplication(page);
  await page
    .getByRole("button", { name: "فتح الاستوديو كضيف" })
    .first()
    .click();
  await openRegistration(page);

  const email = `playwright-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.getByRole("textbox", { name: "الاسم" }).fill("Playwright QA");
  await page
    .getByRole("textbox", { name: "البريد الإلكتروني" })
    .fill(email);
  await page
    .getByRole("textbox", { name: /كلمة المرور/u })
    .fill("Playwright-QA-2026!");
  await page
    .getByRole("checkbox", {
      name: "أوافق على شروط الاستخدام وسياسة الخصوصية.",
    })
    .check();
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  await page.getByRole("button", { name: "مشروع جديد" }).click();
  await page.getByRole("button", { name: "فتح مساحة العمل" }).click();
  await page.locator('input[type="file"]').setInputFiles(imageFixture);
  await expect(page.getByText("جاهز للمراجعة")).toBeVisible({
    timeout: 30_000,
  });
  await assertNoSeriousAccessibilityViolations(page);
  const layerCount = page.getByText(/الطبقات 5/u);
  if (!(await layerCount.isVisible())) {
    await page.getByRole("button", { name: /الطبقات/u }).last().click();
    await expect(
      page.getByRole("region", { name: "الطبقات" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+جزء_05", exact: true }),
    ).toBeVisible();
  } else {
    await expect(layerCount).toBeVisible();
  }

  const hideLayer = page.getByRole("button", { name: /إخفاء \+جزء_/u }).first();
  const hidLayerInWorkspace = await hideLayer.isVisible();
  const navigationSave = hidLayerInWorkspace
    ? page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/layer-document") &&
          response.ok(),
      )
    : null;
  if (hidLayerInWorkspace) {
    await hideLayer.click();
    if (testInfo.project.name.includes("mobile")) {
      await page.locator(".mobile-menu").click();
    }
    await page.locator(".nav-list .nav-item").nth(1).click();
    await navigationSave;
    await expect(page).toHaveURL(/view=projects/u);
    await page.goBack();
    await expect(page.locator(".workspace")).toBeVisible();
  }
  const review = page.getByRole("button", { name: "مراجعة وتصدير" });
  if (await review.isVisible()) {
    await review.click();
  } else {
    await page.getByRole("button", { name: "تصدير" }).last().click();
  }
  await expect(
    page.getByRole("heading", { name: "المراجعة النهائية" }),
  ).toBeVisible();
  await assertNoSeriousAccessibilityViolations(page);
  if (!hidLayerInWorkspace) {
    await page
      .getByRole("button", { name: "ظاهرة", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "مخفية", exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "دمج" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "فصل" })).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "إنشاء ملف التصدير" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.psd$/u);
  await expect(
    page.getByRole("button", { name: "تم إنشاء الملف" }),
  ).toBeVisible();
});

async function assertNoSeriousAccessibilityViolations(
  page: Page,
): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
}

async function openApplication(page: Page): Promise<void> {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
}

async function openRegistration(page: Page): Promise<void> {
  const signIn = page.getByRole("button", { name: "تسجيل الدخول" }).first();
  if (!(await signIn.isVisible())) {
    await page.getByRole("button", { name: "فتح القائمة" }).click();
  }
  await signIn.click();
  await page.getByRole("button", { name: "إنشاء حساب" }).click();
}

async function registerCreatorAccount(
  page: Page,
  email: string,
): Promise<void> {
  await page.getByRole("textbox", { name: "الاسم" }).fill("Playwright QA");
  await page
    .getByRole("textbox", { name: "البريد الإلكتروني" })
    .fill(email);
  await page
    .getByRole("textbox", { name: /كلمة المرور/u })
    .fill("Playwright-QA-2026!");
  await page
    .getByRole("checkbox", {
      name: "أوافق على شروط الاستخدام وسياسة الخصوصية.",
    })
    .check();
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page.locator(".app-main")).toBeVisible();
}
