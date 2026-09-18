import { test, expect, type Page } from "@playwright/test";
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name, exact: true });
const snapshot = async (page: Page) => page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
  const request = indexedDB.open("rivercraft-poker");
  request.onsuccess = () => { const db = request.result; const r = db.transaction("game-state").objectStore("game-state").get("current-tournament"); r.onsuccess = () => { db.close(); resolve(r.result); }; r.onerror = () => { db.close(); reject(r.error); }; };
  request.onerror = () => reject(request.error);
}));

test("navigation waits for the paused game save and never runs a hidden table", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("玩家人数").fill("2");
  await page.getByText("真人座位").locator("..").getByRole("combobox").selectOption("0");
  await page.getByRole("button", { name: /开始锦标赛/ }).click();
  await expect(page.locator('[data-presentation="ready"]')).toBeVisible({ timeout: 5000 });
  await nav(page, "学习中心").click();
  await expect(page.getByText(/当前牌局仍在进行。请先在牌桌点击/)).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await nav(page, "学习中心").click();
  await expect(page.getByRole("heading", { name: "学习中心", exact: true })).toBeVisible();
  const saved = await snapshot(page);
  await page.waitForTimeout(1600);
  expect(await snapshot(page)).toEqual(saved);
  await nav(page, "自由对局").click();
  await page.getByRole("button", { name: /继续上次比赛/ }).click();
  await expect(page.getByText("比赛已暂停并自动保存", { exact: true })).toBeVisible();
});

test("controlled question variants retain their exact version across refresh", async ({ page }) => {
  await page.goto("/#learn");
  await page.getByRole("button", { name: /加注与短码全下.*次练习/ }).click();
  await page.getByRole("textbox", { name: "你的答案" }).fill("160");
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.getByRole("button", { name: "不会，应检查合法动作", exact: true }).click();
  await page.getByRole("button", { name: "查看本节总结", exact: true }).click();
  await page.getByRole("button", { name: "练习条件变式", exact: true }).click();
  await expect(page.getByRole("heading", { name: /本轮下注 80，随后完整加注到 200/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /本轮下注 80，随后完整加注到 200/ })).toBeVisible();
  await page.getByRole("textbox", { name: "你的答案" }).fill("320");
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(page.getByText("回答正确", { exact: true })).toBeVisible();
});

test("production precaches unvisited learning chunks and computation workers for offline use", async ({ page, context }) => {
  test.setTimeout(45000);
  await page.goto("/#lab");
  await expect(page.getByRole("heading", { name: "局面实验室", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await nav(page, "学习中心").click();
  await expect(page.getByRole("heading", { name: "学习中心", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /最佳五张牌.*次练习/ }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: /点选这七张牌中最强的五张/ })).toBeVisible();
  await nav(page, "局面实验室").click();
  const tools = page.getByRole("region", { name: "分析工具" });
  await tools.getByRole("button", { name: "ICM", exact: true }).click();
  await tools.getByRole("button", { name: "运行计算", exact: true }).click();
  await expect(tools.getByText("玩家 1：33.3333 奖励单位", { exact: true })).toBeVisible();
});

test("counterfactual worker compares multiple actions and invalidates edited inputs", async ({ page }) => {
  await page.goto("/#lab");
  await page.getByText("同一决策点 · 多次模拟对比", { exact: true }).click();
  await page.getByLabel("模拟样本数", { exact: true }).fill("10");
  await page.getByRole("button", { name: "比较合法候选动作", exact: true }).click();
  await expect(page.getByRole("button", { name: "导出模拟结果", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("cell", { name: "过牌", exact: true })).toBeVisible();
  await page.getByLabel("模拟种子", { exact: true }).fill("43");
  await expect(page.getByRole("button", { name: "导出模拟结果", exact: true })).toHaveCount(0);
});

test("heavy calculations can be cancelled without applying a stale result", async ({ page }) => {
  await page.goto("/#lab");
  const tools = page.getByRole("region", { name: "分析工具" });
  await tools.getByLabel("样本数", { exact: true }).fill("50000");
  await tools.getByRole("button", { name: "运行计算", exact: true }).click();
  await tools.getByRole("button", { name: "取消计算", exact: true }).click();
  await expect(tools.getByRole("button", { name: "运行计算", exact: true })).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(tools.getByText("权益／平均底池份额", { exact: true })).toHaveCount(0);
});
