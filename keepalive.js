// ============================================================
//  常驻守护进程（keepalive.js）
//    作用：让游戏服务器 + 公网隧道一直活着
//      ① 游戏服务器挂了 → 自动重启
//      ② 隧道掉了 → 自动重连，并抓到新网址
//      ③ 把当前网址写进 当前网址.txt（你随时能看）
//      ④ 每 20 分钟自己 ping 一下，防止云隧道被判定空闲
//
//    用法：node keepalive.js
//    停止：Ctrl+C，或者 taskkill /F /IM node.exe
// ============================================================
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const DIR = __dirname;
const URL_FILE = path.join(DIR, "当前网址.txt");
const LOG_FILE = path.join(DIR, "keepalive.log");
const TUNNEL_LOG = path.join(DIR, "tunnel.log");

let gameProc = null;
let tunnelProc = null;
let tunnelUrl = null;
let lastUrl = null;

function log(msg) {
  const line = "[" + new Date().toLocaleString("zh-CN") + "] " + msg;
  console.log(line);
  // ⚠️ 必须显式用 utf8 写，否则在某些系统上会按 GBK 写 → 中文乱码
  try {
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, "\uFEFF", "utf8"); // BOM：记事本打开不乱码
    }
    fs.appendFileSync(LOG_FILE, line + "\r\n", "utf8");
  } catch (e) { }
}

function writeUrlFile() {
  const now = new Date().toLocaleString("zh-CN");
  const txt = [
    "========================= 当前网址 =========================",
    "",
    "更新时间：" + now,
    "",
    "【你自己玩】  http://localhost:3000/?p=1",
    tunnelUrl ? "【发给朋友】  " + tunnelUrl + "/?p=2      ← 手机也能开" : "【发给朋友】  （隧道还没连上，稍等…）",
    tunnelUrl ? "【观战】      " + tunnelUrl + "/" : "",
    "",
    "【一个人打电脑】打开上面的本机网址 → 右上角 ⚙️ → 和电脑打",
    "【卡牌图鉴】    http://localhost:3000/cards.html",
    "",
    "========================= 说明 =========================",
    "",
    "· 这个文件由 keepalive.js 自动更新（每 30 秒检查一次）",
    "· 只要守护进程在跑，网址就一直有效",
    "· 隧道重连后网址会变，这个文件会自动更新",
    "· 想停：双击 3-停止服务.bat",
    "",
  ].filter(Boolean).join("\r\n");
  try { fs.writeFileSync(URL_FILE, txt, "utf8"); } catch (e) { }
}

// ---------- 启动游戏服务器 ----------
function startGame() {
  if (gameProc && !gameProc.killed) return;
  log("启动游戏服务器…");
  gameProc = spawn(process.execPath, ["server.js"], {
    cwd: DIR,
    env: Object.assign({}, process.env, { NO_OPEN: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  gameProc.stdout.on("data", (d) => { });
  gameProc.stderr.on("data", (d) => log("[服务器] " + d.toString("utf8").trim()));
  gameProc.on("exit", (code) => {
    log("游戏服务器退出了（code=" + code + "），5 秒后重启");
    gameProc = null;
    setTimeout(startGame, 5000);
  });
}

// ---------- 启动隧道 ----------
function startTunnel() {
  if (tunnelProc && !tunnelProc.killed) return;
  log("启动公网隧道…");
  const exe = path.join(DIR, "cloudflared.exe");
  tunnelProc = spawn(exe, [
    "tunnel", "--url", "http://localhost:3000",
    "--no-autoupdate", "--protocol", "http2", "--edge-ip-version", "4",
    "--output", "json",
  ], { cwd: DIR, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  let buf = "";
  const onData = (chunk) => {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const msg = String(j.message || j.msg || "");
        const m = msg.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m && m[0] !== tunnelUrl) {
          tunnelUrl = m[0];
          log("拿到新网址：" + tunnelUrl);
          writeUrlFile();
        }
      } catch (e) {
        // 不是 JSON 就看看有没有网址
        const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m && m[0] !== tunnelUrl) { tunnelUrl = m[0]; log("拿到新网址：" + tunnelUrl); writeUrlFile(); }
      }
    }
  };
  tunnelProc.stdout.on("data", onData);
  tunnelProc.stderr.on("data", onData);
  tunnelProc.on("exit", (code) => {
    log("隧道退出了（code=" + code + "），5 秒后重连");
    tunnelProc = null;
    tunnelUrl = null;
    writeUrlFile();
    setTimeout(startTunnel, 5000);
  });
}

// ---------- 检查服务器是否响应 ----------
function pingGame(cb) {
  const req = http.get({ host: "127.0.0.1", port: 3000, path: "/info", timeout: 5000 }, (res) => {
    res.resume();
    cb(res.statusCode === 200);
  });
  req.on("error", () => cb(false));
  req.on("timeout", () => { req.destroy(); cb(false); });
}

// ---------- 主循环 ----------
let tick = 0;
function loop() {
  tick++;
  pingGame((ok) => {
    if (!ok) {
      log("服务器没响应！");
      if (gameProc) { try { gameProc.kill(); } catch (e) { } gameProc = null; }
      startGame();
    } else {
      if (!gameProc) startGame();
      if (!tunnelProc) startTunnel();
      // 每 20 分钟自己访问一次（保持活跃）
      if (tick % 40 === 0) {
        http.get({ host: "127.0.0.1", port: 3000, path: "/info" }, (r) => r.resume()).on("error", () => { });
      }
      if (tick % 10 === 0) writeUrlFile();
    }
  });
}

// ---------- 启动 ----------
log("========== 守护进程启动 ==========");
log("工作目录：" + DIR);
startGame();
setTimeout(startTunnel, 3000);
writeUrlFile();
setInterval(loop, 30000);
loop();

process.on("SIGINT", () => {
  log("收到停止信号，正在关闭…");
  try { if (gameProc) gameProc.kill(); } catch (e) { }
  try { if (tunnelProc) tunnelProc.kill(); } catch (e) { }
  process.exit(0);
});
