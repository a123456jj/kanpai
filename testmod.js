// ============================================================
//  美化包系统测试
//    ① 服务器 /mods 接口格式对不对
//    ② 每个包声明的图，实际能不能下载到
//    ③ 客户端：假 DOM + 假 fetch，模拟"点美化包按钮"
//       → 验证背景/卡背/data 属性真的被设上了
// ============================================================
const http = require("http");
const fs = require("fs");
const vm = require("vm");
const BASE = "http://127.0.0.1:" + (process.env.PORT || 3000);

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✅ " + label); } else { fail++; console.log("  ❌ " + label); } };
const section = (t) => console.log("\n=== " + t + " ===");

function req(path) {
  return new Promise((resolve) => {
    http.get(BASE + path, (res) => {
      let n = 0;
      res.on("data", (c) => n += c.length);
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", bytes: n }));
    }).on("error", (e) => resolve({ status: 0, type: "", bytes: 0, err: e.message }));
  });
}
function getJson(path) {
  return new Promise((resolve) => {
    http.get(BASE + path, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}

(async () => {
  // ────────── ① 服务器 /mods ──────────
  section("1. 服务器 GET /mods");
  const mods = await getJson("/mods");
  ok(Array.isArray(mods), "/mods 返回数组");
  if (!Array.isArray(mods)) { console.log("\n  服务器没起来？"); process.exit(1); }
  console.log("     发现 " + mods.length + " 个美化包");
  for (const m of mods) {
    console.log("     · " + m.name + "  (id=" + m.id + ")" +
      "  背景=" + (m.files.background ? "有" : "无") +
      "  卡背=" + (m.files.cardback ? "有" : "无"));
  }
  if (mods.length) {
    const m = mods[0];
    ok(typeof m.id === "string" && m.id.length > 0, "包有 id");
    ok(typeof m.name === "string" && m.name.length > 0, "包有 name");
    ok(typeof m.overlay === "number" && m.overlay >= 0 && m.overlay <= 0.9, "overlay 是 0~0.9 的数（" + m.overlay + "）");
    ok(typeof m.files === "object", "files 是对象");
    ok(m.hasAny === true, "hasAny 为 true（至少有一张图或配置）");
  }

  // ────────── ② 每个包的文件能下载 ──────────
  section("2. 每个包声明的图，实际能下载吗");
  for (const m of mods) {
    for (const key of ["background", "cardback", "logo", "frame"]) {
      const f = m.files[key];
      if (!f) continue;
      const url = "/mods/" + encodeURIComponent(m.id) + "/" + f;
      const r = await req(url);
      const isImg = /^image\//.test(r.type);
      ok(r.status === 200 && r.bytes > 1000 && isImg,
        m.name + " / " + key + "  → " + r.status + " " + r.type + " " + Math.round(r.bytes / 1024) + " KB");
    }
    // pack.json 也要能拿到
    const pj = await req("/mods/" + encodeURIComponent(m.id) + "/pack.json");
    if (pj.status === 200) ok(true, m.name + " / pack.json 可访问");
  }

  // ────────── ③ 客户端：模拟点击 ──────────
  section("3. 客户端 —— 假 DOM + 假 fetch，模拟点美化包按钮");
  const clientSrc = fs.readFileSync(__dirname + "/client.js", "utf8");

  // 记录 DOM 变化
  const log = { bodyStyle: {}, htmlAttrs: {}, htmlVars: {}, innerHTML: {} };
  function mkEl(tag, id) {
    const kids = [], cls = new Set(), styleT = {};
    const attrs = {};
    const e = {
      tagName: (tag || "div").toUpperCase(), id: id || "", dataset: {}, textContent: "", _html: "",
      children: kids, width: 1280, height: 800, offsetWidth: 100, offsetHeight: 100,
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, f) => { if (f === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else { f ? cls.add(c) : cls.delete(c); } },
      },
      appendChild(n) { kids.push(n); return n; },
      remove() { },
      querySelector(sel) {
        // 支持 "button[data-mod]" 这种
        const m = /\[data-mod\]/.test(sel);
        if (m) return null;
        return null;
      },
      // ⚠️ 关键：refreshModButtons 用 querySelectorAll("button[data-mod]") 取按钮
      querySelectorAll(sel) {
        if (/button\[data-mod\]/.test(sel)) {
          // 从刚设进去的 innerHTML 里解析出 data-mod
          const found = [];
          const re = /data-mod="([^"]*)"/g;
          let mm;
          while ((mm = re.exec(e._html)) !== null) {
            const b = mkEl("button");
            b.dataset = { mod: mm[1] };
            found.push(b);
          }
          e._lastButtons = found;
          return found;
        }
        return [];
      },
      addEventListener() { }, removeEventListener() { },
      setAttribute(k, v) { attrs[k] = v; log.htmlAttrs[k] = v; },
      getAttribute(k) { return attrs[k] !== undefined ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; delete log.htmlAttrs[k]; },
      hasAttribute(k) { return k in attrs; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
      getContext: () => null,
      onclick: null, focus() { }, blur() { }, click() { if (e.onclick) e.onclick({ stopPropagation() { } }); },
    };
    e.style = new Proxy(styleT, {
      get(t, k) {
        if (k === "setProperty") return (a, b) => { t[a] = b; log.htmlVars[a] = b; };
        if (k === "removeProperty") return (a) => { delete t[a]; delete log.htmlVars[a]; };
        if (k === "cssText" || k === "length") return t[k] || "";
        return t[k] !== undefined ? t[k] : "";
      },
      set(t, k, v) { t[k] = v; log.bodyStyle[k] = v; return true; },
      deleteProperty(t, k) { delete t[k]; return true; },
      ownKeys(t) { return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor(t, k) { return { configurable: true, enumerable: true, value: t[k], writable: true }; },
    });
    Object.defineProperty(e, "className", {
      get: () => Array.from(cls).join(" "),
      set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); },
    });
    Object.defineProperty(e, "innerHTML", {
      get: () => e._html,
      set: (v) => { e._html = String(v); kids.length = 0; log.innerHTML[e.id || tag] = String(v); },
    });
    return e;
  }

  const els = {};
  const doc = {
    documentElement: mkEl("html"),
    body: mkEl("body"),
    head: mkEl("head"),
    getElementById: (id) => els[id] || (els[id] = mkEl("div", id)),
    querySelector: (s) => els[s] || (els[s] = mkEl("div", s)),
    querySelectorAll: () => [],
    createElement: (t) => mkEl(t),
    createElementNS: (ns, t) => mkEl(t),
    addEventListener() { }, removeEventListener() { },
  };

  const ctx = {
    console: { log() { }, warn() { }, error() { } },
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise,
    parseFloat, parseInt, isNaN, isFinite, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => { },
    requestAnimationFrame: () => 1,
    document: doc, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    addEventListener() { }, removeEventListener() { },
    location: { search: "", href: "http://localhost:3000/?p=1" },
    URLSearchParams: URLSearchParams,   // client.js 读 ?p=1 要用
    WebSocket: function () { this.readyState = 1; this.send = () => { }; this.close = () => { }; },
    FX: undefined,
    // 假 localStorage（client.js 会探测它）
    localStorage: (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })(),
    // 假 fetch：/mods 返回真实数据，其它返回空
    fetch: (url) => Promise.resolve({
      json: () => Promise.resolve(String(url).indexOf("/mods") >= 0 ? mods : []),
      text: () => Promise.resolve(""),
    }),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  let crashed = null;
  try { vm.runInContext(clientSrc, ctx, { filename: "client.js" }); }
  catch (e) { crashed = e; }
  ok(!crashed, "client.js 在假环境里能加载" + (crashed ? "（" + crashed.message + "）" : ""));

  // 等 fetch promise 落地
  await new Promise((r) => setTimeout(r, 120));

  const modListEl = doc.getElementById("modList");
  ok(!!modListEl, "#modList 元素取到了");
  const html = modListEl ? modListEl.innerHTML : "";
  ok(html.indexOf("不用（默认皮肤）") >= 0, "按钮列表里有「不用（默认皮肤）」");
  if (mods.length) {
    ok(html.indexOf(mods[0].id) >= 0 || html.indexOf(mods[0].name) >= 0,
      "按钮列表里有「" + mods[0].name + "」");
  }

  // 模拟"点了第一个美化包的按钮"
  if (mods.length && modListEl) {
    // ⚠️ 必须用 client.js 自己拿过的那批按钮对象（onclick 绑在上面）
    //    我们的 mock 每次 querySelectorAll 都返回新对象，再取一次就没绑定了
    const btns = modListEl._lastButtons || [];
    ok(btns.length >= 1, "解析出 " + btns.length + " 个 data-mod 按钮");
    const target = btns.find((b) => b.dataset.mod === mods[0].id) || btns[btns.length - 1];
    ok(!!target, "找到要点的按钮（data-mod=" + (target && target.dataset.mod) + "）");
    if (target) {
      try { target.click(); } catch (e) { console.log("     点击抛错: " + e.message); }
      const bgImg = log.bodyStyle.backgroundImage || "";
      ok(bgImg.indexOf("mods/") >= 0, "点完之后 body 背景换成了美化包的图");
      ok(bgImg.indexOf("linear-gradient") >= 0, "背景上叠了遮罩（linear-gradient）");
      ok(log.htmlAttrs["data-cardback"] === "1", "html 上设了 data-cardback=1（卡背生效）");
      ok(String(log.htmlVars["--cardback-url"] || "").indexOf("mods/") >= 0, "--cardback-url 指向美化包的图");
      if (mods[0].hideBokeh) {
        ok(log.htmlAttrs["data-hidebokeh"] === "1", "html 上设了 data-hidebokeh=1（藏掉糖果圆点）");
      }
      ok(log.htmlAttrs["data-modbg"] === "1", "html 上设了 data-modbg=1（页面底色压暗）");
      // 再点"不用"
      const off = btns.find((b) => b.dataset.mod === "");
      if (off) {
        off.click();
        ok(!log.bodyStyle.backgroundImage || log.bodyStyle.backgroundImage === "",
          "点「不用」之后背景清空了");
        ok(!log.htmlAttrs["data-cardback"], "点「不用」之后 data-cardback 移除了");
      }
    }
  }

  console.log("\n=====================================");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  console.log("=====================================");
  process.exit(fail ? 1 : 0);
})();
