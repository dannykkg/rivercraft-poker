import { test, expect } from "@playwright/test";

const nav = (page: import("@playwright/test").Page, name: string) => page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name, exact: true });

test("learning: six levels, card selection, saved feedback and independent attempts", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#learn");
  await expect(page.getByRole("heading", { name: "学习中心", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "教学层次" }).getByRole("button")).toHaveCount(6);
  await page.getByRole("button", { name: /最佳五张牌.*次练习/ }).click();
  for (const card of ["Kc", "Kh", "Ks", "Ad", "Ac"]) await page.getByRole("button", { name: card, exact: true }).click();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(page.getByText("回答正确", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("回答正确", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.getByRole("button", { name: "可以零张", exact: true }).click();
  await page.getByRole("button", { name: "查看本节总结", exact: true }).click();
  await expect(page.getByText("本节练习完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "无提示重练", exact: true }).click();
  await expect(page.getByText("无提示测验", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看提示", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("learning.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("learning: hint and numerical answers survive refresh without becoming independent credit", async ({ page }) => {
  await page.goto("/#learn");
  await page.getByRole("navigation", { name: "教学层次" }).getByRole("button", { name: /数学与概率/ }).click();
  await page.getByRole("button", { name: /底池赔率.*次练习/ }).click();
  await page.getByRole("button", { name: "查看提示", exact: true }).click();
  await page.reload();
  await expect(page.getByText(/本次会记为使用过提示/)).toBeVisible();
  await page.getByRole("textbox", { name: "你的答案", exact: true }).fill("25");
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(page.getByText("回答正确", { exact: true })).toBeVisible();
  await expect(page.locator(".study-stat strong")).toHaveText("0/0");
});

test("lab/library: save facts, hide future information, branch, annotate and preserve original", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#lab");
  await expect(page.getByRole("heading", { name: "局面实验室", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "研究名称", exact: true }).fill("测试学习牌谱");
  await page.getByRole("button", { name: "保存实验牌谱", exact: true }).click();
  await expect(page.getByText("实验牌谱已保存到个人牌谱库。", { exact: true })).toBeVisible();
  await nav(page, "个人牌谱库").click();
  await page.getByRole("button", { name: /测试学习牌谱.*lab/ }).click();
  await expect(page.getByRole("checkbox", { name: /遮挡后续过程/ })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "决策笔记" })).toHaveCount(0);
  const select = page.getByRole("combobox", { name: "学习者决策点" });
  const values = await select.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  await select.selectOption(values[values.length - 1]);
  await page.getByRole("button", { name: "过牌", exact: true }).click();
  await page.getByRole("textbox", { name: "决策笔记", exact: true }).fill("练习先确定价值下注目标。");
  await page.getByRole("button", { name: "保存决策笔记", exact: true }).click();
  await expect(page.getByText("决策笔记已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重抽未知牌后练习", exact: true }).click();
  await expect(page.getByRole("heading", { name: "局面实验室", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "过牌", exact: true }).click();
  await page.getByRole("button", { name: "保存研究分支", exact: true }).click();
  await expect(page.getByText("研究分支已保存，原牌谱没有改变。", { exact: true })).toBeVisible();
  await nav(page, "个人牌谱库").click();
  await page.getByRole("button", { name: /测试学习牌谱.*lab/ }).click();
  await page.getByRole("checkbox", { name: /遮挡后续过程/ }).uncheck();
  await expect(page.getByRole("heading", { name: "已保存研究分支", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("library.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("analysis: real worker results, input invalidation and exact ICM", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#lab");
  const tools = page.getByRole("region", { name: "分析工具" });
  await tools.getByRole("button", { name: "河牌求解", exact: true }).click();
  await tools.getByRole("button", { name: "运行计算", exact: true }).click();
  await expect(tools.getByText(/平均策略值/)).toBeVisible({ timeout: 30000 });
  await tools.getByLabel("固定下注额", { exact: true }).fill("60");
  await expect(tools.getByText(/平均策略值/)).toHaveCount(0);
  await tools.getByRole("button", { name: "ICM", exact: true }).click();
  await tools.getByRole("button", { name: "运行计算", exact: true }).click();
  await expect(tools.getByText("玩家 1：33.3333 奖励单位", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("lab.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("backup import rejects invalid data before writing and does not overwrite duplicates", async ({ page }) => {
  await page.goto("/#library");
  await page.getByText("备份、旧存档与本地存储", { exact: true }).click();
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "rivercraft-study", version: 99 })) });
  await expect(page.getByRole("alert")).toContainText("不支持的备份版本");
  await expect(page.getByRole("button", { name: "确认导入备份", exact: true })).toHaveCount(0);
  const empty = { format: "rivercraft-study", version: 1, exportedAt: Date.now(), hands: [], notes: [], branches: [], attempts: [], references: [] };
  await input.setInputFiles({ name: "empty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)) });
  await page.getByRole("button", { name: "确认导入备份", exact: true }).click();
  await expect(page.getByText("已新增 0 条资料。", { exact: true })).toBeVisible();
});
