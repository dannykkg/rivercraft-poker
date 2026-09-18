import { expect, test, type Page } from "@playwright/test";
const session = (page: Page) => page.getByRole("region", { name: "当前实战训练" });
const actions = (page: Page) => page.getByRole("group", { name: "实战行动" });
test("abandoning a viewed case cannot turn it back into a first attempt", async ({ page }) => {
  await page.goto("/#learn/practice");
  await page.getByRole("button", { name: "开始前位开池选择", exact: true }).click();
  await expect(session(page)).toContainText("首次局面族");
  await page.getByText("结束当前训练", { exact: true }).click();
  await page.getByRole("button", { name: "确认结束并返回目录", exact: true }).click();
  await page.getByRole("button", { name: "开始前位开池选择", exact: true }).click();
  await expect(session(page)).toContainText("已见局面族");
});
test("post-assessment lab review preserves the independently completed score", async ({ page }) => {
  await page.goto("/#learn/practice");
  await page.getByLabel("反馈模式", { exact: true }).selectOption("assessment");
  await page.getByRole("button", { name: "开始前位开池选择", exact: true }).click();
  await actions(page).getByRole("button", { name: "弃牌", exact: true }).click();
  await expect(page.getByTestId("practice-summary")).toBeVisible();
  await expect(page.getByText("已完成训练 · 1 次首次无提示测验", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "研究这个决策点", exact: true }).click();
  await expect(page.getByRole("heading", { name: "局面实验室", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "学习中心", exact: true }).click();
  await expect(page.getByTestId("practice-summary")).toBeVisible();
  await expect(page.getByText("已完成训练 · 1 次首次无提示测验", { exact: true })).toBeVisible();
});
