# 🎴 卡牌游戏（云端版）

双人实时卡牌对战。服务器权威（规则全在服务端算），客户端只负责显示。
**零第三方依赖** —— 只用 Node 内置模块，HTTP 和 WebSocket 都是手写的。

---

## 一、怎么用

| 你要做的 | 打开 |
|---|---|
| 自己玩（玩家1） | `网址/?p=1` |
| 朋友玩（玩家2） | `网址/?p=2` |
| 观战（能看到两边手牌） | `网址/`（不带参数） |
| 演出演示页 | `网址/demo.html` |
| 木桩模式（对面100血不还手） | `网址/?p=1&dummy=1` 或点顶栏【🎯 木桩模式】 |
| 作弊模式 | `网址/?p=1&cheat=1` 或点顶栏【😈 作弊】 |

**开局**：两个人分别打开 `?p=1` 和 `?p=2`，任意一方点【开始新游戏】。

---

## 二、本地运行

```bash
npm start
# 或
node server.js
```

默认监听 `0.0.0.0:3000`。端口可以用环境变量改：

```bash
PORT=8080 node server.js
```

---

## 三、部署到云服务器

### 方案 A：Render（推荐，免费）

1. 把本项目推到 GitHub（**不要**把 `cloudflared.exe` 传上去，54MB 太大了）
2. 打开 https://render.com → 用 GitHub 登录
3. 点 **New +** → **Web Service** → 选中这个仓库
4. 填：
   ```
   Name:          kanpai（随便起）
   Region:        Singapore（离中国近）
   Runtime:       Node
   Build Command: （留空）
   Start Command: node server.js
   Instance Type: Free
   ```
5. 点 **Create Web Service** → 等 1~2 分钟
6. 拿到固定网址，例如 `https://kanpai.onrender.com`

**⚠️ Render 免费版的限制：**
- 15 分钟没人访问会"休眠"，下次打开要等 30 秒左右唤醒
- 免费实例内存 512MB（这个游戏只占几十 MB，完全够）

### 方案 B：Railway

1. https://railway.app → GitHub 登录 → **New Project** → **Deploy from GitHub repo**
2. 它会自动识别 `package.json` 并跑 `npm start`
3. 在 **Settings → Networking** 里点 **Generate Domain** 拿网址

### 方案 C：Fly.io / Zeabur / 自己的 VPS

只要满足"给一个环境变量 `PORT`、能跑 `node server.js`"就行。

**重要**：服务器会自动读 `process.env.PORT`（云平台会注入），
并且云上**不会**自动弹浏览器（判断依据：有 `NO_OPEN` 环境变量）。

---

## 四、文件说明

| 文件 | 作用 |
|---|---|
| `server.js` | HTTP + WebSocket 服务器，权威账本 |
| `ws.js` | 手写的 WebSocket（握手、帧编解码） |
| `engine.js` | 纯规则引擎（算伤害、状态、回合）—— 不碰网络 |
| `cards.js` | 60 张卡的数值 |
| `client.js` | 客户端：渲染 + 发指令 |
| `fx.js` | 演出引擎（约 4700 行，所有动画） |
| `fx-panel.css` | 面板上的状态粒子特效 |
| `index.html` | 游戏主页面 |
| `demo.html` | 演出演示页（逐张试动画） |
| `logopick.html` / `logo3.html` | 牌名动画 / 徽记 logo 的方案挑选页 |

---

## 五、测试

```bash
node test.js          # 规则引擎 261 项
node checkall.js      # 60 张牌全量审计
node testclient.js    # 客户端逻辑 14 项
node testspectator.js # 观战 11 项
node testdiscard2.js  # 弃牌流程 31 项
node checkinstall.js  # 演出是否接进正式游戏
node selfcheck.js     # 全面自检（HTTP + WebSocket + 资源）
```

---

## 六、还没做的

- 22/60 张牌用的是通用兜底动画（有专属动画的 38 张）
- AI 对手（方案已设计好，没实现）
- 音效：目前只有 3 个 + 八音盒；其它音效可以放到 `sounds/` 目录
  （文件名对应上就会自动替换合成音，比如 `sounds/thunder.mp3`）
