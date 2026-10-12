// ============================================================
//  回归测试：界面状态字段（防止"按钮点不了 / 提示不显示"这类 bug）
//    ⚠️ 背景：2026-10 用户实测卡在"被烟雾弹禁出牌的回合"出不去。
//       原因有两个，都是**字段/表达式**问题，不是逻辑问题：
//         ① 服务器 viewFor 只发了 canPlay，**没发 canPlayThisTurn**
//            → 客户端查 canPlayThisTurn === false 永远不成立
//            → "你这回合不能出牌"的提示不显示、手牌不变灰
//         ② 【结束回合】按钮的 disabled 里带了 !S.me.canPlay
//            → 被禁出牌的回合，按钮被禁用 → **一个能点的按钮都没有**
//    跑法：node testuistate.js
// ============================================================
const fs = require("fs");
const http = require("http");
const ws = require("./ws.js");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

const client = fs.readFileSync(__dirname + "/client.js", "utf8");
const server = fs.readFileSync(__dirname + "/server.js", "utf8");

// ---------- 静态检查（不需要服务器）----------
section("1. 服务器必须把界面要用的字段都发出去");
{
  ok(/canPlayThisTurn\s*:/.test(server),
    "viewFor 里发了 canPlayThisTurn（客户端靠它判断'被禁出牌'）");
  ok(/canPlay\s*:/.test(server), "viewFor 里也保留了 canPlay（兼容老代码）");
  for (const f of ["skipNext", "handLimit", "deckCount", "statuses", "shield"]) {
    ok(new RegExp("\\b" + f + "\\s*:").test(server), "viewFor 里发了 " + f);
  }
}

section("2. 【结束回合】按钮不能在'被禁出牌'时被禁用");
{
  // 找出所有给 btnEndTurn / btnEnd 设 disabled 的表达式
  const exprs = [];
  const re = /(?:btnEnd|btnEndTurn"?\]?)\s*\.disabled\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(client))) exprs.push(m[1].trim());
  // 另一种写法：$("btnEndTurn").disabled = ...
  const re2 = /\$\("btnEndTurn"\)\.disabled\s*=\s*([^;]+);/g;
  while ((m = re2.exec(client))) exprs.push(m[1].trim());

  ok(exprs.length > 0, "找到了 " + exprs.length + " 处按钮禁用表达式");
  exprs.forEach((e, i) => {
    console.log("     表达式 " + (i + 1) + ": " + e);
    ok(!/canPlay/.test(e),
      "表达式 " + (i + 1) + " 里没有 canPlay（否则被禁出牌的回合点不了结束回合）");
  });
}

section("3. 客户端必须有'被禁出牌'的提示和拦截");
{
  ok(/你这回合不能出牌/.test(client), "回合提示条会写'你这回合不能出牌'");
  ok(/你这回合被禁止出牌/.test(client), "点手牌时会弹提示框");
  ok(/endTurn/.test(client), "提示框里有结束回合按钮");
  ok(/canPlayThisTurn === false/.test(client), "客户端有 canPlayThisTurn === false 的判断");
  ok(/const interactive/.test(client), "手牌渲染里有 interactive 判定（用来变灰）");
}

section("4. 手牌缓存的签名必须带上'能不能点'");
{
  // 否则回合切换/被禁出牌时手牌内容没变 → 走缓存 → 变灰状态更新不了
  const i = client.indexOf("function renderHand");
  const seg = client.slice(i, i + 900);
  ok(/const sig = \(interactive/.test(seg) || /sig = .*interactive/.test(seg),
    "renderHand 的签名里带了 interactive 状态");
}

// ---------- 运行时检查（起一个临时服务器，看真实响应）----------
section("5. 真实响应：me 对象里到底有哪些字段");
(async () => {
  const { spawn } = require("child_process");
  const PORT = 3777;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORT), NO_OPEN: "1" }),
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 1500));

  function get(p) {
    return new Promise((r) => {
      http.get("http://127.0.0.1:" + PORT + p, (res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", () => r(d)); })
        .on("error", () => r(""));
    });
  }
  function connect(path) {
    return new Promise((resolve) => {
      const req = http.request({
        host: "127.0.0.1", port: PORT, path, method: "GET",
        headers: { "Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
      });
      let msgs = [], rest = Buffer.alloc(0), sk = null;
      req.on("upgrade", (res, sock) => {
        sk = sock;
        sock.on("data", (buf) => {
          const out = ws.decodeFrames(Buffer.concat([rest, buf])); rest = out.rest || Buffer.alloc(0);
          for (const m of (out.messages || [])) { try { msgs.push(JSON.parse(m.data.toString("utf8"))); } catch (e) { } }
        });
        setTimeout(() => resolve({
          send: (o) => { try { sock.write(ws.encodeFrame(JSON.stringify(o))); } catch (e) { } },
          last: () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].type === "state") return msgs[i].view; return null; },
          hello: () => msgs.find((m) => m.type === "hello") || null,
          close: () => { try { sk.destroy(); } catch (e) { } },
        }), 400);
      });
      req.end();
    });
  }

  try {
    await get("/clearseats");
    await new Promise((r) => setTimeout(r, 600));
    const c1 = await connect("/?p=1");
    await new Promise((r) => setTimeout(r, 400));
    if (!c1.hello() || c1.hello().player !== 0) {
      ok(false, "测试客户端没坐上座位（跳过运行时检查）");
    } else {
      c1.send({ type: "changeMode", mode: "ai", diff: "normal" });
      await new Promise((r) => setTimeout(r, 1500));
      const v = c1.last();
      ok(!!v && !!v.me, "收到了状态");
      if (v && v.me) {
        const keys = Object.keys(v.me);
        console.log("     me 的字段: " + keys.join(", "));
        ok(keys.indexOf("canPlayThisTurn") >= 0, "me 里有 canPlayThisTurn（客户端提示靠它）");
        ok(typeof v.me.canPlayThisTurn === "boolean", "canPlayThisTurn 是布尔值（" + v.me.canPlayThisTurn + "）");
        ok(keys.indexOf("canPlay") >= 0, "me 里也有 canPlay");
        for (const f of ["hand", "handLimit", "hp", "energy", "statuses", "deckCount"]) {
          ok(keys.indexOf(f) >= 0, "me 里有 " + f);
        }
      }
    }
    c1.close();
  } catch (e) {
    ok(false, "运行时检查出错: " + e.message);
  }

  try { child.kill(); } catch (e) { }
  await new Promise((r) => setTimeout(r, 300));

  console.log("\n=====================================");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) { console.log("失败清单："); failures.forEach((f) => console.log("  - " + f)); }
  console.log("=====================================");
  process.exit(fail ? 1 : 0);
})();
