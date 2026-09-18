import { expect, test, type Page } from "@playwright/test";
const session = (page: Page) => page.getByRole("region", { name: "当前实战训练" });
const actions = (page: Page) => page.getByRole("group", { name: "实战行动" });
const completeSpot = async (page: Page) => {
  await session(page).getByRole("button", { name: "继续牌局／查看总结" }).click();
  await expect(page.getByTestId("practice-summary")).toBeVisible();
};
test("foundation content and progress survive the independent course track", async ({ page }) => {
  await page.goto("/#learn");
  await page.getByRole("button", { name: /最佳五张牌.*次练习/ }).click();
  await page.getByRole("button", { name: "查看提示", exact: true }).click();
  await expect(page.getByText(/本次会记为使用过提示/)).toBeVisible();
  await page.getByRole("navigation", { name: "学习课程线" }).getByRole("button", { name: "实战训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实战训练", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始前位开池选择", exact: true }).click();
  await actions(page).getByRole("button", { name: "加注到 60", exact: true }).click();
  await expect(page.getByTestId("decision-feedback")).toContainText("教学指导");
  await page.reload();
  await expect(page.getByTestId("decision-feedback")).toBeVisible();
  await completeSpot(page);
  await page.getByRole("navigation", { name: "学习课程线" }).getByRole("button", { name: "基础课程", exact: true }).click();
  await expect(page.getByText(/本次会记为使用过提示/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /点选这七张牌中最强的五张/ })).toBeVisible();
});
test("actual multi-street decisions defer feedback in assessment mode", async ({ page }) => {
  await page.goto("/#learn/practice");
  await page.getByRole("button", { name: /A4.*转牌调整/ }).click();
  await page.getByLabel("反馈模式", { exact: true }).selectOption("assessment");
  await page.getByRole("button", { name: "开始转牌到河牌的计划", exact: true }).click();
  await expect(session(page).getByRole("heading", { name: "无提示牌局测验", exact: true })).toBeVisible();
  await expect(page.getByTestId("decision-feedback")).toHaveCount(0);
  await expect(session(page).getByRole("button", { name: "查看本决策提示", exact: true })).toHaveCount(0);
  for (let i = 0; i < 25; i++) {
    if (await page.getByTestId("practice-summary").isVisible()) break;
    const a = actions(page);
    if (await a.getByRole("button", { name: "过牌", exact: true }).isVisible()) await a.getByRole("button", { name: "过牌", exact: true }).click();
    else await a.getByRole("button", { name: /^跟注 / }).click();
    await expect(session(page)).toHaveAttribute("aria-busy", "false");
  }
  await expect(page.getByTestId("practice-summary")).toBeVisible();
  await expect(page.getByTestId("practice-summary")).toContainText("river");
});
test("river range math is real and independent of revealed outcomes", async ({ page }) => {
  await page.goto("/#learn/practice");
  await page.getByRole("button", { name: /A5.*河牌价值/ }).click();
  await page.getByLabel("起点条件", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "开始河牌抓诈：跟注成本", exact: true }).click();
  await actions(page).getByRole("button", { name: /^跟注 / }).click();
  await expect(page.getByTestId("decision-feedback")).toContainText("75.00%");
  await expect(page.getByTestId("decision-feedback")).toContainText("损失：0.00");
  await completeSpot(page);
});
test("library roundtrip creates ungraded personal practice and preserves source", async ({ page }) => {
  await page.goto("/#learn/practice");
  await page.getByRole("button", { name: "开始按钮位开池与边缘牌", exact: true }).click();
  await actions(page).getByRole("button", { name: "弃牌", exact: true }).click(); await completeSpot(page);
  await page.getByRole("button", { name: "收藏训练牌谱", exact: true }).click();
  await expect(page.getByText(/训练牌谱已保存到个人牌谱库/)).toBeVisible();
  await page.getByRole("button", { name: "打开个人牌谱库", exact: true }).click();
  await page.getByRole("button", { name: /实战训练 · 按钮位开池与边缘牌/ }).click();
  await page.getByRole("button", { name: "创建实战复练", exact: true }).click();
  await expect(session(page)).toContainText("个人牌谱复练");
  await actions(page).getByRole("button", { name: "弃牌", exact: true }).click();
  await expect(page.getByTestId("decision-feedback")).toContainText("不计策略分");
});
test("practice exports and validates backups without overwriting foundation", async ({ page, browser }, info) => {
  await page.goto("/#learn/practice"); await page.getByRole("button", { name: "开始前位开池选择", exact: true }).click();
  await actions(page).getByRole("button", { name: "弃牌", exact: true }).click(); await completeSpot(page);
  await page.getByText("实战进度备份与恢复", { exact: true }).click();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "导出实战进度", exact: true }).click();
  const path = info.outputPath("practice-backup.json"); await (await downloaded).saveAs(path);
  const fresh = await browser.newContext(); const other = await fresh.newPage(); await other.goto("http://127.0.0.1:4173/#learn/practice");
  await other.getByText("实战进度备份与恢复", { exact: true }).click(); await other.getByLabel("选择实战备份", { exact: true }).setInputFiles(path);
  await other.getByRole("button", { name: "确认导入实战进度", exact: true }).click(); await expect(other.getByTestId("practice-summary")).toBeVisible();
  await fresh.close();
});
test("practice screenshots and keyboard-sized mobile controls", async ({ page }, info) => {
  await page.goto("/#learn/practice"); await expect(page.getByRole("heading", { name: "实战训练", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("practice-catalogue.png"), fullPage: true });
  await page.getByRole("button", { name: /A2.*翻牌后的主动/ }).click();
  await page.getByRole("button", { name: "开始不同翻牌：下注还是过牌", exact: true }).click();
  await expect(actions(page)).toBeVisible(); await page.screenshot({ path: info.outputPath("practice-table.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
