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
| **和电脑打** | `网址/?p=1` → 点 ⚙️ → 【🤖 和电脑打】 |
| 演出演示页 | `网址/demo.html` |
| 卡牌图鉴（60 张 + 看动画） | `网址/cards.html` |
| 木桩模式（对面100血不还手） | 点 ⚙️ → 【🎯 木桩模式】 |
| 作弊模式 | 点 ⚙️ → 【😈 作弊模式】 |

**开局**：两个人分别打开 `?p=1` 和 `?p=2`，任意一方点【▶ 开始游戏】。
**一个人玩**：点右上角 ⚙️ → 【🤖 和电脑打】（可选 简单 / 普通 / 困难）。

---

## 二、AI 对手

`ai.js` —— 电脑坐玩家2，决策走**和真人完全一样的出口**（`E.playCard` / `resolvePending`），
所以它不能做人类做不到的操作。

**设计原则：**
- **只看公开信息**：血量、能量、手牌数、牌库数、场上单位、状态、战报
- **绝不偷看对方手牌内容**（`黑弴` 这类"从对方手上抽牌"的牌，AI 也只能瞎抽）
- 有**思考延迟**（700~1400ms），让人看得清它在干什么
- 有**三重保险丝**防止死循环：`canPlayThisTurn` 检查 / 连续失败 3 次强制过回合 / 一回合最多行动 12 次

**难度差异：**
| 难度 | 行为 |
|---|---|
| 😊 简单 | 30% 概率乱出牌；格挡经常忘；不会留能量 |
| 🙂 普通 | 按评分出牌；该挡就挡；留 2 点能量 |
| 😈 困难 | 会算斩杀、留 3 点能量、优先用带额外效果的格挡牌（盾反/水晶盾/名刀） |

**它会做的事：**
- 能一击必杀时优先斩杀
- 血 ≤8 时优先治疗（保命）
- 手上最没用的牌拿去喂「转转 / 洗牌 / 信 / 弃牌」
- 用「弹簧」取消对方的关键牌（核弹/末日/黑洞/一拳/斩杀…）
- 能量不够时不会硬出贵牌（会挑便宜的）
- 「替罪羊」从弃牌堆捞最有价值的那张

---

## 三、本地运行

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

## 四、部署到云服务器

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

## 五、文件说明

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

## 六、测试

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

## 七、还没做的

- 22/60 张牌用的是通用兜底动画（有专属动画的 38 张）
- AI 对手（方案已设计好，没实现）
- 音效：目前只有 3 个 + 八音盒；其它音效可以放到 `sounds/` 目录
  （文件名对应上就会自动替换合成音，比如 `sounds/thunder.mp3`）
