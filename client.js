// ============================================================
// 客户端：连接服务器，显示画面，发送操作
// ============================================================
let ws = null;
let CARDS = {};
let cardList = [];
let S = null;            // 当前查看的状态
let bothHands = null;    // 双控模式下的两边手牌
let viewPlayer = 0;      // 当前查看哪个玩家视角（双控用）
const DEBUG = [];        // 调试信息（显示在页面角落，方便排查"卡住了"）

function dbg(msg) {
  const t = new Date().toLocaleTimeString();
  DEBUG.push(t + " " + msg);
  if (DEBUG.length > 40) DEBUG.shift();
  const el = document.getElementById("dbgBox");
  if (el) el.textContent = DEBUG.slice(-12).join("\n");
  console.log("[DBG]", msg);
}

// ============================================================
// 演出：按服务器发来的"演出事件"播动画
//   ⚠️ 关键规则（用户要求）：
//     ・只有**真造成伤害**（damage 事件）才播那张牌的动画
//     ・**被格挡**（blocked 事件）不播伤害动画，只播一个小小的"被挡下"提示
//     ・治疗/护盾/召唤等按各自事件播
// ============================================================
let fxLastEvt = 0;       // 已经处理到第几号事件（避免重复播）
let fxStarted = false;

const STATUS_NAMES = ["中毒", "焚烧", "末日", "诅咒", "震荡", "断头台", "红绿灯", "土豆地雷", "饥荒", "治疗阻挡", "护盾", "盾", "反甲"];

// 🔍 演出诊断信息（显示在页面上的调试面板里，方便查"为什么没播动画"）
let fxDiagLines = [];
function fxDiag(msg) {
  const t = new Date().toLocaleTimeString();
  fxDiagLines.push(t + " " + msg);
  if (fxDiagLines.length > 6) fxDiagLines.shift();
  const el = document.getElementById("fxDiag");
  if (el) el.textContent = fxDiagLines.join("\n");
  try { console.log("[演出]", msg); } catch (e) { }
}

// 把"被打的那一方"的框中心算出来（特效落在那里）
function fxPosOf(defenderIdx, myIdx) {
  const isMe = (defenderIdx === myIdx);
  const el = document.getElementById(isMe ? "mePanel" : "oppPanel");
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.42 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.34 };
}

// 播一张牌的演出（落点由 defenderIdx 决定）
function fxPlayCardAt(cardName, defenderIdx, myIdx, speed) {
  if (typeof FX === "undefined" || !FX.castFx) return;
  try {
    const card = (typeof CARDS === "object" && CARDS) ? CARDS[cardName] : null;
    FX.castFx(cardName, { card: card, pos: fxPosOf(defenderIdx, myIdx), speed: speed || 1 });
  } catch (e) { dbg("演出出错: " + e.message); }
}

// 💣 定时炸弹徽章：**已删除**（用户要求："删掉徽章和边框光，只留文字"）
//    以前会在牌库顶有炸弹那一方的面板上挂一个金属球 + 计时器 + 火花 + 一直抖
//    现在什么都不挂 —— 炸弹情况靠下面的文字提示和战报看
function fxSyncBomb(iAm) {
  if (typeof FX !== "undefined" && FX.syncBomb) { try { FX.syncBomb(null); } catch (e) { } }
}

// 🧹 常驻徽章已删除（用户要求："删掉徽章和边框光，只留文字"）
//    这两个函数保留成空操作，是为了兼容别处可能的调用；
//    地雷徽章、炸弹徽章、状态粒子、边框光 —— 全都不再创建了。
//    状态只靠文字显示（面板下方那排小标签 + 战报）。
function fxSyncMine(iAm) {
  if (typeof FX !== "undefined" && FX.syncMine) { try { FX.syncMine(null); } catch (e) { } }
}

// 定时炸弹被抽到时的警示（只在弹窗第一次出现时播一次）
//   新设计下炸弹徽章是常驻的，"抽到"这一下只做一个红色闪烁提示
let fxBombWarned = false;
function fxBombWarnIfNeeded(pd, iAm) {
  if (!pd || pd.kind !== "timebomb") { fxBombWarned = false; return; }
  if (fxBombWarned) return;
  fxBombWarned = true;
  try {
    if (typeof FX !== "undefined" && FX.flash) {
      FX.flash("rgba(255,40,40,.22)", 260);
      setTimeout(function () { if (FX.flash) FX.flash("rgba(255,40,40,.16)", 200); }, 300);
    }
    if (typeof FX !== "undefined" && FX.shake) FX.shake("mid");
  } catch (e) { dbg("炸弹警示出错: " + e.message); }
}

// 处理演出事件列表
//   ⚠️ DAMAGE_CARDS：这些牌"打完伤害还会挂状态" →
//      它们的 status 事件不能再播一次动画（否则同一张牌播两遍）
//      （用户实测：毒鸡汤的汤碗动画播了两次）
const DAMAGE_CARDS = {
  "毒鸡汤": 1, "硫酸": 1, "焚烧": 1, "腐肉": 1,
  "毒飞刀": 1, "血刃": 1, "苦无": 1, "狙击枪": 1,
};
function fxProcessEvents(events, myIdx) {
  // 🔍 诊断：把"收到几个事件、要不要播"显示到调试面板
  if (!Array.isArray(events) || !events.length) {
    fxDiag("事件: 0 条（服务器没发 fx 字段？）");
    return;
  }
  if (!fxStarted) {
    fxLastEvt = events[events.length - 1].n;
    fxStarted = true;
    fxDiag("事件: 首次同步（跳过 " + events.length + " 条历史事件，最新编号 " + fxLastEvt + "）");
    return;
  }
  const fresh = events.filter((e) => e && typeof e.n === "number" && e.n > fxLastEvt);
  fxDiag("事件: 收到 " + events.length + " 条，新的 " + fresh.length + " 条" +
    (fresh.length ? "（" + fresh.map((e) => e.kind + ":" + (e.card || "")).join(", ") + "）" : ""));
  for (const e of fresh) {
    if (!e || typeof e.n !== "number" || e.n <= fxLastEvt) continue;
    fxLastEvt = e.n;
    try {
      if (e.kind === "play") {
        // 出牌：只做一点小提示，**不播大动画**（大动画等"真打中"再说）
        if (typeof FX !== "undefined" && FX.flash) FX.flash("rgba(255,220,120,.10)", 120);
        dbg("出牌：" + e.card);
      } else if (e.kind === "damage") {
        // 💣 定时炸弹：不是"打中"，是"炸了" → 走爆炸演出
        if (e.card === "定时炸弹") {
          const p = fxPosOf(e.defender, myIdx);
          if (typeof FX !== "undefined" && FX.timebombBlast) FX.timebombBlast(p.x, p.y, e.bombCount || 1);
          dbg("💣 定时炸弹爆炸：玩家" + (e.defender + 1) + " 吃 " + e.amount + " 点");
        } else if (e.card === "土豆地雷" || e.mineBoom) {
          // 🥔 土豆地雷：踩爆了 → 小范围爆炸 + 泥块四溅
          const p = fxPosOf(e.defender, myIdx);
          if (typeof FX !== "undefined" && FX.mineBlast) FX.mineBlast(p.x, p.y);
          dbg("🥔 土豆地雷踩爆：玩家" + (e.defender + 1) + " 吃 " + e.amount + " 点");
        } else if (e.statusTick || e.card === "状态伤害") {
          // 🩸 状态跳伤（中毒/焚烧/饥荒/末日…）：**不套用任何牌的动画**
          //    只给一个中性的掉血反馈（绿色小数字 + 一圈光环）
          //    ⚠️ 以前这类伤害要么没反馈、要么误播上一张牌的动画
          //       （用户实测：打出毒鸡汤后，对面回合中毒掉血时又播了汤碗动画）
          const p = fxPosOf(e.defender, myIdx);
          if (typeof FX !== "undefined") {
            if (FX.bigText) {
              FX.bigText(p.x, p.y - 18, "-" + e.amount,
                { size: 40, color: "#7ad07a", glow: "#3aa83a", life: 900 });
            }
            if (FX.ring) FX.ring(p.x, p.y, "rgba(120,208,122,.85)", 8);
          }
          dbg("状态跳伤：" + (e.statusName || e.reason || "") + " → 玩家" + (e.defender + 1) + " 扣 " + e.amount);
        } else {
          // 🎯 真打中 → 播这张牌的完整演出
          //   召唤类例外：召唤演出由 summon 事件负责（单位攻击的伤害不重复播一遍召唤动画）
          const isSummon = (typeof CARDS === "object" && CARDS && CARDS[e.card] && CARDS[e.card].kind === "unit");
          if (!isSummon) fxPlayCardAt(e.card, e.defender, myIdx, 1);
          dbg("打中：" + e.card + " → 玩家" + (e.defender + 1) + " 扣 " + e.amount);
        }
      } else if (e.kind === "summon") {
        // 🐉 召唤：播召唤演出（单位本身由 syncUnits 常驻显示）
        fxPlayCardAt(e.card, e.player !== undefined ? e.player : myIdx, myIdx, 1);
        dbg("召唤：" + e.card);
      } else if (e.kind === "status") {
        // 💣 定时炸弹：不用一次性动画了 —— 炸弹徽章由 fxSyncBomb 常驻显示（见 render）
        if (e.card === "定时炸弹") {
          dbg("💣 定时炸弹事件：" + (e.bombChoice || "") + " 第" + (e.bombCount || 1) + "轮 → 徽章会常驻在面板上");
        } else if (DAMAGE_CARDS[e.card]) {
          // ⚠️ 有伤害成分的牌（毒鸡汤/硫酸/焚烧…）：
          //    它们的动画已经在 damage 事件里播过了，
          //    这里再播一次 = 同一张牌播两遍（用户实测：汤碗动画播两次）
          //    → 挂状态这一步只记日志，不重播动画
          dbg("状态生效（动画已在伤害那步播过）：" + e.card + " → " + e.status);
        } else {
          // 🌀 纯状态牌（黑洞/断头台/信/红绿灯/窥视…）→ 播这张牌的演出
          //    （如果这一下被格挡了，服务器不会发这个事件 → 就不播）
          const who = (e.target !== undefined) ? e.target : (e.player !== undefined ? e.player : myIdx);
          fxPlayCardAt(e.card, who, myIdx, 1);
          dbg("状态生效：" + e.card + " → " + e.status);
        }
      } else if (e.kind === "blocked") {
        // 🛡 被格挡 → 不播伤害动画，只播一个小提示
        if (typeof FX !== "undefined" && FX.flash) FX.flash("rgba(160,210,255,.18)", 160);
        if (typeof FX !== "undefined" && FX.ring) {
          const p = fxPosOf(e.defender, myIdx);
          FX.ring(p.x, p.y, "rgba(160,210,255,.9)", 10);
        }
        dbg("被格挡：" + e.card + " 被【" + e.blockCard + "】挡掉（不播动画）");
      } else if (e.kind === "absorbed") {
        if (typeof FX !== "undefined" && FX.flash) FX.flash("rgba(200,230,255,.15)", 160);
        dbg("被护盾吸收：" + e.card);
      } else if (e.kind === "heal" || e.kind === "block" || e.kind === "buff" || e.kind === "debuff" || e.kind === "draw") {
        // 治疗/护盾/增益等：按牌本身的效果播
        fxPlayCardAt(e.card, e.player !== undefined ? e.player : myIdx, myIdx, 1);
      }
      // 注意：
      //   ・play 事件（出牌）**故意不播**大动画 —— 等"真造成影响"的事件
      //   ・summon 事件不在这里播 —— 召唤的演出在 summonFx 里，
      //     而且单位攻击造成的伤害会走 damage 事件
    } catch (err) { dbg("处理事件出错: " + err.message); }
  }
}

// 把双方身上的状态同步给"框内特效"
function fxSyncStatus(statuses) {
  if (typeof FX === "undefined" || !FX.setStatus) return;
  try {
    FX.setStatus(statuses || { opp: [], me: [] }, { opp: "oppPanel", me: "mePanel" });
  } catch (e) { dbg("状态特效出错: " + e.message); }
}

function fxOnGameStart() {
  fxLastEvt = 0;
  fxStarted = false;
  fxDeadDone = [false, false];
  if (typeof FX !== "undefined") {
    if (FX.clearStatusLayer) FX.clearStatusLayer({ opp: "oppPanel", me: "mePanel" });
    if (FX.clearUnits) FX.clearUnits();
    if (FX.unlockAudio) FX.unlockAudio();
  }
}

// 🩸 角色死亡 → 把他的框切成两半（只播一次）
let fxDeadDone = [false, false];
function fxCheckDeath(dead, myIdx) {
  if (typeof FX === "undefined" || !FX.splitPanel) return;
  if (!Array.isArray(dead)) return;
  for (let i = 0; i < 2; i++) {
    if (dead[i] && !fxDeadDone[i]) {
      fxDeadDone[i] = true;
      // i 是玩家编号（0=玩家1，1=玩家2）；我看到的框：对方是 oppPanel，自己是 mePanel
      const isMe = (myIdx === i);
      const panelId = isMe ? "mePanel" : "oppPanel";
      try {
        setTimeout(function () {
          FX.splitPanel(panelId, { speed: 1 });
        }, 260);
      } catch (e) { dbg("死亡动画出错: " + e.message); }
    }
  }
}

// 我是谁：可以从网址读（?p=1 / ?p=2），也可以点页面按钮切换
//   0 = 玩家1    1 = 玩家2    null = 双控模式
const urlParts = new URLSearchParams(location.search);
let MY_PLAYER = urlParts.get("p") === "1" ? 0 : (urlParts.get("p") === "2" ? 1 : null);

const $ = (id) => document.getElementById(id);

function connect() {
  // ⚠️ 必须把身份一起带给服务器，否则服务器不知道这个窗口控制哪一方
  const q = MY_PLAYER === null ? "" : ("?p=" + (MY_PLAYER + 1));
  ws = new WebSocket("ws://" + location.host + q);
  ws.onopen = () => {
    $("conn").textContent = "已连接";
    $("mode").textContent = "当前身份：" + (MY_PLAYER === null ? "双控模式" : ("玩家" + (MY_PLAYER + 1)));
    // 显示当前画质档位（手机自动降质，防止卡顿）
    var qEl = document.getElementById("fxQuality");
    if (qEl && typeof FX !== "undefined" && FX.quality) {
      var t = FX.quality.tier;
      qEl.textContent = "画质：" + (t === "low" ? "低（省性能）" : (t === "mid" ? "中" : "高"));
      qEl.title = "想改？网址后面加 ?fxq=high 或 ?fxq=low";
    }
    // 第一次连上就尝试解锁声音
    if (typeof FX !== "undefined" && FX.unlockAudio) FX.unlockAudio();
  };
  ws.onclose = () => { $("conn").textContent = "断线"; setTimeout(connect, 1500); };
  ws.onerror = () => { $("conn").textContent = "连接错误"; };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "state") {
      S = m.view;
      bothHands = m.view ? (m.view.bothHands || null) : null;
      dbg("收到状态: 回合" + (S ? S.turn : "?") + " 当前玩家" + (S ? (S.current + 1) : "?") +
          " 待决策=" + (S && S.pending ? S.pending.kind : "无") +
          " 阶段=" + (S ? S.phase : "已重置"));
      if (!S) {
        // 游戏已重置：清空画面
        setPrompt('<h3>已重置 —— 点右上角【▶ 开始游戏】开一局</h3>');
        $("meInfo").innerHTML = ""; $("oppInfo").innerHTML = "";
        $("meHand").innerHTML = ""; $("oppHand").innerHTML = "";
        $("log").innerHTML = "";
        $("meTitle").textContent = "我"; $("oppTitle").textContent = "对手";
        hideResult();
        return;
      }
      render();
    } else if (m.type === "error") {
      dbg("❌ 服务器拒绝: " + m.message);
      // 有弹窗的时候，不要用错误信息把弹窗顶掉
      if (!(S && S.pending)) {
        setPrompt(`<h3>⚠️ ${m.message}</h3>`);
      }
    } else if (m.type === "notice") {
      // 服务器的提示（比如作弊偷看手牌）
      dbg("📢 " + m.message);
      if (typeof FX !== "undefined" && FX.flash) FX.flash("rgba(255,60,60,.25)", 300);
      setPrompt(`<h3>😈 ${m.message}</h3>`);
    } else if (m.type === "hello") {
      dbg("连接成功，身份=" + (m.spectator ? "观战者" : (m.player === null ? "未定" : "玩家" + (m.player + 1))));
      if (m.spectator) {
        MY_PLAYER = null;
        setPrompt('<h3>👁 你是观战者 —— 能看到双方手牌，但不能操作</h3>');
      }
    }
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) {
    dbg("发送: " + JSON.stringify(obj));
    ws.send(JSON.stringify(obj));
  } else {
    dbg("⚠️ 连接断了，发不出去: " + JSON.stringify(obj));
  }
}

// ---------- 取卡牌数据 ----------
async function loadCards() {
  const r = await fetch("/cards");
  const arr = await r.json();
  for (const c of arr) { CARDS[c.name] = c; cardList.push(c.name); }
}

// ---------- 渲染 ----------
function statLine(x, isMe) {
  // 📖 双方共用一副牌库（设计文档第 17 行）→ 不在这里显示，
  //    改成在界面上单独显示一个"公共牌库"计数器（见 render 里的 #sharedDeck）
  return `<span class="stat">⚡ <b>${x.energy}</b>/${x.maxEnergy}</span>
          <span class="stat">🃏 ${isMe ? x.hand.length : x.handCount}/${x.handLimit !== undefined ? x.handLimit : 5}</span>
          ${x.shield ? `<span class="stat">🛡 ${x.shield}</span>` : ""}
          ${x.skipNext ? `<span class="tag bad">下回合不能出牌</span>` : ""}
          ${x.thorns ? `<span class="tag good">反甲</span>` : ""}`;
}

// 血量：低了变红 + 闪（新 UI 用）
function fxHpClass(hp) {
  if (hp <= 5) return "stat hp crit";
  if (hp <= 10) return "stat hp low";
  return "stat hp";
}
function fxHpTick(which, hp) {
  const el = document.getElementById(which + "HpStat");
  if (el) el.className = fxHpClass(hp);
  const b = document.getElementById(which + "Hp");
  if (b) b.textContent = hp;
}

// 🏷 状态的简短说明（动画删掉后，靠文字把情况说清楚）
const STATUS_HINT = {
  "中毒": "每回合扣 1 血/层",
  "焚烧": "每回合扣 2 血",
  "饥荒": "每回合扣 1 血/层",
  "流血": "每回合扣血",
  "虚弱": "伤害减半",
  "抗性": "受到的伤害减半",
  "免疫": "免疫下一次伤害",
  "护盾": "按数值吸收伤害",
  "反甲": "被打时反弹伤害",
  "蓄力": "下一张牌伤害 ×2",
  "兴奋剂": "下一张牌伤害 ×2",
  "嗜血": "吸血",
  "幸运儿": "费用减半",
  "转头": "下次回血减半",
  "钻石镐": "能量上限 +2",
  "八音盒": "倒计时结束判负",
  "土豆地雷": "出牌就炸，扣 3 血",
  "定时炸弹": "牌库顶有炸弹",
  "黑白": "跳过回合",
  "跳过": "下回合不能出牌",
  "牛奶": "回血 + 清状态",
  "盾反": "格挡并反弹",
  "水晶盾": "格挡并回血",
  "名刀": "免疫致死伤害",
  "末影龙": "单位",
  "皮卡": "单位",
};

// 🧹 常驻动画已删 → 用文字标签把"身上挂着什么"说清楚
//     bad=对我不利 / good=对我有利 / 普通=中性
function statusTags(list) {
  if (!list || !list.length) return "";
  return list.map(function (s) {
    // 带层数的（"中毒×2"）也能匹配上说明
    const key = Object.keys(STATUS_HINT).find(function (k) { return s.indexOf(k) >= 0; });
    const hint = key ? '<span style="opacity:.72;font-weight:normal">（' + STATUS_HINT[key] + "）</span>" : "";
    return '<span class="tag bad">' + s + hint + "</span>";
  }).join("");
}

// 💣🥔 炸弹 / 地雷 的情况也用文字说明（以前是靠徽章）
function fxSituationTags() {
  if (!S || S.spectator) return "";
  const out = [];
  // 谁手上有炸弹还没处理
  if (S.bombHeld && S.bombHeld.length === 2) {
    if (S.bombHeld[0]) out.push('<span class="tag bad">💣 你手上有定时炸弹，必须处理</span>');
    if (S.bombHeld[1]) out.push('<span class="tag good">💣 对方手上有定时炸弹</span>');
  }
  // 谁牌库顶有炸弹
  if (S.bombOn && S.bombOn.length === 2) {
    const n = (S.timeBombCount || 0) + 1;
    if (S.bombOn[1]) out.push('<span class="tag good">💣 对方牌库顶有炸弹（第 ' + n + " 轮）</span>");
    if (S.bombOn[0]) out.push('<span class="tag bad">💣 你的牌库顶有炸弹（第 ' + n + " 轮）</span>");
  }
  // 谁身上埋着地雷
  if (S.mineOn && S.mineOn.length === 2) {
    if (S.mineOn[1]) out.push('<span class="tag good">🥔 对方身上埋着地雷（出牌就炸）</span>');
    if (S.mineOn[0]) out.push('<span class="tag bad">🥔 你身上埋着地雷（出牌就炸 3 血）</span>');
  }
  return out.join("");
}

// 记住上次渲染的手牌（用来判断"要不要重建 DOM"）
//   ⚠️ 每次 render 都重建的话，选牌时的"已选中"高亮会被冲掉
const handCache = new WeakMap();

function renderHand(container, hand, mine) {
  if (!container) return;
  if (!hand) { container.innerHTML = ""; handCache.set(container, ""); return; }
  // 🔴 签名里要带上"能不能点"的状态：
  //    否则回合切换/被禁出牌时，手牌内容没变 → 走缓存分支 → 变灰状态更新不了
  const interactive = !!(mine && !selectMode && S && S.me &&
    (MY_PLAYER === null || S.current === S.you) &&
    S.me.canPlayThisTurn !== false);
  const sig = (interactive ? "1|" : "0|") + hand.join("\u0001");
  const prev = handCache.get(container);
  // 手牌内容没变 → 不重建，只更新"选中"高亮（这样选牌高亮不会被冲掉）
  if (prev === sig && container.children && container.children.length === hand.length) {
    for (let i = 0; i < hand.length; i++) {
      const el = container.children[i];
      if (!el || !el.classList) continue;
      if (selectMode && selectSel.includes(hand[i])) el.classList.add("selected");
      else el.classList.remove("selected");
    }
    return;
  }
  handCache.set(container, sig);

  container.innerHTML = "";
  for (const name of hand) {
    const c = CARDS[name] || { name, cost: "?", text: "（未知）", kind: "special" };
    const div = document.createElement("div");
    div.className = "card k-" + (c.kind || "special");
    // 选牌模式（弃牌 / 洗牌 / 转转）下，选中的牌高亮
    if (selectMode && selectSel.includes(name)) {
      div.classList.add("selected");
    }
    if (!mine) div.classList.add("dis");
    // 🔴 被禁出牌的回合 / 不是你的回合 → 手牌也变灰（视觉上告诉玩家"现在点没用"）
    //    ⚠️ 只有非选牌模式才变灰，否则弃牌的时候会点不了
    if (mine && !selectMode && S && S.me && !interactive) div.classList.add("dis");
    div.innerHTML = `<div class="cicon">${cardIcon(name, c.kind)}</div>
      <div class="ccost">${c.cost}</div>
      <div class="cname">${name}</div>
      <div class="ctext">${c.text || ""}</div>`;
    if (mine) div.onclick = () => onCardClick(name);
    container.appendChild(div);
  }
}

// 🎨 每张牌的小图标（卡通版：让手牌一眼能认出来）
const CARD_ICON = {
  // 攻击
  "一拳": "👊", "木棍": "🪵", "石头": "🪨", "手术刀": "🔪", "刀": "🗡️", "血刃": "🩸",
  "雪球": "❄️", "闪电": "⚡", "狙击枪": "🎯", "苦无": "✴️", "核弹": "☢️", "天崩地裂": "🌋",
  "斩杀": "💀", "西瓜": "🍉", "转头": "🔄", "溜溜球": "🪀",
  // 防御
  "飞轮": "🌀", "名刀": "⚔️", "圣诞树": "🎄", "盾反": "🛡️", "水晶盾": "💎", "镇定剂": "💉",
  // 治疗
  "牛奶": "🥛", "医疗包": "🩹", "回光返照": "✨", "腐肉": "🍖",
  // 经济
  "胡萝卜": "🥕", "欠钱": "💸", "奖励箱": "🎁", "钻石镐": "⛏️", "转转": "🎡", "转换": "♻️",
  "苦肉计": "😖",
  // 状态
  "毒鸡汤": "🍲", "焚烧": "🔥", "末日": "☄️", "硫酸": "🧪",
  // 控制
  "断头台": "🪓", "黑洞": "🕳️", "弹簧": "🧷", "烟雾弹": "💨", "红绿灯": "🚦",
  "土豆地雷": "🥔", "信": "✉️", "定时炸弹": "💣", "替罪羊": "🐐", "复制": "📋",
  // 过牌 / 特殊
  "无中生有": "🐇", "窥视": "👁️", "战利": "🏆", "抽奖": "🎰", "洗牌": "🔀",
  "嗜血": "🧛", "蓄力": "💪", "兴奋剂": "⚗️", "反甲": "🦔", "幸运儿": "🍀",
  "八音盒": "🎵", "末影龙": "🐉", "皮卡": "⚡",
};
const KIND_ICON = {
  attack: "⚔️", block: "🛡️", heal: "💚", economy: "💰",
  status: "🌀", control: "🎯", unit: "🐾", special: "⭐", draw: "🃏",
};
function cardIcon(name, kind) {
  return CARD_ICON[name] || KIND_ICON[kind] || "🃏";
}

// 🎨 分层界面：更新顶栏"回合提示条"+ 主操作按钮
function fxTurnBar() {
  const bar = document.getElementById("turnbar");
  const txt = document.getElementById("turnText");
  const btnStart = document.getElementById("btnStart");
  const btnEnd = document.getElementById("btnEndTurn");
  if (!bar || !txt) return;

  if (!S) {
    bar.className = "turnbar";
    txt.textContent = "未开始";
    if (btnStart) btnStart.style.display = "";
    if (btnEnd) btnEnd.style.display = "none";
    return;
  }
  const spectating = !!S.spectator;
  const dual = !spectating && (MY_PLAYER === null);
  const iAm = spectating ? -1 : (dual ? S.you : MY_PLAYER);
  const myTurn = !spectating && (S.current === iAm);

  if (S.phase === "ended") {
    bar.className = "turnbar";
    txt.textContent = (S.winner === undefined || S.winner === null)
      ? "对局结束" : ((S.winner === iAm) ? "🏆 你赢了！" : "💀 你输了");
  } else if (spectating) {
    bar.className = "turnbar";
    txt.textContent = "👁 观战 · 现在是玩家" + (S.current + 1) + "的回合";
  } else if (dual) {
    bar.className = "turnbar mine";
    txt.textContent = "🎮 双控 · 玩家" + (S.current + 1) + "的回合";
  } else if (myTurn) {
    // ⚠️ "轮到你了"要区分"能出牌"和"被禁出牌"（否则玩家会以为卡死了）
    if (S.me && S.me.canPlayThisTurn === false) {
      bar.className = "turnbar theirs";
      txt.textContent = "⛔ 你这回合不能出牌（点【结束回合】）";
    } else {
      bar.className = "turnbar mine";
      txt.textContent = "✨ 轮到你了！";
    }
  } else {
    bar.className = "turnbar theirs";
    txt.textContent = "⏳ 等对方出牌…";
  }

  // 📖 公共牌库计数（双方共用一副，所以只显示一个）
  const sd = document.getElementById("sharedDeck");
  if (sd) {
    if (S && S.me && typeof S.me.deckCount === "number") {
      sd.textContent = "📚 牌库 " + S.me.deckCount;
      sd.style.display = "";
    } else {
      sd.style.display = "none";
    }
  }

  // 主操作：开局前显示"开始游戏"，开局后显示"结束回合"
  if (btnStart) btnStart.style.display = (S.phase === "playing" && !spectating) ? "none" : "";
  if (btnEnd) {
    btnEnd.style.display = (S.phase === "playing" && !spectating) ? "" : "none";
    // ⚠️ 不要用 canPlay 来判禁用！
    //    被禁出牌的回合（烟雾弹/狙击枪/断头台）本来就不能出牌，
    //    如果这里也禁用，玩家就**没有任何按钮可点**了（实测卡死在这）
    //    → 只要求"轮到我 + 没有待处理窗口"
    btnEnd.disabled = !(myTurn || dual) || !!S.pending;
  }
}

function render() {
  if (!S) return;
  const me = S.me, opp = S.opp;

  // 🎨 卡通版：把"轮到谁"做在面板和标题点上
  const myTurnNow = (S.current === S.you);
  $("meTitle").innerHTML = me.name + (myTurnNow ? " ← 你的回合" : "");
  $("oppTitle").innerHTML = (S.ai && S.ai.on ? "🤖 " : "") + opp.name + (!myTurnNow ? " ← 他的回合" : "");
  const mp = $("mePanel"), op = $("oppPanel");
  if (mp) mp.classList.toggle("cur", myTurnNow);
  if (op) op.classList.toggle("cur", !myTurnNow);
  fxTurnBar();

  // 血量（新 UI：低了会变红闪）
  fxHpTick("me", me.hp);
  fxHpTick("opp", opp.hp);
  // 🧹 常驻动画删除后 → 用文字把"身上挂着什么"说清楚（带含义说明）
  //    对方的面板显示"对方视角"的状态，我的显示我的
  $("meInfo").innerHTML = statLine(me, true) + (me.statuses && me.statuses.length ? "<br>" + statusTags(me.statuses) : "");
  $("oppInfo").innerHTML = statLine(opp, false) + (opp.statuses && opp.statuses.length ? "<br>" + statusTags(opp.statuses) : "");
  // 💣🥔 炸弹 / 地雷的情况（以前是徽章，现在是文字）
  const sit = fxSituationTags();
  if (sit) $("meInfo").innerHTML += "<br>" + sit;
  // 自己在牌库顶的炸弹也给对方看得到（对方面板显示"他牌库顶有炸弹"）
  if (S.bombOn && S.bombOn[1] && !S.spectator) {
    $("oppInfo").innerHTML += '<br><span class="tag good">💣 他牌库顶有炸弹</span>';
  }
  if (S.mineOn && S.mineOn[1] && !S.spectator) {
    $("oppInfo").innerHTML += '<br><span class="tag good">🥔 他身上埋着地雷</span>';
  }

  // 单位
  if (me.units && me.units.length) $("meInfo").innerHTML += "<br>单位：" + me.units.map((u) => `${u.name}(${u.hp}血/${u.atk}伤)`).join("、");
  if (opp.units && opp.units.length) $("oppInfo").innerHTML += "<br>单位：" + opp.units.map((u) => `${u.name}(${u.hp}血/${u.atk}伤)`).join("、");

  // 我是谁：
  //   观战者 → 两边手牌都能看，但不能操作
  //   网址带 ?p=1 / ?p=2 → 我就看自己的手牌
  //   都没有 → 双控模式
  const spectating = !!(S.spectator);
  const dual = !spectating && (MY_PLAYER === null);
  const iAm = spectating ? -1 : (dual ? S.you : MY_PLAYER);

  const myHand = spectating
    ? (bothHands ? bothHands[0] : me.hand)
    : (dual ? myEntry(iAm) : me.hand);
  const oppHand = (spectating || dual) ? (bothHands ? bothHands[spectating ? 1 : (1 - S.you)] : null) : null;
  const myTurn = !spectating && (S.current === iAm);

  if (spectating) {
    $("mode").textContent = "👁 观战模式（能看到双方手牌，不能操作）";
    $("meTitle").textContent = me.name + "（玩家1）" + (S.current === 0 ? " ← 他的回合" : "");
    $("oppTitle").textContent = opp.name + "（玩家2）" + (S.current === 1 ? " ← 他的回合" : "");
    $("meTitle").className = S.current === 0 ? "cur" : "";
    $("oppTitle").className = S.current === 1 ? "cur" : "";
  } else {
    $("mode").textContent = dual
      ? "当前身份：双控模式（两边都能操作）"
      : (iAm === 0 ? "当前身份：玩家1" + (myTurn ? " ← 你的回合" : "（等对方）")
        : "当前身份：玩家2" + (myTurn ? " ← 你的回合" : "（等对方）"));
  }

  // 🔴 判断手牌能不能点：
  //    ① 轮到我、没有待决策、游戏进行中 → 能点（点 = 出牌）
  //    ② 有"要我从手牌里选几张"的待决策（弃牌/洗牌/转转）→ 也能点（点 = 选中）
  //    ③ 观战 → 一律不能点
  const selecting = (selectMode === "discard" || selectMode === "mulligan" || selectMode === "spinner");
  const canClickHand = !spectating && ((myTurn && !S.pending && S.phase === "playing") || selecting);
  renderHand($("meHand"), myHand, canClickHand);
  renderHand($("oppHand"), oppHand, false);
  // 观战时，两边的牌都要能看清（不要变灰）
  if (spectating) {
    for (const el of $("meHand").children) if (el.classList) el.classList.remove("dis");
  }

  // 观战者：身份切换按钮和重置要藏起来
  //   ⚠️ 不要碰 btnStart / btnEndTurn —— 它们的显示由 fxTurnBar() 管
  for (const id of ["btnReset", "btnAsP1", "btnAsP2", "btnAsDual", "btnDummyMode", "btnCheatMode"]) {
    const el = $(id);
    if (el) el.style.display = spectating ? "none" : "";
  }

  // 日志（新 UI：战报在底部抽屉里）
  const logEl = $("log");
  logEl.innerHTML = (S.log || []).map((l) => `<div>${l}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;
  if (typeof window.__dockPing === "function") window.__dockPing();

  // 🎬 演出：按服务器的"演出事件"播动画
  //    （只有真打中才播，被格挡只播一个小提示）
  fxProcessEvents(S.fx, iAm);
  // 🩸 谁死了 → 把那一方的框切成两半
  fxCheckDeath(S.dead, iAm);
  // 🎨 把双方状态同步给"框内特效"
  fxSyncStatus({
    opp: (S.opp.statuses || []).filter((x) => STATUS_NAMES.indexOf(String(x).replace(/[（(].*$/, "")) >= 0),
    me: (S.me.statuses || []).filter((x) => STATUS_NAMES.indexOf(String(x).replace(/[（(].*$/, "")) >= 0),
  });
  // 💣 定时炸弹徽章（常驻显示在"牌库顶有炸弹"那一方的面板上）
  fxSyncBomb(iAm);
  // 🥔 土豆地雷徽章（常驻显示在"被埋雷"那一方的面板上）
  fxSyncMine(iAm);
  // 😈 作弊开关状态同步
  if (typeof window.__cheatSync === "function" && S.cheat !== undefined) {
    window.__cheatSync(!!S.cheat);
  }

  // 🐉 场上的单位（末影龙 / 皮卡…）→ 常驻显示在各自框的上边缘
  if (typeof FX !== "undefined" && FX.syncUnits) {
    try {
      FX.syncUnits({
        me: (S.me.units || []).map((u) => ({ name: u.name, hp: u.hp, atk: u.atk })),
        opp: (S.opp.units || []).map((u) => ({ name: u.name, hp: u.hp, atk: u.atk })),
      });
    } catch (e) { dbg("单位显示出错: " + e.message); }
  }

  // 结束提示
  if (S.phase === "ended") {
    showResult();
  } else {
    hideResult();
    renderPrompt();
  }

  // ⚠️ 同样：这里也不能用 canPlay 判禁用（被禁出牌的回合还要能点"结束回合"）
  $("btnEndTurn").disabled = !(S.current === S.you && !S.pending && S.phase === "playing");
}

// ---------- 胜负结算画面 ----------
let resultShownFor = null;
function showResult() {
  const iAm = S.you;
  if (resultShownFor === S.winner) return; // 已经显示过，别重复弹
  resultShownFor = S.winner;

  const win = (S.winner === iAm);
  const box = $("result");
  const spectating = !!S.spectator;

  if (spectating) {
    box.className = "win";
    $("resTitle").textContent = "🏆 玩家" + (S.winner + 1) + " 获胜";
    $("resSub").textContent = "（你在观战）";
  } else {
    box.className = win ? "win" : "lose";
    $("resTitle").textContent = win ? "🏆 胜利！" : "💀 失败";
    $("resSub").textContent = win ? (S.opp.name + " 被打倒了") : (S.me.name + " 被打倒了");
  }

  const me = S.me, opp = S.opp;
  // 找出最后一条"游戏结束"的日志，当作死因
  const last = (S.log || []).filter((l) => l.includes("游戏结束")).pop() || "";
  const reason = last.replace(/^.*游戏结束：/, "").trim();

  $("resStats").innerHTML =
    `${me.name}（玩家1）：<b>${me.hp}</b> 血　手牌 <b>${me.hand.length}</b> 张<br>` +
    `${opp.name}（玩家2）：<b>${opp.hp}</b> 血　手牌 <b>${opp.handCount}</b> 张<br>` +
    `共打了 <b>${S.turn}</b> 个回合` +
    (reason ? `<br><span style="color:#aaa">结局：${reason}</span>` : "");

  $("overlay").classList.add("show");
}
function hideResult() {
  $("overlay").classList.remove("show");
  resultShownFor = null;
}
window.hideResult = hideResult;

// ---------- 待决策提示 ----------
let promptHTML = "";
function setPrompt(html) {
  promptHTML = html;
  const el = $("prompt");
  if (html) { el.style.display = "block"; el.innerHTML = html; }
  else { el.style.display = "none"; el.innerHTML = ""; }
}

function renderPrompt() {
  const pd = S.pending;
  // 观战者：只显示"谁在做什么"，不显示操作按钮
  if (S.spectator) {
    if (!pd) { setPrompt(""); return; }
    const who = (pd.player !== undefined ? pd.player : pd.defender);
    const names = ["玩家1", "玩家2"];
    const kindName = {
      block: "正在决定要不要格挡",
      discard_to_limit: "正在选牌弃掉",
      timebomb: "抽到了定时炸弹，正在处理",
      mulligan: "正在用洗牌换牌",
      spinner: "正在用转转丢牌换能量",
      convert: "正在用转换",
      blackhole: "正在用黑洞拆牌",
      trophy: "正在用战利选牌",
      peek: "正在用窥视看手牌",
      letter: "正在用信塞牌",
      scapegoat: "正在用替罪羊捞牌",
      copy: "正在用复制",
      spring: "正在决定要不要用弹簧",
      choice_block: "正在决定要不要丢牌抵挡",
    }[pd.kind] || pd.kind;
    setPrompt(`<h3>👁 ${names[who] || "某方"} ${kindName}…</h3>`);
    return;
  }
  // 🔴 没有待决策了 → 清掉弹窗和"选牌模式"（否则弹窗会一直挂在屏幕上）
  if (!pd) {
    if (selectMode) setSelectMode(null, 0);
    setPrompt("");
    return;
  }
  const me = S.me;
  // 双控模式：S.you 永远是 0（服务器发的玩家1视角）；固定身份：S.you 就是自己
  const iAm = S.you;
  const myEntry = (idx) => (bothHands ? (bothHands[idx] || []) : me.hand);

  // 定时炸弹：抽到的人必须处理
  //   📖 规则（设计文档）：打回去要付能量，费用每次 +1；付不起就只能丢掉吃 6 点
  if (pd.kind === "timebomb") {
    if (pd.player !== iAm) { setPrompt(`<h3>对方抽到了定时炸弹，等他处理…</h3>`); return; }
    const cnt = (S.timeBombCount || 0) + 1;              // 这是第几轮
    const cost = 3 + Math.max(0, S.timeBombCount || 0);   // 和引擎 timeBombCost 一致
    const lucky = (S.me.statuses || []).some((s) => String(s).indexOf("幸运儿") >= 0);
    const realCost = lucky ? cost / 2 : cost;
    const canPay = S.me.energy >= realCost;
    let html = `<h3>💣 你抽到了【定时炸弹】—— 必须选一个</h3>`;
    html += `<div style="font-size:12.5px;color:#7a6040;margin-bottom:8px">` +
      `这是第 <b>${cnt}</b> 轮 · 打回去要 <b>${realCost}</b> 能量（你还有 ${S.me.energy}）` +
      (lucky ? "（幸运儿减半）" : "") + `</div>`;
    if (canPay) {
      html += `<button class="primary" onclick="doResolve({choice:'play'})">打出去（花 ${realCost} 能量，放到对方牌库顶）</button>`;
    } else {
      html += `<div style="color:#a02038;font-weight:bold;margin-bottom:8px">` +
        `⛔ 能量不够（要 ${realCost}，只有 ${S.me.energy}）→ 只能丢掉</div>`;
    }
    html += `<button class="danger" onclick="doResolve({choice:'discard'})">丢掉它（自己吃 6 点伤害）</button>`;
    setPrompt(html);
    return;
  }

  // 🔥 焚烧：额外丢 1 张（自选）或吃 2 点
  //   📖 设计文档第 139 / 293 行：「每回合须额外丢 1 张牌（丢哪张由本人自选），否则扣 2 血」
  if (pd.kind === "burn_discard") {
    if (pd.player !== iAm) { setPrompt(`<h3>对方中了焚烧，正在决定丢哪张牌…</h3>`); return; }
    const hand = myEntry(iAm);
    let html = `<h3>🔥 焚烧：你必须额外丢 1 张牌（自选）</h3>`;
    html += `<div style="color:#7a6040;margin-bottom:8px">不想丢也可以 —— 那就直接吃 2 点伤害</div>`;
    html += `<div>` + hand.map((n) =>
      `<button class="primary" style="margin:2px;padding:6px 12px" onclick="doResolve({card:'${n}'})">丢【${n}】</button>`
    ).join(" ") + `</div>`;
    html += `<div style="margin-top:12px">
      <button class="danger" style="padding:10px 20px;font-size:15px" onclick="doResolve({card:null})">不丢，吃 2 点伤害</button>
    </div>`;
    setPrompt(html);
    return;
  }

  // 回合结束：弃牌到上限（自己选）
  if (pd.kind === "discard_to_limit") {
    if (pd.player !== iAm) { setPrompt(`<h3>对方要弃牌（${pd.count} 张），等他选…</h3>`); return; }
    // 🔴 兜底：不管之前是什么状态，每次渲染都用 pending 里的数字重建
    if (selectMode !== "discard" || selectNeed !== pd.count) {
      setSelectMode("discard", pd.count);
    }
    // 过滤掉已经不在手上的牌（防止选中列表和实际手牌不同步）
    const hand = myEntry(iAm);
    selectSel = selectSel.filter((n) => hand.includes(n));

    let html = `<h3>手牌超过上限 ${pd.limit} —— 请选 <b>${pd.count}</b> 张弃掉（<span id="selCount">已选 ${selectSel.length}/${pd.count}</span>）</h3>`;
    html += `<div style="color:#bbb;margin-bottom:8px">👉 点下面的按钮，或者点上面的手牌，都能选</div>`;
    html += `<div>` + hand.map((n, i) =>
      `<button id="dlb${i}" class="${selectSel.includes(n) ? "primary" : ""}" style="margin:2px;padding:6px 12px" onclick="pickDiscard(${i})">${n}</button>`
    ).join(" ") + `</div>`;
    html += `<div style="margin-top:12px">
      <button class="primary" style="padding:10px 20px;font-size:15px" onclick="doDiscardToLimit()">✔ 确定弃牌</button>
      <button style="margin-left:10px" onclick="autoDiscard()">随便帮我弃 ${pd.count} 张</button>
    </div>`;
    setPrompt(html);
    return;
  }

  if (selectMode === "discard") setSelectMode(null, 0);

  // 弹簧：对方打出了牌，你可以用弹簧取消它
  if (pd.kind === "spring") {
    if (pd.defender !== iAm) { setPrompt(`<h3>对方打出了【${pd.cardName}】，等他决定要不要用弹簧…</h3>`); return; }
    setPrompt(`<h3>🌀 对方打出了【${pd.cardName}】—— 要用【弹簧】取消它吗？</h3>
      <div style="color:#bbb">用掉弹簧（${pd.cost} 费）→ 那张牌回到他手上，他的能量白花</div>
      <div style="margin-top:6px">
        <button class="primary" onclick="doResolve({use:true})">用弹簧取消它</button>
        <button onclick="doResolve({use:false})">不用，让它生效</button>
      </div>`);
    return;
  }

  if (pd.kind === "block" && pd.defender === iAm) {
    // 📖 设计文档：名刀是"反应式：在即将受到致死伤害的那一下打出，不能提前挂"
    //    （第 156 / 321 行）→ 所以只有这一下**会打死你**的时候才给名刀选项
    const lethal = (pd.amount || 0) >= S.me.hp;
    const opts = myEntry(iAm).filter((n) => {
      const c = CARDS[n];
      if (!c) return false;
      if (c.effect === "block_lethal") return lethal;      // 名刀：只在致死时可用
      return ["block_one", "block_draw", "block_reflect", "block_heal"].includes(c.effect);
    });
    let html = `<h3>对方打出了攻击（${pd.amount} 点伤害 · ${pd.reason || ""}）—— 要用格挡牌吗？</h3>`;
    if (lethal) {
      html += `<div style="color:#a02038;font-weight:bold;margin-bottom:6px">☠️ 这一下会打死你（你只有 ${S.me.hp} 血）</div>`;
    } else {
      const hasMingdao = myEntry(iAm).some((n) => CARDS[n] && CARDS[n].effect === "block_lethal");
      if (hasMingdao) {
        html += `<div style="font-size:12px;color:#7a6040;margin-bottom:6px">` +
          `（名刀要留到"会打死你的那一下"才能用，现在用不了）</div>`;
      }
    }
    html += `<button onclick="doBlock(null)">不挡，吃伤害</button> `;
    for (const n of opts) {
      const c = CARDS[n];
      html += `<button class="primary" onclick="doBlock('${n}')">${n}（${c.cost} 费）</button> `;
    }
    setPrompt(html);
    return;
  }

  if (pd.kind === "choice_block" && pd.defender === iAm) {
    const hand = myEntry(iAm);
    let html = `<h3>对方用【刀】打你 ${pd.amount} 点 —— 丢一张牌抵挡？（消耗那张牌）</h3>`;
    html += `<button onclick="doChoiceBlock(null)">不丢，吃伤害</button> `;
    for (const n of hand) html += `<button class="primary" onclick="doChoiceBlock('${n}')">丢【${n}】</button> `;
    setPrompt(html);
    return;
  }

  if (pd.kind === "blackhole" && pd.player === iAm) {
    const target = bothHands ? bothHands[1 - iAm] : [];
    let html = `<h3>黑洞：选择要抽掉的 3 张（对方手牌）</h3>`;
    html += `<div id="bhList">` + target.map((n, i) => `<button id="bh${i}" onclick="toggleBH(${i},'${n}')">${n}</button>`).join(" ") + `</div>`;
    html += `<div style="margin-top:6px"><button class="primary" onclick="doBlackhole()">确定</button></div>`;
    window.__bhTarget = target;
    window.__bhSel = [];
    setPrompt(html);
    return;
  }

  if (pd.kind === "trophy" && pd.player === iAm) {
    const p = S.me;
    setPrompt(`<h3>战利：从牌库顶选一张</h3><div>牌库顶的牌对你自己是已知的（本测试版不显示内容，直接点"拿第一张"）</div>
      <button class="primary" onclick="doResolve({take:null})">拿第一张</button>`);
    return;
  }

  if (pd.kind === "peek" && pd.player === iAm) {
    const t = bothHands ? bothHands[1 - iAm] : [];
    setPrompt(`<h3>窥视：对方手牌</h3><div>${t.map((n) => `<span class="tag">${n}</span>`).join("")}</div>
      <button class="primary" onclick="doResolve({})">知道了</button>`);
    return;
  }

  if (pd.kind === "mulligan" && pd.player === iAm) {
    if (selectMode !== "mulligan") setSelectMode("mulligan", 3);
    let html = `<h3>洗牌：选 3 张丢掉（<span id="selCount">已选 ${selectSel.length}/3</span>）</h3>`;
    html += `<div style="color:#bbb;margin-bottom:6px">👉 直接点下面的手牌来选（要选满 3 张）</div>`;
    html += `<button class="primary" onclick="doMulligan()">确定换牌</button>`;
    setPrompt(html);
    return;
  }

  if (pd.kind === "spinner" && pd.player === iAm) {
    if (selectMode !== "spinner") setSelectMode("spinner", 99);
    // ⚠️ 同名的手牌用"名字+序号"区分，这样才能一次丢两张同名
    const hand = myEntry(iAm);
    let html = `<h3>转转：选要丢的牌（<span id="selCount">已选 ${selectSel.length} 张</span>，每丢 1 张 +3 能量）</h3>`;
    if (S.me.energy >= S.me.maxEnergy) {
      html += `<div style="color:#faa;margin-bottom:4px">⚠️ 你的能量已经满了（${S.me.energy}/${S.me.maxEnergy}），再丢牌也拿不到能量</div>`;
    }
    html += `<div style="color:#bbb;margin-bottom:6px">👉 直接点下面的手牌来选（不想丢就点确定）</div>`;
    html += `<button class="primary" onclick="doSpinner()">确定</button>`;
    setPrompt(html);
    return;
  }

  if (selectMode && selectMode !== "discard") setSelectMode(null, 0);

  if (pd.kind === "timebomb") {
    // 💣 抽到定时炸弹 → 先来一下警示动画（只播一次）
    fxBombWarnIfNeeded(pd, iAm);
    // 费用：基础 3，每被传一轮 +1（引擎里按 timeBombCount 递增）
    const cnt = (S.timeBombCount || 0) + 1;
    const cost = 3 + Math.max(0, cnt - 1);
    if (pd.player === iAm) {
      setPrompt(`<h3 style="color:#f88">💣 你抽到了【定时炸弹】！必须马上处理</h3>
        <div style="color:#fbb;margin-bottom:8px">这是第 <b>${cnt}</b> 轮 —— 打回去要花 <b>${cost}</b> 能量（每轮 +1），它会回到对方牌库顶</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="primary" onclick="doResolve({choice:'play'})">打回去（花 ${cost} 能量）</button>
          <button class="danger" onclick="doResolve({choice:'discard'})">丢掉它（自己吃 6 点伤害）</button>
        </div>
        <div style="color:#888;font-size:12px;margin-top:6px">💡 打回去不掉血，但费用会越来越高；丢掉立刻吃 6 点</div>`);
      return;
    }
    setPrompt(`<h3 style="color:#f88">💣 对方抽到了【定时炸弹】，正在决定怎么处理…</h3>`);
    return;
  }

  if (pd.kind === "convert" && pd.player === iAm) {
    setPrompt(`<h3>转换：血 ⇄ 能量（1:1）</h3>
      <div>你的血：${S.me.hp}　能量：${S.me.energy}</div>
      <div style="margin-top:6px">
        转换量：<input id="cvAmt" type="number" value="3" min="0" step="0.5" style="width:70px">
        <button class="primary" onclick="doConvert('hp2energy')">血 → 能量</button>
        <button class="primary" onclick="doConvert('energy2hp')">能量 → 血</button>
        <button onclick="doResolve({amount:0})">不用</button>
      </div>`);
    return;
  }

  if (pd.kind === "letter" && pd.player === iAm) {
    const hand = myEntry(iAm).filter((n) => n !== "信");
    let html = `<h3>信：选一张牌，和"信"一起放到对方牌库顶</h3>`;
    for (const n of hand) if (n !== "信") html += `<button class="primary" onclick="doResolve({card:'${n}'})">${n}</button> `;
    html += `<button onclick="doResolve({})">不放</button>`;
    setPrompt(html);
    return;
  }

  if (pd.kind === "scapegoat" && pd.player === iAm) {
    let html = `<h3>替罪羊：从共用弃牌堆捞回 1 张（本回合扔进去的）</h3>`;
    const recent = (S.log || []).length;
    html += `<div>（本测试版：直接输入牌名）<input id="sgName" style="width:120px">
      <button class="primary" onclick="doResolve({card:document.getElementById('sgName').value})">捞回</button>
      <button onclick="doResolve({})">不用</button></div>`;
    setPrompt(html);
    return;
  }

  if (pd.kind === "copy" && pd.player === iAm) {
    const played = (S.me.playedNames || []);
    setPrompt(`<h3>复制：本回合打过的牌（本测试版：输入牌名）</h3>
      <input id="cpName" style="width:120px">
      <button class="primary" onclick="doResolve({card:document.getElementById('cpName').value})">复制</button>
      <button onclick="doResolve({})">不用</button>`);
    return;
  }

  // 不是你要处理的
  setPrompt(`<h3>等待对方处理…</h3><div>待决策：${pd.kind}</div>`);
}

// ---------- 操作 ----------
// 选牌模式：当有"需要你从手牌里挑几张"的弹窗时，
// 直接点手牌 = 选中（而不是"出牌"），避免误操作把弹窗顶掉
let selectMode = null;   // null | "discard" | "mulligan" | "spinner"
let selectSel = [];
let selectNeed = 0;

function setSelectMode(mode, need) {
  const changed = (selectMode !== mode) || (selectNeed !== need);
  selectMode = mode; selectSel = []; selectNeed = need;
  // ⚠️ 关键修复：手牌是在 renderPrompt() 之前渲染的，
  //    所以这里改了 selectMode 之后，必须重新渲染手牌，
  //    否则手牌会停留在"灰色不能点"的状态（转转/洗牌/弃牌的 bug）
  if (changed) {
    try {
      if (S && S.me) {
        const spectating = (S.you === -1);
        const myTurn = (S.current === S.you);
        const selecting = (mode === "discard" || mode === "mulligan" || mode === "spinner");
        const canClickHand = !spectating && ((myTurn && !S.pending && S.phase === "playing") || selecting);
        renderHand($("meHand"), S.me.hand || [], canClickHand);
      }
    } catch (e) { dbg("重画手牌出错: " + e.message); }
  }
}

function onCardClick(name) {
  // 选牌模式：点击 = 选中/取消
  if (selectMode) {
    const i = selectSel.indexOf(name);
    if (i >= 0) selectSel.splice(i, 1);
    else {
      if (selectSel.length >= selectNeed) {
        dbg(`选牌：${name} 已选满 ${selectNeed} 张，忽略`);
        return;
      }
      selectSel.push(name);
    }
    dbg(`选牌 ${selectMode}: [${selectSel.join(",")}] (${selectSel.length}/${selectNeed})`);
    render();
    return;
  }
  // 🔴 有还没处理的弹窗时，不要把手牌当成"出牌"发出去
  //    （否则服务器会回一句错误，把弹窗顶掉，玩家就卡住了）
  if (S && S.pending) {
    dbg("有弹窗待处理（" + (S.pending.kind) + "），点牌被忽略");
    return;
  }
  // 🔴 被禁出牌的回合（烟雾弹/狙击枪/断头台）：直接拦下来，别发给服务器
  //    ⚠️ 之前不拦 → 服务器反复回 "本回合不能出牌" → 界面看起来像卡死了
  //       （用户实测卡在回合 5 出不去，其实是"不能出牌但没提示"）
  if (S && S.me && S.me.canPlayThisTurn === false) {
    setPrompt('<h3>⛔ 你这回合被禁止出牌</h3>' +
      '<div style="color:#7a6040;margin-bottom:8px">（对方用了【烟雾弹】/【狙击枪】/【断头台】这类牌）' +
      '<br>你只能<b>结束回合</b>，或者用"格挡牌"应对对方的攻击</div>' +
      '<button class="primary" onclick="send({type:\'endTurn\'})">⏭ 结束回合</button>');
    if (typeof FX !== "undefined" && FX.shake) FX.shake("light");
    dbg("本回合被禁止出牌 → 已拦截，没有发给服务器");
    return;
  }
  // 🔴 不是你的回合：也拦下来
  if (S && S.current !== S.you && MY_PLAYER !== null) {
    dbg("还没轮到你（当前是玩家" + (S.current + 1) + "）→ 点牌被忽略");
    return;
  }
  const c = CARDS[name];
  if (!c) return;
  if (c.cost === "X") {
    const v = prompt(`【${name}】要花多少能量？（当前 ${S.me.energy} 能量）`, "3");
    if (v === null) return;
    send({ type: "play", card: name, x: Number(v) });
    return;
  }
  if (c.cost === "X+1") {
    const v = prompt(`【${name}】要复制哪张牌（输入牌名）`, "");
    if (!v) return;
    send({ type: "play", card: name, x: Number(CARDS[v] ? CARDS[v].cost : 0) });
    return;
  }
  send({ type: "play", card: name });
}
window.onCardClick = onCardClick;

function updateSelectUI() {
  const label = `已选 ${selectSel.length}/${selectNeed}`;
  const el = document.getElementById("selCount");
  if (el) el.textContent = label;
}

function doBlock(name) { send({ type: "resolve", block: name }); }
function doChoiceBlock(name) { send({ type: "resolve", discardCard: name }); }
function doResolve(o) { send(Object.assign({ type: "resolve" }, o)); }
function doMulligan() {
  if (selectSel.length !== 3) {
    setPrompt(`<h3 style="color:#f88">洗牌要正好选 3 张（现在 ${selectSel.length} 张）</h3>
      <div style="color:#bbb">直接点下面的手牌来选</div>`);
    return;
  }
  const picked = selectSel.slice();
  setSelectMode(null, 0);
  send({ type: "resolve", discard: picked });
}
function doSpinner() {
  const picked = selectSel.slice();
  setSelectMode(null, 0);
  send({ type: "resolve", discard: picked });
}
function doBlackhole() { send({ type: "resolve", take: window.__bhSel }); }
function doConvert(dir) { send({ type: "resolve", direction: dir, amount: Number($("cvAmt").value) }); }
// 弹窗里的"点按钮选牌"
function pickDiscard(i) {
  const pd = S && S.pending;
  if (!pd || pd.kind !== "discard_to_limit") return;
  const dual = (MY_PLAYER === null);
  const iAm = S.you;
  const hand = dual ? (bothHands ? bothHands[iAm] : S.me.hand) : S.me.hand;
  const name = hand[i];
  if (name === undefined) return;
  const idx = selectSel.indexOf(name);
  if (idx >= 0) selectSel.splice(idx, 1);
  else {
    if (selectSel.length >= selectNeed) return;
    selectSel.push(name);
  }
  dbg(`弹窗选牌 ${name}: [${selectSel.join(",")}] (${selectSel.length}/${selectNeed})`);
  renderPrompt();
  render();
}
window.pickDiscard = pickDiscard;

// 兜底：让程序随便帮你弃够张数（卡住的时候点这个）
function autoDiscard() {
  const pd = S && S.pending;
  if (!pd || pd.kind !== "discard_to_limit") return;
  const dual = (MY_PLAYER === null);
  const iAm = S.you;
  const hand = dual ? (bothHands ? bothHands[iAm] : S.me.hand) : S.me.hand;
  const pick = hand.slice(0, pd.count);
  dbg("自动弃牌: " + pick.join(","));
  send({ type: "resolve", discard: pick });
}
window.autoDiscard = autoDiscard;

function doDiscardToLimit() {
  dbg(`确定弃牌：已选 [${selectSel.join(",")}] 需要 ${selectNeed}`);
  if (selectSel.length !== selectNeed) {
    setPrompt(`<h3 style="color:#f88">还要再选 ${selectNeed - selectSel.length} 张（已选 ${selectSel.length}/${selectNeed}）</h3>
      <div style="color:#bbb">直接点下面的手牌来选</div>`);
    return;
  }
  const picked = selectSel.slice();
  setSelectMode(null, 0);
  send({ type: "resolve", discard: picked });
}

window.doBlock = doBlock; window.doChoiceBlock = doChoiceBlock; window.doResolve = doResolve;
window.doMulligan = doMulligan; window.doSpinner = doSpinner; window.doBlackhole = doBlackhole;
window.doConvert = doConvert; window.doDiscardToLimit = doDiscardToLimit;

function toggleBH(i, n) {
  const idx = window.__bhSel.indexOf(n);
  if (idx >= 0) window.__bhSel.splice(idx, 1); else window.__bhSel.push(n);
  document.getElementById("bh" + i).style.background = idx >= 0 ? "" : "#2d6cdf";
}
window.toggleBH = toggleBH;

// ---------- 按钮 ----------
$("btnStart").onclick = () => {
  hideResult();
  fxOnGameStart();
  send({ type: "start", player: MY_PLAYER !== null ? MY_PLAYER : 0 });
};
$("btnAgain").onclick = () => {
  hideResult();
  fxOnGameStart();
  send({ type: "start", player: MY_PLAYER !== null ? MY_PLAYER : 0 });
};
$("btnCloseResult").onclick = () => { $("overlay").classList.remove("show"); };
$("btnEndTurn").onclick = () => { send({ type: "endTurn" }); };
$("btnReset").onclick = async () => {
  try { await fetch("/reset"); } catch (e) { }
  S = null; bothHands = null;
  hideResult();
  setPrompt('<h3>已重置 —— 点【▶ 开始游戏】开一局</h3>');
  if (typeof window.__closeDrawer === "function") window.__closeDrawer();
  if (typeof fxTurnBar === "function") fxTurnBar();
  $("meInfo").innerHTML = ""; $("oppInfo").innerHTML = "";
  $("meHand").innerHTML = ""; $("oppHand").innerHTML = "";
  $("log").innerHTML = "";
};

// 切换身份：关掉旧连接，按新身份重连
function becomePlayer(who) {
  MY_PLAYER = who;
  if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } }
  S = null; bothHands = null;
  hideResult();
  const label = who === 0 ? "玩家1" : (who === 1 ? "玩家2" : "双控模式");
  setPrompt(`<h3>已切换为【${label}】—— 点【开始新游戏】开一局</h3>`);
  $("meInfo").innerHTML = ""; $("oppInfo").innerHTML = "";
  $("meHand").innerHTML = ""; $("oppHand").innerHTML = "";
  $("log").innerHTML = "";
  $("mode").textContent = "当前身份：" + label;
  setTimeout(connect, 200);
}
$("btnAsP1").onclick = () => becomePlayer(0);
$("btnAsP2").onclick = () => becomePlayer(1);
$("btnAsDual").onclick = () => becomePlayer(null);

// ============================================================
// 🎯 木桩模式 / 😈 作弊模式 —— 上面那排按钮直接切
// ============================================================
// ⚠️ 木桩模式的状态放在这个全局变量里（唯一来源）。
//    之前 modeButtons 里的 refresh() 和 dummyMode 里的 buildUI() 各自维护
//    一份"显示/隐藏"，两边打架 → 点了按钮，按钮排还是不显示。
let fxDummyModeOn = false;
let fxCheatModeOn = false;
function fxApplyDummyVisibility() {
  // 按钮排：木桩模式开着才显示
  var dm = document.getElementById("dummyBox");
  if (dm && dm.style) dm.style.display = fxDummyModeOn ? "inline-flex" : "none";
  // 顶栏那颗木桩按钮：亮/灭
  var d = document.getElementById("btnDummyMode");
  if (d && d.classList && typeof d.classList.toggle === "function") d.classList.toggle("on", fxDummyModeOn);
  // 作弊标记
  var q = document.getElementById("cheatFlag");
  if (q && q.style) q.style.display = fxCheatModeOn ? "inline" : "none";
}

// 🤖 AI 模式（设置抽屉里的按钮）
let fxAiOn = false;
let fxAiDiff = "normal";
(function aiButtons() {
  var b = document.getElementById("btnAiMode");
  if (b) {
    b.onclick = function () {
      fxAiOn = !fxAiOn;
      send({ type: "changeMode", mode: fxAiOn ? "ai" : "pvp", diff: fxAiDiff });
      if (typeof window.__closeDrawer === "function") window.__closeDrawer();
      setPrompt(fxAiOn
        ? "<h3>🤖 和电脑打（难度：" + ({ easy: "简单", normal: "普通", hard: "困难" }[fxAiDiff] || fxAiDiff) + "）</h3>"
        : "<h3>已切回真人对战 —— 点右上角【▶ 开始游戏】开一局</h3>");
      refreshAiButtons();
    };
  }
  function refreshAiButtons() {
    var bi = document.getElementById("btnAiMode");
    if (bi) bi.classList.toggle("on", fxAiOn);
    document.querySelectorAll(".ai-diff").forEach(function (x) {
      x.classList.toggle("on", x.dataset.d === fxAiDiff);
      x.style.background = (x.dataset.d === fxAiDiff)
        ? "linear-gradient(180deg,#8ce8dd,#3fcabb)" : "";
      x.style.color = (x.dataset.d === fxAiDiff) ? "#0a4a44" : "";
    });
  }
  document.querySelectorAll(".ai-diff").forEach(function (x) {
    x.onclick = function () {
      fxAiDiff = x.dataset.d || "normal";
      if (fxAiOn) send({ type: "changeMode", ai: true, diff: fxAiDiff, mode: "ai" });
      else send({ type: "changeMode", diff: fxAiDiff });
      refreshAiButtons();
    };
  });
  window.__aiRefresh = refreshAiButtons;
  refreshAiButtons();
})();

(function modeButtons() {
  // ⚠️ 状态只有一份：全局的 fxDummyModeOn / fxCheatModeOn
  //    （之前这里还有一份 dummyOn，两边各管各的显示 → 互相打架，按钮出不来）
  function refresh() {
    var c = document.getElementById("btnCheatMode");
    if (c) c.classList.toggle("on", fxCheatModeOn);
    fxApplyDummyVisibility();
  }
  window.__modeRefresh = refresh;

  var d = document.getElementById("btnDummyMode");
  if (d) {
    d.onclick = function () {
      fxDummyModeOn = !fxDummyModeOn;
      // 分层界面：切换后把设置抽屉收起来，回到游戏
      if (typeof window.__closeDrawer === "function") window.__closeDrawer();
      if (fxDummyModeOn) {
        // 切到木桩：直接让服务器开一局木桩
        send({ type: "changeMode", mode: "dummy" });
        setPrompt("<h3>🎯 木桩模式已开 —— 对面是不会还手的 100 血木桩</h3>");
      } else {
        send({ type: "changeMode", mode: "pvp" });
        setPrompt("<h3>已切回正常对战 —— 点右上角【▶ 开始游戏】开一局</h3>");
      }
      fxApplyDummyVisibility();             // 立刻生效
    };
  }

  var c = document.getElementById("btnCheatMode");
  if (c) {
    c.onclick = function () {
      fxCheatModeOn = !fxCheatModeOn;
      send({ type: "changeMode", cheat: fxCheatModeOn });
      if (fxCheatModeOn && typeof FX !== "undefined" && FX.flash) FX.flash("rgba(255,60,60,.3)", 400);
      // 通知作弊面板显示/隐藏
      if (typeof window.__cheatShow === "function") window.__cheatShow(fxCheatModeOn);
      refresh();
      if (typeof window.__closeDrawer === "function") window.__closeDrawer();
    };
  }

  // ?dummy=1 / ?cheat=1 进来自动打开
  if (/[?&]dummy=1/.test(location.search)) fxDummyModeOn = true;
  if (/[?&]cheat=1/.test(location.search)) fxCheatModeOn = true;
  setTimeout(refresh, 400);
  setTimeout(refresh, 1000);
  setTimeout(function () {
    if (fxDummyModeOn) send({ type: "changeMode", mode: "dummy" });
    if (fxCheatModeOn) send({ type: "changeMode", cheat: true });
    if (fxCheatModeOn && typeof window.__cheatShow === "function") window.__cheatShow(true);
  }, 1300);
})();

// ============================================================
//  🚑 卡住自检：点一下就把"我现在卡在哪"全部打出来
//    页面上有什么按钮、服务器说该谁动、为什么我不能出牌…
// ============================================================
function fxWhyStuck() {
  const L = [];
  const push = (s) => { L.push(s); fxDiag(s); };
  push("=== 🚑 卡住自检 ===");
  if (!S) { push("S 是空 → 还没收到服务器状态（可能没开局 / 连接断了）"); return; }
  push("阶段: " + S.phase);
  push("我是几号: " + (MY_PLAYER === null ? "双控(null)" : MY_PLAYER) + "   服务器认为我: " + S.you +
    "   观战: " + (S.spectator ? "是" : "否"));
  push("当前该谁动: 玩家" + (S.current + 1) + (S.current === S.you ? "（我）" : "（对方）"));
  push("血量: 我 " + S.me.hp + " / 对方 " + S.opp.hp);
  push("能量: 我 " + S.me.energy + "/" + S.me.maxEnergy + "  能出牌: " + S.me.canPlayThisTurn);
  push("手牌 " + S.me.hand.length + " 张: " + S.me.hand.join("、"));
  push("手牌上限: " + S.me.handLimitThisTurn + (S.me.hand.length > S.me.handLimitThisTurn ? "  ⚠️ 超了！" : ""));
  push("牌库: 我 " + S.me.deckCount + "  对方 " + S.opp.deckCount);
  push("状态: 我 " + JSON.stringify(S.me.statuses) + "  对方 " + JSON.stringify(S.opp.statuses));
  push("待决策(pending): " + (S.pending ? JSON.stringify(S.pending) : "无"));

  // 弹窗里现在显示的是什么
  const promptEl = document.getElementById("prompt");
  const promptText = promptEl ? (promptEl.textContent || "").trim().slice(0, 100) : "(没有)";
  push("弹窗显示: " + (promptText || "(空)"));
  const btns = promptEl ? promptEl.querySelectorAll("button") : [];
  push("弹窗里的按钮数: " + btns.length);

  // 主操作按钮
  const e1 = document.getElementById("btnEndTurn");
  const e2 = document.getElementById("btnStart");
  push("顶栏【结束回合】: " + (e1 ? (e1.style.display === "none" ? "隐藏" : "显示") + " 可点=" + !e1.disabled : "没有"));
  push("顶栏【开始游戏】: " + (e2 ? (e2.style.display === "none" ? "隐藏" : "显示") : "没有"));

  // 为什么不能出牌
  push("--- 为什么出不了牌 ---");
  if (S.phase !== "playing") push("  ❌ 阶段不是 playing（" + S.phase + "）");
  if (S.pending) push("  ❌ 有等待处理的窗口：" + S.pending.kind + " → 先处理它");
  if (S.current !== S.you) push("  ❌ 还没轮到你");
  if (S.me.canPlayThisTurn === false) push("  ❌ 你这回合被禁止出牌（狙击枪/烟雾弹/断头台）");
  const costs = S.me.hand.map((n) => {
    const c = (typeof CARDS === "object" && CARDS) ? CARDS[n] : null;
    if (!c) return n + "(?费)";
    const cost = c.cost === "X" ? 0 : (c.cost === "X+1" ? 0 : (Number(c.cost) || 0));
    return n + "(" + c.cost + "费" + (cost > S.me.energy ? " 能量不够" : "") + ")";
  });
  push("  手牌费用: " + costs.join("、"));
  const playable = S.me.hand.filter((n) => {
    const c = (typeof CARDS === "object" && CARDS) ? CARDS[n] : null;
    if (!c) return false;
    const cost = c.cost === "X" ? 0 : (c.cost === "X+1" ? 0 : (Number(c.cost) || 0));
    if (cost > S.me.energy) return false;
    if (c.effect === "dmg_cond" && S.me.hand.length > 3) return false;
    return true;
  });
  push("  ✅ 现在理论上能出的牌: " + (playable.length ? playable.join("、") : "❌ 一张都出不了"));

  // 最后几条战报
  push("--- 最后 6 条战报 ---");
  (S.log || []).slice(-6).forEach((l) => push("  " + l));
  push("=== 自检结束，把上面的内容发给我就行 ===");
  return L.join("\n");
}

// ============================================================
//  🎨 美化包（mods/）
//    · 服务器 GET /mods 列出所有包（含各自的 pack.json 内容 + 有哪些图）
//    · 用户选一个 → 存 localStorage → 立刻换背景/卡背/logo
//    · 每个包的文件放在 game/mods/<包名>/ 下，走静态服务
//    约定文件名：background / cardback / logo / frame（png|jpg|webp 都行）
// ============================================================
let MODS = [];
// ⚠️ localStorage 不能直接用！某些环境会抛异常或根本不存在：
//    隐私模式 / file:// 协议 / 被策略禁用 / 测试环境
//    → 直接写 localStorage.getItem 会让整个 client.js 崩掉（游戏全白）
const _ls = (function () {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem("__t", "1"); localStorage.removeItem("__t");
      return localStorage;
    }
  } catch (e) { }
  // 兜底：内存版（这次会话有效，刷新就没）
  const mem = {};
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
})();
let curMod = _ls.getItem("kanpai_mod") || "";

function modFileUrl(mod, key) {
  const f = mod.files && mod.files[key];
  if (!f) return null;
  return "mods/" + encodeURIComponent(mod.id) + "/" + f;
}

// 把选中的美化包应用上去
function applyMod(id) {
  const mod = MODS.find((m) => m.id === id) || null;
  curMod = mod ? mod.id : "";
  try { _ls.setItem("kanpai_mod", curMod); } catch (e) { }

  const body = document.body;
  const html = document.documentElement;

  if (!mod) {
    // 恢复默认（把内联样式和 data 标记都清掉，回到 CSS 里的糖果色）
    body.style.backgroundImage = "";
    body.style.backgroundSize = "";
    body.style.backgroundPosition = "";
    body.style.backgroundAttachment = "";
    body.style.backgroundRepeat = "";
    html.removeAttribute("data-cardback");
    html.removeAttribute("data-hidebokeh");
    html.removeAttribute("data-modbg");
    html.style.removeProperty("--cardback-url");
    dbg("美化包：已关闭（用默认皮肤）");
    refreshModButtons();
    return;
  }

  // ① 背景
  const bg = modFileUrl(mod, "background");
  if (bg) {
    // 图 + 半透明暗色遮罩（遮罩做成第一层渐变叠在图上）
    const ov = Math.max(0, Math.min(0.9, mod.overlay !== undefined ? Number(mod.overlay) : 0.25));
    body.style.backgroundImage =
      "linear-gradient(rgba(10,8,18," + ov + "), rgba(10,8,18," + ov + ")), url('" + bg + "')";
    body.style.backgroundSize = "cover, cover";
    body.style.backgroundPosition = "center, center";
    body.style.backgroundAttachment = "fixed, fixed";
    body.style.backgroundRepeat = "no-repeat, no-repeat";
    html.setAttribute("data-modbg", "1");
  } else {
    body.style.backgroundImage = "";
    html.removeAttribute("data-modbg");
  }

  // ② 卡背
  const cb = modFileUrl(mod, "cardback");
  if (cb) {
    html.style.setProperty("--cardback-url", "url('" + cb + "')");
    html.setAttribute("data-cardback", "1");
  } else {
    html.removeAttribute("data-cardback");
    html.style.removeProperty("--cardback-url");
  }

  // ③ 要不要藏掉自带的糖果圆点（有整图背景时通常要）
  if (mod.hideBokeh) html.setAttribute("data-hidebokeh", "1");
  else html.removeAttribute("data-hidebokeh");

  dbg("美化包：" + mod.name + (bg ? " 背景✅" : " 背景✖") + (cb ? " 卡背✅" : " 卡背✖"));
  refreshModButtons();
}

function refreshModButtons() {
  const box = document.getElementById("modList");
  if (!box) return;
  if (!MODS.length) {
    box.innerHTML = '<div class="mini">没找到美化包 —— 把图放进 game\\mods\\ 里再刷新</div>';
    return;
  }
  let html = '<button class="who' + (curMod === "" ? " on" : "") + '" data-mod="" style="width:100%">' +
    '🚫 不用（默认皮肤）</button>';
  for (const m of MODS) {
    const tags = [];
    if (m.files.background) tags.push("背景");
    if (m.files.cardback) tags.push("卡背");
    if (m.files.logo) tags.push("标题");
    if (!tags.length) tags.push("空包");
    html += '<button class="who' + (curMod === m.id ? " on" : "") + '" data-mod="' +
      m.id.replace(/"/g, "&quot;") + '" style="width:100%;text-align:left">' +
      "🎨 " + m.name +
      (m.author ? ' <span style="opacity:.6;font-weight:normal">by ' + m.author + "</span>" : "") +
      '<br><span style="font-size:11px;font-weight:normal;opacity:.75">' + tags.join(" · ") +
      (m.desc ? " — " + m.desc : "") + "</span></button>";
  }
  box.innerHTML = html;
  box.querySelectorAll("button[data-mod]").forEach((b) => {
    b.onclick = () => applyMod(b.dataset.mod);
  });
}

// 启动时拉列表
(function initMods() {
  // ⚠️ fetch 也可能不存在（老浏览器 / 非 http 环境）→ 要兜
  if (typeof fetch !== "function") {
    console.warn("[美化包] 这个环境没有 fetch，跳过");
    return;
  }
  fetch("/mods").then((r) => r.json()).then((list) => {
    MODS = Array.isArray(list) ? list : [];
    console.log("[美化包] 发现 " + MODS.length + " 个");
    refreshModButtons();
    // 之前选过的包，自动应用
    if (curMod) {
      if (MODS.some((m) => m.id === curMod)) applyMod(curMod);
      else { curMod = ""; try { _ls.removeItem("kanpai_mod"); } catch (e) { } }
    }
  }).catch((e) => {
    console.warn("[美化包] 拉取失败: " + (e && e.message));
    refreshModButtons();
  });
})();

// ============================================================
// 🧪 演出自测按钮（查"为什么没动画"）
// ============================================================
(function bindFxTest() {
  var b1 = document.getElementById("btnFxCannon");
  var b2 = document.getElementById("btnFxCheck");
  var b3 = document.getElementById("btnWhyStuck");

  if (b3) {
    b3.onclick = function () {
      const dock = document.getElementById("dock");
      if (dock) dock.classList.add("show");     // 自动展开战报抽屉，让诊断看得见
      fxWhyStuck();
    };
  }

  if (b1) {
    b1.onclick = function () {
      fxDiag("=== 手动测试：直接调 castFx('核弹') ===");
      try {
        if (typeof FX === "undefined" || !FX.castFx) { fxDiag("❌ FX.castFx 不存在 → fx.js 没加载成功"); return; }
        var el = document.getElementById("oppPanel");
        var r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 400, height: 200 };
        var info = FX.castFx("核弹", {
          card: (typeof CARDS === "object" && CARDS) ? CARDS["核弹"] : null,
          pos: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          speed: 1,
        });
        fxDiag("castFx 返回: " + JSON.stringify(info));
        fxDiag("→ 画面上方应该出现一颗核弹掉下来再爆炸（约 5 秒）");
      } catch (e) {
        fxDiag("❌ castFx 抛错: " + e.message);
      }
    };
  }

  if (b2) {
    b2.onclick = function () {
      fxDiag("=== 环境检查 ===");
      fxDiag("FX 存在: " + ((typeof FX === "object" && FX) ? "✅ 是" : "❌ 否"));
      if (typeof FX === "object" && FX) {
        fxDiag("FX.castFx: " + typeof FX.castFx);
        fxDiag("FX.syncUnits: " + typeof FX.syncUnits);
        fxDiag("FX.CARD_FX 条目数: " + Object.keys(FX.CARD_FX || {}).length);
        fxDiag("CARD_FX['核弹'] = " + (((FX.CARD_FX || {})["核弹"]) || "❌ 无"));
      }
      fxDiag("CARDS 数量: " + Object.keys(CARDS || {}).length);
      fxDiag("CARDS['核弹']: " + (CARDS["核弹"] ? CARDS["核弹"].kind : "❌ 无"));
      fxDiag("#fx 容器: " + (document.getElementById("fx") ? "✅ 在" : "❌ 不在"));
      fxDiag("oppPanel: " + (document.getElementById("oppPanel") ? "✅ 在" : "❌ 不在"));
      fxDiag("mePanel: " + (document.getElementById("mePanel") ? "✅ 在" : "❌ 不在"));
      fxDiag("已处理事件编号: " + fxLastEvt + (fxStarted ? "（已初始化）" : "（未初始化）"));
      fxDiag("当前状态 S: " + (S ? ("有，fx 字段 " + (Array.isArray(S.fx) ? S.fx.length + " 条" : "❌ 缺失")) : "无"));
    };
  }
})();

// ============================================================
// 😈 作弊模式（点几个键就能强制出手）
//   开启：网址加 ?cheat=1（或按 Ctrl+Shift+K 三重切换）
//   开启后按数字键 / 字母键：
//     1  强制核弹（10 伤害，无视格挡、能量、手牌、回合）
//     2  超级核弹（24 伤害）
//     3  回满血
//     4  能量拉满（99）
//     5  抽 20 张牌
//     6  把对方能量清空
//     7  清掉对方所有单位
//     8  偷看对方手牌
//     9  直接获胜
//     Q  切换作弊开关
//   Esc 关掉作弊面板
// ============================================================
(function cheatMode() {
  var panel = null;
  var on = false;

  function send_cheat(act, big) {
    if (!on) { return; }
    send({ type: "cheatAction", act: act, big: !!big });
  }

  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cheatPanel";
    panel.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:100001;" +
      "background:rgba(30,0,0,.94);border:2px solid #f44;border-radius:8px;padding:10px;" +
      "font-size:12px;color:#ffdddd;max-width:250px;box-shadow:0 0 24px rgba(255,0,0,.6)";
    var html = '<div style="font-weight:bold;color:#f66;margin-bottom:6px">😈 作弊模式</div>';
    var items = [
      ["1", "强制核弹（10）", "nuke", 0],
      ["2", "超级核弹（24）", "nuke", 1],
      ["3", "回满血", "heal", 0],
      ["4", "能量拉满", "energy", 0],
      ["5", "抽 20 张牌", "draw", 0],
      ["6", "清空对方能量", "noenergy", 0],
      ["7", "清掉对方单位", "killunit", 0],
      ["8", "偷看对方手牌", "cards", 0],
      ["9", "直接获胜", "instawin", 0],
    ];
    items.forEach(function (it) {
      html += '<div style="margin:3px 0"><button data-cheat="' + it[2] + '" data-big="' + it[3] + '"' +
        ' style="background:#5a1a1a;border:1px solid #f44;color:#ffdddd;padding:3px 8px;' +
        'border-radius:4px;cursor:pointer;font-size:12px;width:100%;text-align:left">' +
        '<b style="color:#f88">' + it[0] + '</b> ' + it[1] + '</button></div>';
    });
    html += '<div style="margin-top:6px;color:#f88;font-size:11px">按 Q 关闭作弊 · Esc 藏起面板</div>';
    panel.innerHTML = html;
    panel.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("button[data-cheat]") : null;
      if (!b) return;
      var act = b.getAttribute("data-cheat");
      var big = b.getAttribute("data-big") === "1";
      if (act === "nuke") {
        // 先播动画（打得爽），服务器那边同时扣血
        try {
          if (typeof FX !== "undefined" && FX.castFx) {
            var el = document.getElementById("oppPanel");
            var r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 400, height: 200 };
            FX.castFx("核弹", { card: CARDS["核弹"], pos: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, speed: 1 });
          }
        } catch (e) { }
      }
      send_cheat(act, big);
    });
    document.body.appendChild(panel);
    return panel;
  }

  function show(onFlag) {
    on = !!onFlag;
    if (on) {
      buildPanel();
      panel.style.display = "block";
      var q = document.getElementById("cheatFlag");
      if (q) q.style.display = "inline";
    } else if (panel) {
      panel.style.display = "none";
      var q2 = document.getElementById("cheatFlag");
      if (q2) q2.style.display = "none";
    }
  }

  // 键盘快捷键
  if (typeof document.addEventListener === "function") {
    document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Escape") { if (panel) panel.style.display = "none"; return; }
    var k = e.key.toLowerCase();
    // Q 切换开关
    if (k === "q") { send({ type: "cheat", mode: on ? "off" : "on" }); show(!on); return; }
    if (!on) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var map = { "1": ["nuke", 0], "2": ["nuke", 1], "3": ["heal", 0], "4": ["energy", 0],
                "5": ["draw", 0], "6": ["noenergy", 0], "7": ["killunit", 0],
                "8": ["cards", 0], "9": ["instawin", 0] };
    if (map[k]) {
      e.preventDefault();
      var act = map[k][0], big = map[k][1];
      if (act === "nuke") {
        try {
          if (typeof FX !== "undefined" && FX.castFx) {
            var el = document.getElementById("oppPanel");
            var r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 400, height: 200 };
            FX.castFx("核弹", { card: CARDS["核弹"], pos: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, speed: big ? 0.7 : 1 });
          }
        } catch (e2) { }
      }
      send_cheat(act, big);
    }
    });
  }   // ← document.addEventListener 的 if 到这里

  // 网址带 ?cheat=1 → 自动打开
  setTimeout(function () {
    if (/[?&]cheat=1/.test(location.search)) {
      send({ type: "cheat", mode: "on" });
      show(true);
    }
  }, 1200);

  // 服务器说开启状态时同步一下（比如别人开了）
  window.__cheatSync = function (flag) {
    if (flag) show(true);
  };
  // 供上面那排【😈 作弊】按钮调用
  window.__cheatShow = function (flag) {
    show(!!flag);
  };
})();

// ============================================================
// 🎯 木桩模式（对面 100 血死木桩，不还手，专门测动画）
//  网址加 ?dummy=1 进入。会自动开一局。
// ============================================================
(function dummyMode() {
  // 木桩模式：把"开始新游戏 / 结束回合"换成更适合刷动画的东西
  //   ⚠️ 这排按钮**必须总是创建**（只是默认隐藏），
  //      因为用户是点顶栏【🎯 木桩模式】进来的，网址里不一定有 dummy=1。
  //      之前写成"网址不带 dummy=1 就直接 return" → 按钮压根没创建 → 点了也看不到。
  function buildUI() {
    var bar = document.querySelector(".bar");
    if (!bar || document.getElementById("dummyBox")) return;
    var box = document.createElement("span");
    box.id = "dummyBox";
    box.style.display = "none";      // 默认隐藏，点了【🎯 木桩模式】才显示
    box.style.cssText = "gap:6px;align-items:center;margin-left:8px;flex-wrap:wrap";
    box.innerHTML =
      '<span style="font-size:12px;color:#7f7;font-weight:bold">🎯 木桩模式</span>' +
      '<button id="btnDummyFxHand" style="background:#6a2a6a;border-color:#c05ac0;color:#fed;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px">🎬 发一套演出牌（23张特效牌）</button>' +
      '<button id="btnDummyBomb" style="background:#7a1a1a;border-color:#e04a4a;color:#fee;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px">💣 给我一张定时炸弹</button>' +
      '<button id="btnDummyReset" style="background:#2a6a2a;border-color:#4a9a4a;color:#dfd;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px">🩹 修好木桩（回满100血）</button>' +
      '<button id="btnDummyCards" style="background:#4a2a6a;border-color:#8a5ac0;color:#ede;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px">🃏 给木桩塞20张牌</button>' +
      '<button id="btnDummyUnit" style="background:#6a4a1a;border-color:#c09a4a;color:#fed;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px">🐉 给它加个单位</button>' +
      '<button id="btnDummyEnergy" style="background:#1a4a6a;border-color:#4a9ac0;color:#def;' +
      'padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px">⚡ 给我满能量</button>';
    bar.appendChild(box);

    // ⚠️ 每个按钮都做空值保护：万一某个 id 没找到，也不能让整个 buildUI 抛异常
    //    （之前直接 .onclick = ... ，一旦为 null 就崩，按钮就出不来了）
    function bind(id, fn) {
      var el = document.getElementById(id);
      if (!el && box.querySelector) el = box.querySelector("#" + id);
      if (el) el.onclick = fn;
    }
    bind("btnDummyFxHand", function () { send({ type: "cheatAction", act: "fxhand" }); });
    bind("btnDummyBomb", function () {
      send({ type: "cheatAction", act: "givebomb" });
      if (typeof FX !== "undefined" && FX.flash) FX.flash("rgba(255,60,60,.16)", 220);
    });
    bind("btnDummyReset", function () {
      fetch("/dummyreset").then(function () {
        if (typeof FX !== "undefined" && FX.flash) FX.flash("rgba(120,255,120,.35)", 400);
        if (typeof FX !== "undefined" && FX.bigText) FX.bigText(window.innerWidth / 2, window.innerHeight * 0.4, "木桩已修好", { size: 46, color: "#8f8", glow: "#0a0", life: 1400 });
      }).catch(function () { });
    });
    bind("btnDummyCards", function () { send({ type: "cheatAction", act: "dummycards" }); });
    bind("btnDummyUnit", function () { send({ type: "cheatAction", act: "dummyunit" }); });
    bind("btnDummyEnergy", function () { send({ type: "cheatAction", act: "energy" }); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUI);
  } else {
    buildUI();
  }
  // 多试几次（防止 bar 还没渲染完 / 脚本加载顺序问题）
  //   每次建好之后都调一次 fxApplyDummyVisibility()，
  //   让"显示/隐藏"始终由那一个全局状态决定（不再两边打架）
  [200, 500, 1100, 2000].forEach(function (t) {
    setTimeout(function () {
      buildUI();
      fxApplyDummyVisibility();
    }, t);
  });
  buildUI();
  fxApplyDummyVisibility();
})();

// ---------- 启动 ----------
loadCards().then(connect);
