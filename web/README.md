# Rivercraft Web 应用

这是 Rivercraft 第一阶段的静态 React/PWA 客户端。业务运行完全在浏览器本地完成，不需要后端或账号系统。

## 命令

```bash
npm ci              # 安装锁定依赖
npm run dev         # 本地开发服务器
npm run typecheck   # TypeScript 严格检查
npm test            # Vitest 单元、场景、属性与批量模拟
npm run test:e2e    # Playwright 桌面/移动关键流程
npm run build       # 生成 dist 静态站点
```

本机运行 Playwright 时使用已安装的 Chrome；CI 会安装 Chromium。

## 关键实现边界

- `src/domain` 是独立规则引擎，不依赖界面或浏览器存储。
- 牌型计算只通过 `src/domain/evaluator.ts` 适配 `pokersolver`。
- 正式洗牌使用 Web Crypto；测试使用可注入的种子随机源。
- 每次已接受的命令都写入事件日志和内部状态检查点；IndexedDB v3 只持久化日志，并通过纯 Reducer 恢复，同时归档已完成比赛。
- `PlayerView` 会隐藏其他仍在牌局中的玩家底牌；机器人与概率面板不能访问隐藏信息。
- Monte Carlo 胜率估算在独立 Web Worker 中执行。

## 部署

Vite 使用相对资源路径，`dist` 可部署到 GitHub Pages 的任意仓库子路径。根目录的 GitHub Actions 工作流会在测试通过后发布该目录。
