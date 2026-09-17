# Rivercraft Poker

Rivercraft 是一个无需账号、可离线运行的传统无限注德州扑克游戏，支持单桌锦标赛与固定盲注现金桌。项目采用自研 TypeScript 规则引擎，并通过内部适配器使用成熟的 `pokersolver` 牌型计算实现。

- 在线体验：https://dannykkg.github.io/rivercraft-poker/
- GitHub 仓库：https://github.com/dannykkg/rivercraft-poker

## 当前功能

- 2–9 人单桌锦标赛或现金桌，1 名真人与算法机器人对战
- 现金桌支持固定盲注、40/100/200BB 买入、用户重新买入、机器人自动补码、主动离桌与会话盈亏/BB100
- 简单、普通、困难三档机器人，以及保守、均衡、松散、激进四种风格
- 完整下注轮、合法动作、短码全下、主池/边池、平分与奇数筹码结算
- Heads-up 特殊盲注与行动顺序；锦标赛盲注升级、淘汰、名次和冠军判定
- Web Worker Monte Carlo 胜率估算和底池赔率工具
- 事件日志、基础统计、逐步回放、暂停、IndexedDB 自动存档/恢复与已完成比赛归档
- 响应式 Web/PWA、离线缓存和 GitHub Pages 自动部署工作流

当前版本不包含联网、账号、真实货币或大模型机器人。规则状态、玩家身份和本地存储保持分层，为后续账号与服务端权威真人桌预留替换边界。

## 本地运行

需要 Node.js 20 或更新版本。

```bash
cd web
npm ci
npm run dev
```

生产构建输出到 `web/dist`：

```bash
cd web
npm run build
```

## 验证

```bash
cd web
npm run typecheck
npm test
npm run test:e2e
npm run build
```

端到端测试覆盖桌面和移动端的锦标赛与现金桌创建、真人合法行动、暂停/刷新/恢复、现金桌结算以及事件回放入口。

## 代码结构

```text
web/src/
├── app/          React 应用与游戏编排
├── bots/         算法机器人
├── domain/       自研规则引擎、事件、视图投影和随机源
├── history/      回放与统计派生
├── poker-tools/  牌型适配、胜率与赔率
├── storage/      IndexedDB 版本化存档
└── workers/      非阻塞胜率计算
```

规则引擎不依赖 React、DOM、网络或 IndexedDB。机器人只接收自己的 `PlayerView`，不会读取其他玩家底牌。

## GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。每次推送到 `main` 分支后，工作流会依次运行单元/属性测试、浏览器测试和生产构建，再将 `web/dist` 部署到 GitHub Pages。

## 项目文档

- [总体路线图](./ROADMAP.md)
- [第一阶段开发方案](./PHASE1_PLAN.md)
- [现金桌接入方案](./CASH_GAME_PLAN.md)
- [Web 工程说明](./web/README.md)
- [第三方依赖声明](./web/THIRD_PARTY_NOTICES.md)
