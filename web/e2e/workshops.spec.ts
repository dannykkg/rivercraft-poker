import { expect, test, type Page } from "@playwright/test";

const panel = (page: Page) => page.getByRole("region", { name: "范围与频率专项", exact: true });
const settled = (page: Page) => expect(panel(page)).toHaveAttribute("aria-busy", "false");
const open = async (page: Page) => {
  await page.goto("/#learn/practice/skills");
  await expect(page.getByRole("heading", { name: "范围构建与混合频率", exact: true })).toBeVisible();
  await settled(page);
};

test("range matrix stores actual selections and keeps foundation progress untouched", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "开始前位 · 核心范围重建", exact: true }).click();
  const grid = page.getByRole("group", { name: "169格手牌矩阵" });
  await expect(grid.getByRole("button")).toHaveCount(169);
  await expect(page.getByTestId("range-reference")).toHaveCount(0);
  await grid.getByRole("button", { name: "AA", exact: true }).click(); await settled(page);
  await grid.getByRole("button", { name: "72o", exact: true }).click(); await settled(page);
  await page.reload(); await settled(page);
  await expect(grid.getByRole("button", { name: "AA", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(grid.getByRole("button", { name: "72o", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "提交范围", exact: true }).click(); await settled(page);
  await expect(page.getByTestId("range-result")).toContainText("多选：72o");
  await expect(page.getByTestId("range-result")).toContainText("KK");
  await page.screenshot({ path: info.outputPath("range-matrix.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "基础课程", exact: true }).click();
  await expect(page.getByRole("heading", { name: "学习中心", exact: true })).toBeVisible();
  await expect(page.getByText("首次无提示答对 · 不含重复题")).toBeVisible();
});

test("frequency training executes 24 choices, locks the plan and restores without leaking answers", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "开始模型 1 · 弱牌诈唬频率", exact: true }).click();
  await page.getByLabel("计划频率", { exact: true }).fill("50");
  await page.getByRole("button", { name: "保存频率计划", exact: true }).click(); await settled(page);
  for (let i = 0; i < 12; i++) {
    await page.getByRole("group", { name: "混合策略执行" }).getByRole("button", { name: i % 2 ? "下注 50" : "过牌", exact: true }).click(); await settled(page);
  }
  await expect(page.getByTestId("frequency-reference")).toHaveCount(0);
  await expect(page.getByLabel("计划频率", { exact: true })).toBeDisabled();
  await page.reload(); await settled(page);
  await expect(page.getByRole("group", { name: "混合策略执行" })).toContainText("12 / 24");
  for (let i = 12; i < 24; i++) {
    await page.getByRole("group", { name: "混合策略执行" }).getByRole("button", { name: i % 2 ? "下注 50" : "过牌", exact: true }).click(); await settled(page);
  }
  await page.getByRole("button", { name: "完成频率练习", exact: true }).click(); await settled(page);
  await expect(page.getByTestId("frequency-result")).toContainText("数学参考：50.00%");
  await expect(page.getByTestId("frequency-result")).toContainText("实际选择：50.00%");
  await expect(page.getByTestId("frequency-result")).toContainText("不将样本偏差伪造成EV损失");
  await page.screenshot({ path: info.outputPath("frequency-training.png"), fullPage: true });
});

test("aborting keeps exposure and reference use remains separate from independent results", async ({ page }) => {
  await open(page);
  const start = page.getByRole("button", { name: "开始前位 · 核心范围重建", exact: true });
  await start.click(); await settled(page);
  await page.getByRole("button", { name: "查看本专项参考（计为辅助）", exact: true }).click(); await settled(page);
  await expect(page.getByTestId("range-reference")).toBeVisible();
  await page.getByText("结束本次专项", { exact: true }).click();
  await page.getByRole("button", { name: "确认结束专项", exact: true }).click(); await settled(page);
  await start.click(); await settled(page);
  await expect(panel(page)).toContainText("已见专项");
  await expect(page.getByTestId("range-reference")).toHaveCount(0);
  await page.getByRole("button", { name: "提交范围", exact: true }).click(); await settled(page);
  await expect(panel(page)).toContainText("已完成 1 次 · 首次无辅助 0 次");
});

test("stale tabs cannot overwrite newer matrix state", async ({ page, context }) => {
  await open(page); await page.getByRole("button", { name: "开始前位 · 核心范围重建", exact: true }).click(); await settled(page);
  const second = await context.newPage(); await open(second);
  await page.getByRole("button", { name: "AA", exact: true }).click(); await settled(page);
  await second.getByRole("button", { name: "KK", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("另一标签页已修改专项");
  await second.reload(); await settled(second);
  await expect(second.getByRole("button", { name: "AA", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(second.getByRole("button", { name: "KK", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("workshop backup merges safely and does not double-count completed records", async ({ page, browser }, info) => {
  await open(page); await page.getByRole("button", { name: "开始前位 · 核心范围重建", exact: true }).click(); await settled(page);
  await page.getByRole("button", { name: "AA", exact: true }).click(); await settled(page);
  await page.getByRole("button", { name: "提交范围", exact: true }).click(); await settled(page);
  await page.getByText("范围与频率专项备份", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出范围与频率进度", exact: true }).click();
  const path = info.outputPath("range-frequency-backup.json"); await (await download).saveAs(path);
  const fresh = await browser.newContext(); const target = await fresh.newPage();
  await target.goto("http://127.0.0.1:4173/#learn/practice/skills"); await settled(target);
  await target.getByText("范围与频率专项备份", { exact: true }).click();
  for (let repeat = 0; repeat < 2; repeat++) {
    await target.getByLabel("选择范围频率备份", { exact: true }).setInputFiles(path);
    await target.getByRole("button", { name: "确认导入范围频率进度", exact: true }).click(); await settled(target);
    await expect(target.getByTestId("range-result")).toContainText("KK");
    await expect(panel(target)).toContainText("已完成 1 次");
  }
  await fresh.close();
});

test("unvisited range training can open offline from the pre-cached application", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })); });
  await context.setOffline(true);
  await page.goto("/#learn/practice/skills"); await settled(page);
  await page.getByRole("button", { name: "开始前位 · 核心范围重建", exact: true }).click(); await settled(page);
  await expect(page.getByRole("group", { name: "169格手牌矩阵" }).getByRole("button")).toHaveCount(169);
});
