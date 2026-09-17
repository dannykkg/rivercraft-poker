import { expect, test, type Page } from "@playwright/test";

const resetStorage = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("rivercraft-poker");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
};

const startHeadsUp = async (page: Page) => {
  await page.getByLabel("玩家人数").fill("2");
  await page.getByText("真人座位").locator("..").getByRole("combobox").selectOption("0");
  await page.getByRole("button", { name: /开始锦标赛/ }).click();
  await expect(page.getByText("第 1 手牌")).toBeVisible();
  await expect(page.locator('[data-presentation="hole-cards"]')).toBeVisible();
  await expect(page.locator('[data-presentation="ready"]')).toBeVisible({ timeout: 5_000 });
};

test.beforeEach(async ({ page }) => resetStorage(page));

test("creates a heads-up tournament and accepts a legal human action", async ({ page }) => {
  await startHeadsUp(page);
  await expect(page.locator("[data-action-timer]")).toContainText("30");
  await expect(page.locator("[data-table-seat]")).toHaveCount(9);
  await expect(page.getByText("BTN · SB", { exact: true })).toBeVisible();
  await expect(page.getByText("BB", { exact: true })).toBeVisible();
  await expect(page.locator('[data-player-id="hero"]')).toHaveAttribute("data-seat-state", "current");
  const call = page.getByRole("button", { name: /^跟注/ });
  await expect(call).toBeVisible();
  await call.click();
  await expect(page.locator('[data-player-id="hero"]')).toContainText("跟注");
  await expect(page.getByText("最近行动").locator("..")).toContainText("跟注");
});

test("automatically advances to the next hand after settlement", async ({ page }) => {
  await startHeadsUp(page);
  await expect(page.getByRole("switch", { name: "自动下一手" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "弃牌" }).click();
  await expect(page.locator('[data-player-id="hero"]')).toHaveAttribute("data-seat-state", "folded");
  await expect(page.locator('[data-player-id="hero"]')).toContainText("已弃牌");
  const settlement = page.getByRole("status", { name: "本手结算" });
  await expect(settlement).toBeVisible();
  await expect(page.locator('[data-winner-hand="bot-1"]')).toContainText("Nova · 赢得底池");
  await expect(page.locator('[data-player-result="bot-1"]')).toHaveText("净赢 +10");
  await expect(page.locator('[data-player-result="hero"]')).toHaveText("净输 −10");
  await expect(page.locator('[data-player-id="bot-1"]')).toHaveAttribute("data-seat-state", "winner");
  await expect(page.getByText("第 2 手牌")).toBeVisible({ timeout: 11_000 });
});

test("toggles table sounds and remembers the preference", async ({ page }) => {
  await startHeadsUp(page);
  const soundToggle = page.getByRole("switch", { name: "牌桌语音和音效" });
  await expect(soundToggle).toHaveAttribute("aria-checked", "true");
  await soundToggle.click();
  await expect(soundToggle).toHaveAttribute("aria-checked", "false");
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole("button", { name: /继续上次比赛/ }).click();
  await expect(page.getByRole("switch", { name: "牌桌语音和音效" })).toHaveAttribute("aria-checked", "false");
});

test("pauses, persists, reloads and resumes the exact tournament", async ({ page }) => {
  await startHeadsUp(page);
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByText("比赛已暂停并自动保存")).toBeVisible();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole("button", { name: /继续上次比赛/ }).click();
  await expect(page.getByText("比赛已暂停并自动保存")).toBeVisible();
  await page.getByRole("button", { name: "继续比赛" }).click();
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
});

test("opens the event replay and player statistics", async ({ page }) => {
  await startHeadsUp(page);
  await page.getByRole("button", { name: "牌局记录" }).click();
  await expect(page.getByRole("dialog", { name: "牌局记录" })).toBeVisible();
  await expect(page.getByText("基础回放")).toBeVisible();
  await expect(page.getByText("VPIP")).toBeVisible();
});

test("loads the saved tournament while fully offline", async ({ page, context }) => {
  await startHeadsUp(page);
  await page.getByRole("button", { name: "暂停" }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: /继续上次比赛/ })).toBeVisible();
  await page.getByRole("button", { name: /继续上次比赛/ }).click();
  await expect(page.getByText("比赛已暂停并自动保存")).toBeVisible();
});

test("remembers setup choices and calculates equity in a worker", async ({ page }) => {
  await page.getByLabel("玩家人数").fill("4");
  await page.getByText("初始筹码").locator("..").getByRole("combobox").selectOption("3000");
  await page.getByRole("button", { name: /Mio 2/ }).click();
  await page.reload();
  await expect(page.getByLabel("玩家人数")).toHaveValue("4");
  await expect(page.getByText("初始筹码").locator("..").getByRole("combobox")).toHaveValue("3000");
  await expect(page.getByRole("button", { name: /Mio 2/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("玩家人数").fill("2");
  await page.getByText("真人座位").locator("..").getByRole("combobox").selectOption("0");
  await page.getByRole("button", { name: /开始锦标赛/ }).click();
  await expect(page.getByText("获胜").locator("..")).toContainText("%", { timeout: 10_000 });
  await expect(page.locator("[data-action-advice]")).toContainText("建议", { timeout: 10_000 });
});
