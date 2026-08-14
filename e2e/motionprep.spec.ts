import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const imageFixture = path.resolve(
  "artifacts/fixtures/alpha-components.png",
);
const pdfFixture = path.resolve("artifacts/fixtures/motionprep-e2e.pdf");
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
    .getByRole("button", { name: "استكشف الاستوديو كضيف" })
    .first()
    .click();
  await page.getByRole("button", { name: "مشروع جديد" }).click();
  await page.getByRole("button", { name: "فتح مساحة العمل" }).click();
  await page.getByRole("button", { name: "اختيار ملف واحد" }).click();
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
    .getByRole("button", { name: "استكشف الاستوديو كضيف" })
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
  const bottomNavigation = page.locator(".mobile-bottom-nav");
  const navigationGeometry = await bottomNavigation.evaluate((navigation) => {
    const rect = navigation.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      position: window.getComputedStyle(navigation).position,
    };
  });
  expect(navigationGeometry.position).toBe("fixed");
  expect(navigationGeometry.top).toBeGreaterThanOrEqual(0);
  expect(navigationGeometry.bottom).toBeLessThanOrEqual(
    navigationGeometry.viewportHeight,
  );
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
    .getByRole("button", { name: "استكشف الاستوديو كضيف" })
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
  await assertCreatorAdminBoundary(page);
  await completeSandboxCheckoutFlow(page);
});

test("processes a PDF through the real book workflow", async ({ page }, testInfo) => {
  await openApplication(page);
  await page.getByRole("button", { name: "استكشف الاستوديو كضيف" }).first().click();
  await openRegistration(page);
  await registerCreatorAccount(
    page,
    `pdf-${testInfo.project.name}-${Date.now()}@example.test`,
  );

  await page.getByRole("button", { name: "مشروع جديد" }).click();
  await page.getByRole("button", { name: /PDF.*فصل النص/u }).click();
  await page.getByRole("button", { name: "فتح مساحة العمل" }).click();
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);
  await expect(page.getByText("جاهز للمراجعة")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".workspace")).toBeVisible();

  if (testInfo.project.name.includes("mobile")) {
    const overlay = page.locator(".pdf-marker-overlay");
    const bounds = await overlay.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 20, bounds!.y + 20);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 120, bounds!.y + 90);
    await page.mouse.up();
  } else {
    const coordinateForm = page.locator(
      ".guidance-coordinate-entry--region",
    );
    const coordinateInputs = coordinateForm.locator('input[type="number"]');
    await coordinateInputs.nth(0).fill("99");
    await coordinateInputs.nth(2).fill("20");
    await coordinateForm.locator('button[type="submit"]').click();
    await expect(coordinateForm.getByRole("alert")).toBeVisible();
    await expect(page.locator('.pdf-marker-overlay [data-region="true"]')).toHaveCount(0);

    await coordinateInputs.nth(0).fill("10");
    await coordinateForm.locator('button[type="submit"]').click();
  }
  await expect(page.locator('.pdf-marker-overlay [data-region="true"]')).toHaveCount(1);

  await page.locator(".workspace-title > button").click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace")).toBeVisible();
  await assertNoSeriousAccessibilityViolations(page);
});

test("exports personal data and requests durable account deletion", async ({
  page,
}, testInfo) => {
  await openApplication(page);
  await page.getByRole("button", { name: "استكشف الاستوديو كضيف" }).first().click();
  await openRegistration(page);
  await registerCreatorAccount(
    page,
    `privacy-${testInfo.project.name}-${Date.now()}@example.test`,
  );
  await page.goto("/?view=settings", { waitUntil: "networkidle" });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /تنزيل النسخة/u }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^motionprep-account-.*\.json$/u);
  expect(await download.failure()).toBeNull();

  await page.getByPlaceholder("كلمة المرور الحالية").fill("Playwright-QA-2026!");
  await page.getByRole("checkbox", { name: "أفهم أن الحذف غير قابل للتراجع" }).check();
  const deletion = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith("/v1/account"),
  );
  await page.getByRole("button", { name: "حذف الحساب نهائيًا" }).click();
  expect((await deletion).status()).toBe(202);
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "حوّل صورة واحدة أو ملف PDF إلى طبقات جاهزة للتحريك.",
    }),
  ).toBeVisible();
});

test("creates an account, processes an image, saves review, and downloads export", async ({
  page,
}, testInfo) => {
  await openApplication(page);
  await page
    .getByRole("button", { name: "استكشف الاستوديو كضيف" })
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
  const workspaceGeometry = await page.locator(".pro-preview-column").evaluate(
    (preview) => {
      const toolbar = preview.querySelector<HTMLElement>(".pro-preview-toolbar");
      const guidance = preview.querySelector<HTMLElement>(".guidance-context");
      const documentElement = document.documentElement;
      return {
        documentOverflow: documentElement.scrollWidth - documentElement.clientWidth,
        previewOverflow: preview.scrollWidth - preview.clientWidth,
        toolbarOverflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 0,
        guidanceOverflow: guidance ? guidance.scrollWidth - guidance.clientWidth : 0,
      };
    },
  );
  expect(workspaceGeometry.documentOverflow).toBeLessThanOrEqual(2);
  expect(workspaceGeometry.previewOverflow).toBeLessThanOrEqual(2);
  expect(workspaceGeometry.toolbarOverflow).toBeLessThanOrEqual(2);
  expect(workspaceGeometry.guidanceOverflow).toBeLessThanOrEqual(2);
  await assertNoSeriousAccessibilityViolations(page);
  const layerCount = page.getByText(/الطبقات 5/u);
  if (!(await layerCount.isVisible())) {
    await page.getByRole("button", { name: /الطبقات/u }).last().click();
    await expect(
      page.getByRole("region", { name: "الطبقات" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "+جزء_05، محددة",
        exact: true,
      }),
    ).toBeVisible();
  } else {
    await expect(layerCount).toBeVisible();
  }

  const layerActions = page.getByRole("button", { name: /إجراءات الطبقة \+جزء_/u }).first();
  const hidLayerInWorkspace = await layerActions.isVisible();
  const navigationSave = hidLayerInWorkspace
    ? page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/layer-document") &&
          response.ok(),
      )
    : null;
  if (hidLayerInWorkspace) {
    await layerActions.click();
    const hideLayer = page.getByRole("button", { name: /إخفاء الطبقة/u });
    await expect(hideLayer).toBeVisible();
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
  await page
    .getByRole("button", { name: "اعتماد المراجعة وإنشاء التصدير" })
    .click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.psd$/u);
  await expect(
    page.getByRole("button", { name: "تم اعتماد المراجعة وإنشاء الملف" }),
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

async function assertCreatorAdminBoundary(page: Page): Promise<void> {
  const response = await page.goto("/?view=admin", {
    waitUntil: "networkidle",
  });
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "لا يملك هذا الدور صلاحية الوصول" }),
  ).toBeVisible();
  await expect(page.getByText("403 / مسار محمي")).toBeVisible();
  await expect(page.locator(".admin-shell")).toHaveCount(0);
  await assertNoSeriousAccessibilityViolations(page);
}

async function completeSandboxCheckoutFlow(page: Page): Promise<void> {
  await page.goto("/?view=billing", { waitUntil: "networkidle" });
  await expect(page.getByText("SANDBOX — لا يوجد تحصيل فعلي")).toBeVisible();
  await page.getByRole("button", { name: "اختيار الخطة" }).first().click();
  await expect(
    page.getByRole("dialog", { name: "تأكيد تغيير الخطة" }),
  ).toBeVisible();

  const createCheckout = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/v1/billing/checkouts") &&
      response.status() === 201,
  );
  const completeCheckout = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/billing/checkouts/") &&
      response.url().endsWith("/complete-sandbox") &&
      response.ok(),
  );
  await page
    .getByRole("button", { name: "المتابعة للدفع المستضاف" })
    .click();
  await createCheckout;
  await completeCheckout;

  await expect(
    page.getByRole("heading", { name: "تم تأكيد حالة الدفع" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/sandbox_checkout|checkout_id|session_id/u);
  await page.getByRole("button", { name: "العودة إلى الفوترة" }).click();
  await expect(page.locator(".current-plan h2")).toHaveText("صانع محتوى");
  await assertNoSeriousAccessibilityViolations(page);
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
