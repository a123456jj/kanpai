// ============================================================
// 服务器：零依赖 HTTP + WebSocket
// 跑法：node server.js
// 然后浏览器打开 http://127.0.0.1:3000
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { upgradeSocket } = require("./ws.js");
const E = require("./engine.js");
const { CARDS, CARD_BY_NAME } = require("./cards.js");
const AI = require("./ai.js");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT = __dirname;

let game = null;
const clients = []; // { conn, player: 0|1|null }

// 😈 作弊模式开关（默认关闭）
//   开启方式：① 网址加 ?cheat=1  ② 客户端发 cheat 消息  ③ 启动时加 --cheat
let cheatOn = process.argv.indexOf("--cheat") >= 0;

// ============================================================
//  🤖 AI 模式
//    开启后，玩家2 变成电脑。
//    AI 的决策走 **和真人完全一样的出口**（E.playCard / resolvePending），
//    所以它不能做人类做不到的事。
//    ⚠️ AI 只看公开信息（血量/能量/手牌数/单位/状态/战报），
//       绝不读对方手牌内容 —— 见 ai.js 的 boardInfo
// ============================================================
let aiOn = false;
let aiDiff = "normal";        // easy | normal | hard
let aiTimer = null;           // 思考延迟用的定时器
let aiBusy = false;           // 防止重入
let aiFailCount = 0;          // 连续失败次数（防止死循环）
let aiTurnActions = 0;        // 这一回合 AI 已经行动了几次（保险丝）
let aiLastTurn = -1;          // 上一次广播时的回合数（换手就重置计数器）

function aiSeat() { return 1; }                 // AI 坐玩家2
function aiPlayer() { return game ? game.players[aiSeat()] : null; }
function isAiSeat(i) { return aiOn && i === aiSeat(); }

// 安排一次 AI 行动（延迟一点，让人看清它在干什么）
function scheduleAi(step) {
  if (!aiOn || !game || game.phase !== "playing") return;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  const delay = AI.aiDelay(aiDiff, step === "endturn" ? 300 : 0);
  aiTimer = setTimeout(() => {
    aiTimer = null;
    try { runAiOnce(); } catch (e) { console.log("[AI] 出错: " + e.message); }
  }, delay);
}

// AI 走一步（要么出一张牌，要么处理一个待决策，要么结束回合）
function runAiOnce() {
  if (!aiOn || !game || game.phase !== "playing") return;
  const my = aiPlayer();
  if (!my || my.hp <= 0) return;

  // ① 有待决策，而且是该 AI 决定的 → 先处理
  if (game.pending) {
    const owner = pendingOwner(game.pending);
    if (!isAiSeat(owner)) return;                 // 不是 AI 的事，等真人
    if (aiBusy) return;
    aiBusy = true;
    const msg = AI.aiResolve(game, game.pending, aiDiff);
    console.log("[AI] 处理待决策 " + game.pending.kind + " → " + JSON.stringify(msg));
    let ok = false;
    try { ok = resolvePending(msg, game.pending); }
    catch (e) { console.log("[AI] 决策出错: " + e.message); }
    if (!ok) {
      console.log("[AI] 决策被拒绝 → 走兜底");
      try {
        if (game.pending && game.pending.kind === "block") {
          E.applyDamage(game, game.players[game.pending.attacker],
            game.players[game.pending.defender], game.pending.amount, game.pending.reason);
          if (game.pending.statusAfter) for (const ev of game.pending.statusAfter) E.fxPush(game, ev);
        }
      } catch (e) { }
      game.pending = null;
    }
    aiBusy = false;
    broadcast();
    if (game.phase === "playing") scheduleAi("after");
    return;
  }

  // ② 不是 AI 的回合 → 什么都不做
  if (game.current !== aiSeat()) return;

  // ③ AI 的回合：挑一张牌出
  const card = AI.aiChooseCard(game, aiSeat(), aiDiff);
  if (card) {
    if (aiBusy) return;
    // 🔒 保险丝：一回合最多行动 12 次，连续失败 3 次就强制结束回合
    if (aiTurnActions++ > 12 || aiFailCount >= 3) {
      console.log("[AI] 保险丝触发（行动 " + aiTurnActions + " 次 / 失败 " + aiFailCount + " 次）→ 强制结束回合");
      aiTurnActions = 0; aiFailCount = 0;
      if (aiBusy) return;
      aiBusy = true;
      try { E.endTurn(game); } catch (e) { }
      aiBusy = false;
      broadcast();
      return;
    }
    aiBusy = true;
    console.log("[AI] 出牌：" + card);
    const r = E.playCard(game, aiSeat(), card, {});
    if (!r.ok) {
      aiFailCount++;
      console.log("[AI] 出牌失败（" + aiFailCount + "）：" + r.error);
    } else {
      aiFailCount = 0;
    }
    aiBusy = false;
    broadcast();
    if (game.phase === "playing") scheduleAi("after");
    return;
  }

  // ④ 没牌可出（或都不值得出）→ 结束回合
  console.log("[AI] 结束回合" + (aiFailCount ? "（之前失败 " + aiFailCount + " 次）" : ""));
  aiTurnActions = 0;
  aiFailCount = 0;
  if (aiBusy) return;
  aiBusy = true;
  try { E.endTurn(game); } catch (e) { console.log("[AI] 结束回合出错: " + e.message); }
  aiBusy = false;
  broadcast();
  if (game.phase === "playing" && game.pending) {
    // 结束回合可能产生"弃牌到上限" —— 交给下一轮的待决策逻辑
    scheduleAi("after");
  }
}

// ---------- 静态文件 ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function serveStatic(req, res) {
  let url = req.url.split("?")[0]; // ⚠️ 剥掉 ?p=1 这类查询参数
  if (url === "/" || url === "") url = "/index.html";
  const file = path.join(ROOT, url.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("403"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("404 Not Found"); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      // 🔴 禁止浏览器缓存，避免"改了代码但浏览器还跑旧的"
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    res.end(data);
  });
}

// ============================================================
// 🎯 木桩模式
//   对面是一个 100 血的死木桩：不出牌、不反击、不结束回合
//   用途：测试动画、试牌、随便打（打不还手）
//   开启：网址加 ?dummy=1    重置木桩血量：/dummyreset
// ============================================================
function makeDummy(idx) {
  const p = {
    name: "木桩",
    hp: 100, maxHp: 100,
    // ⚠️ 能量不能是 0：木桩虽然不出牌，但"把定时炸弹打回来"要花能量。
    //    给 30 点，够它把炸弹传回来（炸弹费用每轮 +1）。
    energy: 30, maxEnergy: 30,
    regen: 0, drawPerTurn: 1,          // ⚠️ 必须有（startTurn 会读，缺了会算出 NaN）
    hand: [], deck: [], myCards: [],
    units: [], statuses: [],
    shieldThisTurn: 0, shieldNextTurn: 0,
    turnBuffs: [], playedThisTurn: [], playedNamesThisTurn: [],
    pendingOneCardBuff: 0, mineTriggeredThisTurn: false, yoyoUsed: false,
    skipNextTurn: false, thorns: false, canPlayThisTurn: false,
    // ⚠️ 手牌上限不能是 0：木桩也会抽到牌（比如定时炸弹），
    //    上限 0 会让它一抽到就被"弃牌到上限"处理掉 → 炸弹永远不会被传回来
    handLimitThisTurn: 10, maxHand: 10,
    isDummy: true,
  };
  return p;
}
function startDummyGame() {
  const g = E.newGame();
  g.players[1] = makeDummy(1);
  // 木桩模式：给玩家大量能量（否则测不了贵牌，比如 10 费的末日/核弹）
  const M = require("./cards.js");
  g.players[0].name = "你";
  g.players[0].maxEnergy = 20;
  g.players[0].energy = 20;
  g.log = [
    "🎯 木桩模式：对面是不会还手的木桩（100 血），随便打！",
    "⚡ 你的能量上限提到 20（每回合回满），贵的牌也打得出来",
    "🩹 打累了点上面【修好木桩】回满血",
  ];
  return g;
}
// 木桩回合：直接跳过，还给玩家
function skipDummyTurn() {
  if (!game) return false;
  const dummy = game.players.find((p) => p.isDummy);
  if (!dummy) return false;
  // ⚠️ 只在"真的是木桩的回合"时才切 —— 否则每次广播都会重置玩家手牌上限
  if (!game.players[game.current] || !game.players[game.current].isDummy) return false;
  let did = false;
  let guard = 0;
  while (game.phase === "playing" && game.players[game.current] && game.players[game.current].isDummy && guard++ < 6) {
    // ⚠️ 顺序很重要：
    //   endTurn → finishTurn → startTurn（会换手 + 给下一个人抽牌）
    //   所以必须**先让木桩自己的回合开始**（让它抽牌），再 endTurn 换手。
    //   之前写反了 → 木桩从来不抽牌 → 定时炸弹永远躺在它牌库顶。
    console.log("[木桩] 木桩的回合：先让它抽牌");
    game.pending = null;
    const dummyP = game.players[game.current];
    E.startTurn(game);
    // 🥔 木桩不会自己出牌 → 但埋在它身上的地雷得有个结果。
    //    这里让它"自动踩一下"（这样你能看到地雷爆炸的演出）
    if (dummyP.statuses.some((s) => s.type === "土豆地雷")) {
      const hpB = dummyP.hp;
      console.log("[木桩] 木桩踩到土豆地雷了！");
      E.loseHp(game, dummyP, 3, "土豆地雷");
      E.fxPush(game, {
        kind: "damage", seq: game.lastPlay ? game.lastPlay.seq : 0,
        card: "土豆地雷",
        attacker: 1 - game.current, defender: game.current,
        amount: hpB - dummyP.hp || 3, reason: "土豆地雷",
        hpAfter: dummyP.hp, hpBefore: hpB, mineBoom: true,
      });
      dummyP.statuses = dummyP.statuses.filter((s) => s.type !== "土豆地雷");
      dummyP.mineTriggeredThisTurn = true;
    }
    // ⚠️ 关键：pending 只在"抽到炸弹的那一刻"才会被设置。
    //    但木桩的回合被跳过时，那个 pending 可能已经被清掉了，
    //    结果炸弹就烂在木桩手上永远不会被处理。
    //    → 所以这里补一个检查：木桩手上还有炸弹，就补一个待决策让它处理掉。
    if (dummyP.hand.indexOf("定时炸弹") >= 0 && !game.pending) {
      game.pending = { kind: "timebomb", player: game.current };
    }
    // 木桩抽牌可能抽到定时炸弹 → 自动帮它决定（打回去）
    autoResolveDummyPending();
    // 木桩不会出牌 → 直接结束它的回合（内部会换手并开始玩家的回合）
    game.pending = null;
    const needDiscard = E.endTurn(game);
    did = true;
    if (needDiscard === true && game.pending) {
      // 木桩被要求弃牌到上限 → 自动弃掉多出来的
      const pd = game.pending;
      const dp = game.players[pd.player];
      const over = dp.hand.length - (pd.limit !== undefined ? pd.limit : dp.maxHand);
      console.log(`[木桩] 自动弃 ${over} 张（手牌超上限）`);
      if (over > 0) {
        const names = dp.hand.slice(0, over);
        E.resolveDiscardToLimit(game, names);
      } else {
        game.pending = null;
      }
    }
    // 木桩模式下：每回合把玩家能量补满 + 手牌上限放开
    const human = game.players.find((p) => !p.isDummy);
    if (human) {
      human.energy = Math.max(human.energy, human.maxEnergy + 3);
      if (human.maxHand < 24) human.maxHand = 24;
      human.handLimitThisTurn = human.maxHand;
    }
    if (game.players[game.current] && game.players[game.current].isDummy) continue;
    break;
  }
  // 木桩模式：玩家手牌上限一直放开（演出牌组有 20+ 张）
  const h2 = game.players.find((p) => !p.isDummy);
  if (h2) {
    if (h2.maxHand < 24) h2.maxHand = 24;
    h2.handLimitThisTurn = h2.maxHand;
  }
  return did;
}
// 木桩模式下自动把回合还给玩家（每次广播前调用）
function ensurePlayerTurn() {
  if (!game) return false;
  const dummy = game.players.find((p) => p.isDummy);
  if (!dummy) return false;
  if (game.phase !== "playing") return false;
  if (game.players[game.current] && game.players[game.current].isDummy) {
    return skipDummyTurn();
  }
  return false;
}

// ============================================================
// 🎯 木桩自动决策
//   木桩不会做任何选择 → 所有"该木桩决策"的窗口都自动选"不挡/不用/不要"
//   判据：pending 的决策人是不是木桩
//     block / choice_block 用 defender
//     其它（黑洞/窥视/换牌…）用 player，缺省时取 current
// ============================================================
function pendingOwner(pd) {
  if (!pd) return null;
  if (pd.kind === "block" || pd.kind === "choice_block") {
    return pd.defender !== undefined ? pd.defender : pd.player;
  }
  if (pd.player !== undefined) return pd.player;
  return game ? game.current : null;
}
function isDummyIdx(i) {
  return !!(game && game.players[i] && game.players[i].isDummy);
}
// 每种 pending 的"什么都不做"参数
function passArgFor(kind) {
  switch (kind) {
    case "spring": return { use: false };          // 不用弹簧
    case "convert": return { amount: 0 };          // 不转换
    default: return {};                            // 其余空参数＝不挡/不选/不用
  }
}
// 🔄 自动放行"不需要玩家做选择"的待决策
//    execute：斩杀的"直接杀"判定 → 服务器立刻转成格挡窗口（防守方才需要选择）
//    multi  ：苦无等多段攻击 → 服务器自己一段一段打完
//    ⚠️ 这两个以前没人处理 → 客户端弹"等待对方处理…"，然后**永远卡住**
function autoAdvancePending() {
  if (!game) return false;
  let did = false, guard = 0;
  while (game.pending && guard++ < 30) {
    const kind = game.pending.kind;
    if (kind !== "execute" && kind !== "multi") break;
    const pd = game.pending;
    console.log("[自动放行] 处理待决策：" + kind);
    let ok = false;
    try {
      ok = resolvePending({}, pd);
    } catch (e) {
      console.log("[自动放行] 出错: " + e.message + " → 强制清掉");
      game.pending = null;
      break;
    }
    if (!ok) {
      console.log("[自动放行] 被拒绝 → 强制清掉，避免卡死");
      game.pending = null;
    }
    did = true;
  }
  return did;
}

// ============================================================
//  ⏱ 待决策超时兜底
//    场景：该玩家断线了 / 关了页面 / 卡在选牌界面 → 谁也不发 resolve
//    → 对局会**永久卡住**（另一边的玩家干等着）
//    处理：等 45 秒还没人决定，就帮他选"最省事"的答案（服务器算）
//          · 格挡/弹簧/刀 → 不用
//          · 弃牌 → 自动丢最没用的那几张
//          · 黑洞/战利/替罪羊/复制 → 随机或跳过
//    只对"真人"生效；木桩和 AI 有自己的自动决策
// ============================================================
let pendingSince = 0;
let pendingKindSeen = null;
const PENDING_TIMEOUT_MS = 45000;

function autoResolveStuckPending() {
  if (!game || !game.pending) { pendingSince = 0; pendingKindSeen = null; return false; }
  const kind = game.pending.kind;
  if (kind !== pendingKindSeen) { pendingKindSeen = kind; pendingSince = Date.now(); return false; }
  const owner = pendingOwner(game.pending);
  if (isDummyIdx(owner) || isAiSeat(owner)) { pendingSince = Date.now(); return false; }  // 它们自己会决定
  if (Date.now() - pendingSince < PENDING_TIMEOUT_MS) return false;

  console.log(`[超时] 待决策【${kind}】等了 ${Math.round(PENDING_TIMEOUT_MS / 1000)} 秒没人决定 → 服务器代选`);
  pendingSince = Date.now();
  const pd = game.pending;
  let msg = {};
  try {
    if (kind === "discard_to_limit") {
      // 自动丢最"没用"的几张（按 ai.js 的估值）
      const p = game.players[pd.player];
      const sorted = p.hand.slice().sort((a, b) => AI.cardKeepValue(CARD_BY_NAME[a]) - AI.cardKeepValue(CARD_BY_NAME[b]));
      msg = { discard: sorted.slice(0, pd.count) };
    } else {
      msg = passArgFor(kind);
    }
    const ok = resolvePending(msg, pd);
    if (!ok) {
      console.log("[超时] 自动决策被拒 → 强制清掉，避免卡死");
      if (kind === "block") {
        E.applyDamage(game, game.players[pd.attacker], game.players[pd.defender], pd.amount, pd.reason);
        if (pd.statusAfter) for (const ev of pd.statusAfter) E.fxPush(game, ev);
      }
      game.pending = null;
    }
    game.log.push("⏱ 有一方超时没决定，服务器自动替他选了（" + kind + "）");
  } catch (e) {
    console.log("[超时] 出错: " + e.message + " → 强制清掉");
    game.pending = null;
  }
  broadcast();
  return true;
}

function autoResolveDummyPending() {
  if (!game) return false;
  let did = false, guard = 0;
  while (game.pending && guard++ < 20) {
    const owner = pendingOwner(game.pending);
    if (!isDummyIdx(owner)) break;                 // 该玩家决策 → 停下等玩家
    const kind = game.pending.kind;
    const pd = game.pending;
    console.log(`[木桩] 自动处理待决策：${kind}（决策人是木桩）`);
    let ok = false;
    try {
      ok = resolvePending(passArgFor(kind), pd);
    } catch (e) {
      console.log("[木桩] 自动决策出错: " + e.message);
      game.pending = null;
      did = true;
      break;
    }
    if (!ok) {
      // 兜底：万一"不挡/不用"被拒绝（理论上不会），强制把伤害结算掉，别卡住
      console.log("[木桩] 自动决策被拒绝 → 强制结算");
      try {
        if (kind === "block") {
          E.applyDamage(game, game.players[pd.attacker], game.players[pd.defender], pd.amount, pd.reason);
          if (pd.statusAfter) for (const ev of pd.statusAfter) E.fxPush(game, ev);
        } else if (kind === "timebomb") {
          // 打不回去（比如能量不够）→ 那就丢掉，吃 6 点
          console.log("[木桩] 打不回去（能量不够）→ 选择丢掉");
          E.resolveTimeBomb(game, "discard");
        } else if (kind === "choice_block" || kind === "discard_to_limit") {
          // 这些没有"拒绝"的情况，直接清掉
        }
      } catch (e) { console.log("[木桩] 兜底结算出错: " + e.message); }
      game.pending = null;
    }
    did = true;
  }
  return did;
}

// ---------- 生成视图 ----------
function viewFor(playerIdx) {
  if (!game) return null;
  const p = game.players[playerIdx];
  const opp = game.players[1 - playerIdx];
  return {
    you: playerIdx,
    me: {
      name: p.name,
      hp: p.hp,
      energy: p.energy,
      maxEnergy: p.maxEnergy + (E.hasStatus(p, "钻石镐") ? 2 : 0),
      hand: p.hand.slice(),
      handLimit: p.handLimitThisTurn !== undefined ? p.handLimitThisTurn : p.maxHand,
      deckCount: p.deck.length,
      units: p.units.map((u) => ({ name: u.name, hp: u.hp, atk: u.atk })),
      statuses: E.summarize ? E.summarize(p.statuses) : p.statuses.map((s) => `${s.type}${s.stacks > 1 ? "×" + s.stacks : ""}${s.turns !== null ? "(" + s.turns + ")" : ""}`),
      canPlay: !!p.canPlayThisTurn,
      // ⚠️ 必须把 canPlayThisTurn 一起发！
      //    客户端要看它来判断"这回合被禁出牌"（烟雾弹/狙击枪/断头台）
      //    只发 canPlay 的话，客户端查 canPlayThisTurn 永远是 undefined
      //    → 禁出牌的提示不显示、手牌不变灰、按钮状态错乱（实测踩过）
      canPlayThisTurn: p.canPlayThisTurn !== false,
      shield: p.shieldThisTurn || 0,
      skipNext: !!p.skipNextTurn,
      thorns: !!p.thorns,
    },
    opp: {
      name: opp.name,
      hp: opp.hp,
      energy: opp.energy,
      maxEnergy: opp.maxEnergy + (E.hasStatus(opp, "钻石镐") ? 2 : 0),
      handCount: opp.hand.length,
      deckCount: opp.deck.length,
      units: opp.units.map((u) => ({ name: u.name, hp: u.hp, atk: u.atk })),
      statuses: (E.summarize ? E.summarize(opp.statuses) : opp.statuses.map((s) => `${s.type}${s.stacks > 1 ? "×" + s.stacks : ""}`)),
      shields: opp.shieldThisTurn || 0,
      skipNext: !!opp.skipNextTurn,
      thorns: !!opp.thorns,
    },
    turn: game.turn,
    current: game.current,
    phase: game.phase,
    winner: game.winner,
    // 谁死了（血量归零的那一方）→ 客户端据此播"框被切开"的动画
    dead: [game.players[0].hp <= 0, game.players[1].hp <= 0],
    // 🎬 演出事件（最近 30 条）：客户端按这个播动画
    //   只有"真造成了影响"才播（被格挡的会收到 blocked 事件 → 不播伤害动画）
    fx: (game.fx || []).slice(-30),
    // 😈 作弊模式开关状态（让客户端知道能不能用作弊键）
    cheat: cheatOn,
    // 💣 定时炸弹被传了几轮（客户端用来显示"第 N 轮" + 更危险的效果）
    timeBombCount: game.timeBombCount || 0,
    // 💣 谁牌库顶上有炸弹（客户端据此把炸弹徽章挂到那一方的面板上）
    //    [玩家1牌库顶有炸弹?, 玩家2牌库顶有炸弹?]
    bombOn: [
      game.players[0].deck[0] === "定时炸弹",
      game.players[1].deck[0] === "定时炸弹",
    ],
    // 💣 谁手上有没处理的炸弹（抽到了但还没决定）
    bombHeld: [
      game.players[0].hand.indexOf("定时炸弹") >= 0,
      game.players[1].hand.indexOf("定时炸弹") >= 0,
    ],
    // 🥔 谁身上埋着土豆地雷（客户端据此在被埋那一方面板上显示地雷徽章）
    mineOn: [
      game.players[0].statuses.some((s) => s.type === "土豆地雷"),
      game.players[1].statuses.some((s) => s.type === "土豆地雷"),
    ],
    // 🤖 AI 模式（客户端用来显示"对面是电脑"）
    ai: aiOn ? { on: true, diff: aiDiff, seat: aiSeat() } : { on: false },
    pending: game.pending,
    log: game.log.slice(-40),
  };
}

function broadcast() {
  if (!game) {
    for (const c of clients) {
      if (c.online && c.conn.alive) c.conn.send({ type: "state", view: null });
    }
    return;
  }
  // 🎯 木桩模式：轮到木桩就自动跳过，把回合还给玩家
  try { ensurePlayerTurn(); } catch (e) { console.log("[木桩] 跳过回合出错: " + e.message); }
  // 🔄 先自动放行"不需要玩家选择"的待决策（斩杀 → 转成格挡窗口；苦无连击 → 继续打）
  //    ⚠️ 这两个如果不自动放行，客户端没有对应 UI，会**永久卡死**在"等待对方处理…"
  try { autoAdvancePending(); } catch (e) { console.log("[自动放行] 出错: " + e.message); }
  // ⏱ 待决策超时兜底：有人断线/关了页面 → 45 秒后服务器代他决定（否则对局永久卡住）
  try { autoResolveStuckPending(); } catch (e) { console.log("[超时兜底] 出错: " + e.message); }
  // 📼 黑匣子：回合/行动方/pending 一变就记一笔
  try { bbTick("broadcast"); } catch (e) { }
  // 🎯 木桩模式：所有"该木桩决策"的窗口自动选"不用"（否则会卡住不动）
  try { autoResolveDummyPending(); } catch (e) { console.log("[木桩] 自动决策出错: " + e.message); }
  try { ensurePlayerTurn(); } catch (e) { }  for (const c of clients) {
    if (!c.online || !c.conn.alive) continue;   // 断线的（宽限期内）不发
    if (c.player === "spectator") {
      // 观战者：给他玩家1的视角 + 双方手牌 + 标记
      const v = viewFor(0);
      v.bothHands = [game.players[0].hand.slice(), game.players[1].hand.slice()];
      v.spectator = true;
      c.conn.send({ type: "state", view: v });
    } else if (c.player === null) {
      // 双控模式（理论上不会走到这里，保留兼容）
      const v = viewFor(0);
      v.bothHands = [game.players[0].hand.slice(), game.players[1].hand.slice()];
      c.conn.send({ type: "state", view: v });
    } else {
      // 固定身份：发"自己的视角"（me 就是自己，you 就是自己）
      c.conn.send({ type: "state", view: viewFor(c.player) });
    }
  }

  // 🤖 AI 模式：如果轮到 AI（或该 AI 做决策），安排它行动
  //    ⚠️ 放在最后：先把最新状态发出去，玩家能看到"轮到电脑了"
  if (aiOn && game.phase === "playing") {
    // 换手了就重置计数器
    if (aiLastTurn !== game.turn) { aiLastTurn = game.turn; aiTurnActions = 0; aiFailCount = 0; }
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    scheduleAi("broadcast");
  }
}

module.exports = {};

// ---------- 消息处理 ----------
// 📼 黑匣子：记录最近 200 条"服务器收到什么 / 回合怎么变"
//    排查"卡住"时用它看最后一步到底发生了什么
const BLACKBOX = [];
function bb(line) {
  BLACKBOX.push(new Date().toISOString().slice(11, 19) + "  " + line);
  if (BLACKBOX.length > 200) BLACKBOX.shift();
}
let bbLastTurn = -1, bbLastCur = -1, bbLastPending = null;
function bbTick(where) {
  if (!game) return;
  const pend = game.pending ? game.pending.kind : "无";
  if (game.turn !== bbLastTurn || game.current !== bbLastCur || pend !== bbLastPending) {
    bb(where + " │ 回合=" + game.turn + " 当前=P" + (game.current + 1) +
      " pending=" + pend + " 血=" + game.players.map((p) => p.hp).join("/") +
      " 手牌=" + game.players.map((p) => p.hand.length).join("/"));
    bbLastTurn = game.turn; bbLastCur = game.current; bbLastPending = pend;
  }
}

function handleMessage(c, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  const idx = c.player;
  // 📼 黑匣子：记下每条消息（不含内容，只记类型 + 关键字段）
  if (msg.type !== "cheatAction" || true) {
    bb("收到 P" + (idx === null ? "观战" : idx + 1) + " 的 " + msg.type +
      (msg.card ? ":" + msg.card : "") +
      (msg.kind ? ":" + msg.kind : "") +
      (msg.choice ? ":" + msg.choice : "") +
      (msg.block !== undefined ? " block=" + msg.block : ""));
  }

  if (msg.type === "start") {
    if (c.player === "spectator") { c.conn.send({ type: "error", message: "观战者不能开始游戏" }); return; }
    game = E.newGame();
    game.log = [];
    // 保持自己的座位；如果没座位就默认玩家1
    if (c.player === null) c.player = msg.player !== undefined ? msg.player : 0;
    broadcast();
    return;
  }

  // ============================================================
  // 🔄 切换模式（设置抽屉里的按钮用）—— 放在 game 检查之前，无局也能切
  //   mode:  "pvp" | "dummy" | "ai"   木桩 / 电脑对手
  //   cheat: true/false                作弊开关
  //   diff:  "easy"|"normal"|"hard"    AI 难度
  // ============================================================
  if (msg.type === "changeMode") {
    if (c.player === "spectator") { c.conn.send({ type: "error", message: "观战者不能切换模式" }); return; }
    if (msg.cheat !== undefined) {
      c.cheat = !!msg.cheat;
      if (msg.cheat) cheatOn = true;
      console.log(`[模式] 玩家${(c.player === null ? 0 : c.player) + 1} 作弊 = ${c.cheat}`);
    }
    if (msg.diff && ["easy", "normal", "hard"].indexOf(msg.diff) >= 0) {
      aiDiff = msg.diff;
      console.log("[模式] AI 难度 → " + aiDiff);
    }
    // 🤖 只开/关 AI，不动当前对局
    if (msg.ai !== undefined) {
      aiOn = !!msg.ai;
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      console.log("[模式] AI 对手 = " + aiOn + "（难度 " + aiDiff + "）");
    }
    if (msg.mode === "dummy") {
      console.log("[模式] 切换到木桩模式（自动开局）");
      aiOn = false;
      game = startDummyGame();
      c.dummyMode = true;
    } else if (msg.mode === "ai") {
      console.log("[模式] 切换到 AI 对战（自动开局）");
      aiOn = true;
      c.dummyMode = false;
      game = E.newGame();
      game.players[0].name = "你";
      game.players[1].name = "电脑（" + ({ easy: "简单", normal: "普通", hard: "困难" }[aiDiff] || aiDiff) + "）";
      game.log = ["🤖 AI 对战：电脑坐玩家2（难度：" + aiDiff + "）", "开局：先后手 8 能量 5 张 / 5 能量 3 张"];
      broadcast();
      return;
    } else if (msg.mode === "pvp") {
      console.log("[模式] 切换回真人对战");
      aiOn = false;
      c.dummyMode = false;
      game = null;
    }
    broadcast();
    return;
  }

  if (!game) return;
  if (game.phase === "ended" && msg.type !== "start") return;

  // 观战者什么都不能做
  if (c.player === "spectator" && msg.type !== "hello") {
    c.conn.send({ type: "error", message: "你在观战，不能操作" });
    return;
  }

  const cur = game.current;

  // ============================================================
  // 😈 作弊模式（默认关闭）
  //   开启方式：网址加 ?cheat=1，或者启动时加 --cheat 参数
  //   客户端也可以发 { type:"cheat", mode:"on"/"off" } 切换（运行时开关）
  //   ⚠️ 这是你自己的游戏，作弊只影响你和朋友的对局，服务器不对外公开
  // ============================================================
  if (msg.type === "cheat") {
    if (msg.mode === "on") {
      cheatOn = true;
      c.cheat = true;                 // ⚠️ 只有开了的人能用（不是全局人人可用）
      console.log("[作弊] 模式已开启（玩家" + ((c.player === null ? 0 : c.player) + 1) + "）");
    } else if (msg.mode === "off") {
      cheatOn = false;
      c.cheat = false;
      console.log("[作弊] 模式已关闭");
    }
    broadcast();
    return;
  }

  if (msg.type === "cheatAction") {
    // 🎯 木桩专用指令（发演出牌组/给木桩塞牌/加单位）不需要开作弊 —— 它们只在木桩局里有意义
    const dummyActs = ["fxhand", "dummycards", "dummyunit", "givebomb"];
    const isDummyAct = dummyActs.indexOf(msg.act) >= 0;
    if (isDummyAct) {
      const hasDummy = game.players.some((p) => p.isDummy);
      if (!hasDummy) { c.conn.send({ type: "error", message: "这些指令只在【木桩模式】里能用" }); return; }
    } else {
      if (!cheatOn) { c.conn.send({ type: "error", message: "作弊模式没开（点上面的【😈 作弊】按钮）" }); return; }
      // ⚠️ 只有"自己开了作弊"的人能用 —— 否则对方也能作弊
      if (!c.cheat) { c.conn.send({ type: "error", message: "你没开作弊模式（点上面的【😈 作弊】按钮）" }); return; }
    }
    if (idx === null || idx === "spectator") { c.conn.send({ type: "error", message: "观战者不能用这些" }); return; }
    const me = game.players[idx];
    const foe = game.players[1 - idx];
    const act = msg.act;

    if (act === "nuke") {
      // 💥 强制打一发核弹：无视格挡、无视能量、无视手牌、无视回合
      const before = foe.hp;
      const dmg = (msg.big ? 24 : 10);
      E.loseHp(game, foe, dmg, "作弊·核弹");
      game.log.push(`😈 [作弊] ${me.name} 强制打出一发核弹 → ${foe.name} 扣 ${dmg} 血（无视格挡）`);
      if (foe.hp <= 0) E.endGame(game, idx, "作弊核弹");
      E.fxPush(game, { kind: "damage", seq: game.lastPlay ? game.lastPlay.seq : 0,
        card: "核弹", attacker: idx, defender: 1 - idx, amount: dmg,
        reason: "作弊·核弹", hpAfter: foe.hp, hpBefore: before });
      broadcast();
      return;
    }

    if (act === "heal") {
      E.healHp(game, me, 25, "作弊");
      game.log.push(`😈 [作弊] ${me.name} 回满血`);
      broadcast();
      return;
    }

    if (act === "energy") {
      me.energy = 99;
      game.log.push(`😈 [作弊] ${me.name} 能量拉满（99）`);
      broadcast();
      return;
    }

    if (act === "draw") {
      for (let i = 0; i < 20; i++) E.drawCards(game, me, 1);
      game.log.push(`😈 [作弊] ${me.name} 抽了 20 张牌`);
      broadcast();
      return;
    }

    if (act === "noenergy") {
      foe.energy = 0;
      game.log.push(`😈 [作弊] ${foe.name} 的能量被清空`);
      broadcast();
      return;
    }

    if (act === "instawin") {
      E.loseHp(game, foe, foe.hp, "作弊");
      game.log.push(`😈 [作弊] ${me.name} 直接获胜`);
      E.endGame(game, idx, "作弊");
      broadcast();
      return;
    }

    if (act === "killunit") {
      if (foe.units.length) {
        foe.units = [];
        game.log.push(`😈 [作弊] 清掉了 ${foe.name} 的所有单位`);
      } else {
        game.log.push(`😈 [作弊] ${foe.name} 场上没有单位`);
      }
      broadcast();
      return;
    }

    // 🎯 木桩专用：给我一副"全是演出牌"的手牌（方便一张张试动画）
    if (act === "fxhand") {
      const me2 = game.players[idx];
      // 发"好看的那批特效牌"（做动画验收时用，手牌不会太乱）
      const fxCards = ["一拳", "闪电", "核弹", "末日", "黑洞", "天崩地裂", "毒鸡汤",
        "八音盒", "末影龙", "皮卡", "斩杀", "狙击枪", "雪球", "血刃", "硫酸",
        "苦肉计", "幸运儿", "医疗包", "水晶盾", "盾反", "定时炸弹", "断头台", "转转", "土豆地雷"];
      me2.maxEnergy = 99;
      me2.energy = 99;
      me2.maxHand = 40;                 // 放开手牌上限
      me2.handLimitThisTurn = 40;
      // ⚠️ 如果手上已经有这些牌了，就**追加**而不是覆盖
      //    （否则反复点这个按钮永远只拿到同一批牌，测不到别的牌）
      const have = new Set(me2.hand);
      const add = fxCards.filter((n) => !have.has(n));
      if (add.length) me2.hand = me2.hand.concat(add);
      if (me2.hand.length > 60) me2.hand = me2.hand.slice(0, 60);
      game.log.push("🎬 已发给你一副【演出测试牌组】（+" + add.length + " 张）—— 能量 99，手牌上限放开");
      broadcast();
      return;
    }

    // 🧪 作弊：把**全部 60 张牌**都塞进手里（测所有牌用）
    if (act === "allcards") {
      const me2 = game.players[idx];
      const all = CARDS.map((c) => c.name);
      me2.maxEnergy = 99;
      me2.energy = 99;
      me2.maxHand = 99;
      me2.handLimitThisTurn = 99;
      const have = new Set(me2.hand);
      const add = all.filter((n) => !have.has(n));
      me2.hand = me2.hand.concat(add);
      game.log.push("🧪 已把全部 " + all.length + " 张牌塞进你手里（+" + add.length + " 张）");
      broadcast();
      return;
    }

    // 🎯 木桩专用：直接给我一张【定时炸弹】在手牌里（不然随机抽很难摸到）
    if (act === "givebomb") {
      const me2 = game.players[idx];
      me2.hand.push("定时炸弹");
      game.log.push("💣 已给你一张【定时炸弹】——直接打出去就行");
      broadcast();
      return;
    }

    // 🎯 木桩专用：给木桩塞牌 / 加单位（方便测"偷看、黑洞、打单位"这类演出）
    if (act === "dummycards") {
      const dummy = game.players.find((p) => p.isDummy);
      if (dummy) {
        const all = ["一拳", "闪电", "核弹", "黑洞", "末日", "毒鸡汤", "八音盒", "末影龙", "斩杀", "天崩地裂"];
        for (let i = 0; i < 20; i++) dummy.hand.push(all[i % all.length]);
        game.log.push("🎯 给木桩塞了 20 张牌（方便测偷看/黑洞这类牌）");
      }
      broadcast();
      return;
    }

    if (act === "dummyunit") {
      const dummy = game.players.find((p) => p.isDummy);
      if (dummy) {
        dummy.units.push({ name: "末影龙", hp: 5, maxHp: 5, atk: 2, resist: 0 });
        game.log.push("🎯 给木桩加了一个单位（末影龙 5血/2攻）");
      }
      broadcast();
      return;
    }

    if (act === "cards") {
      // 看看对方手里有什么（真·作弊：偷看）
      const names = foe.hand.join("、") || "（空）";
      c.conn.send({ type: "notice", message: "偷看对方手牌：" + names });
      game.log.push(`😈 [作弊] ${me.name} 偷看了对方手牌`);
      broadcast();
      return;
    }

    c.conn.send({ type: "error", message: "未知的作弊指令：" + act });
    return;
  }

  if (msg.type === "play") {
    // 双控模式：允许替任一方出牌；否则只能自己
    const player = idx === null ? (msg.player !== undefined ? msg.player : cur) : idx;
    if (player !== cur) { c.conn.send({ type: "error", message: "现在不是你的回合" }); return; }
    if (game.pending) { c.conn.send({ type: "error", message: "有一个待处理的选择" }); return; }
    const r = E.playCard(game, player, msg.card, { x: msg.x });
    if (!r.ok) c.conn.send({ type: "error", message: r.error });
    broadcast();
    return;
  }

  if (msg.type === "resolve") {
    // 处理待决策
    const pd = game.pending;
    console.log(`[决策] 收到 resolve: ${JSON.stringify(msg)}`);
    console.log(`[决策] 当前 pending: ${pd ? JSON.stringify({kind: pd.kind, player: pd.player, count: pd.count}) : "无"}`);
    if (!pd) {
      console.log("[决策] ⚠️ 没有待决策，忽略");
      return;
    }
    let ok = false;
    try {
      ok = resolvePending(msg, pd);
    } catch (e) {
      console.log("[决策] ❌ 处理时抛错: " + e.message);
      console.log(e.stack);
      c.conn.send({ type: "error", message: "服务器处理出错: " + e.message });
      return;
    }
    console.log(`[决策] 处理结果: ${ok ? "成功" : "被拒绝（条件不满足）"}，之后 pending = ${game.pending ? game.pending.kind : "无"}`);
    if (!ok) {
      c.conn.send({ type: "error", message: `这个操作不合法（${pd.kind}）` });
      return;
    }
    broadcast();
    return;
  }

  if (msg.type === "endTurn") {
    const player = idx === null ? (msg.player !== undefined ? msg.player : cur) : idx;
    if (player !== cur) { c.conn.send({ type: "error", message: "现在不是你的回合" }); return; }
    if (game.pending) { c.conn.send({ type: "error", message: "有一个待处理的选择" }); return; }
    E.endTurn(game); // 可能会产生待决策（弃牌到上限 / 定时炸弹）
    broadcast();
    return;
  }
}

function resolvePending(msg, pd) {
  const P = game.players;
  switch (pd.kind) {
    case "block": {
      // msg: { block: "飞轮"|null }
      const def = P[pd.defender];
      const att = P[pd.attacker];
      if (msg.block) {
        const cardName = msg.block;
        const card = CARD_BY_NAME[cardName];
        if (!card || !def.hand.includes(cardName)) return false;
        // 检查能量（幸运儿减半）
        let cost = card.cost === "X" ? 0 : card.cost;
        if (E.hasStatus(def, "幸运儿")) cost = E.floor05(cost / 2);
        if (def.energy < cost) return false;
        def.energy = E.floor05(def.energy - cost);
        def.hand.splice(def.hand.indexOf(cardName), 1);
        game.discard.push(cardName);
        game.log.push(`${def.name} 打出【${cardName}】格挡（${cost} 费）`);
        // 格挡效果
        if (card.effect === "block_lethal") {
          game.log.push(`名刀挡掉了这一下致死伤害`);
        }
        if (card.effect === "block_draw") {
          E.drawCards(game, def, 1);
          game.log.push(`${def.name} 摸了 1 张牌`);
        }
        if (card.effect === "block_reflect") {
          const back = pd.amount;
          game.log.push(`盾反把 ${back} 点伤害返还给 ${att.name}`);
          E.loseHp(game, att, back, "盾反");
        }
        if (card.effect === "block_heal") {
          const h = E.floor05(pd.amount * 1.5);
          E.healHp(game, def, h, "水晶盾");
        }
        // 伤害被顶掉
        game.log.push(`${def.name} 的【${cardName}】把这一下顶掉了`);
        // 🎬 被格挡 → 记事件（客户端据此**不播**伤害演出）
        E.fxPush(game, {
          kind: "blocked",
          seq: pd.playSeq || 0,
          card: (game.lastPlay && game.lastPlay.card) || pd.reason,
          blockCard: cardName,
          attacker: pd.attacker,
          defender: pd.defender,
          amount: pd.amount,
          reason: pd.reason,
        });
      } else {
        E.applyDamage(game, att, def, pd.amount, pd.reason);
        // 🎬 没被挡下 → 把"挂状态"的事件补发出来（被挡时就不会发）
        if (pd.statusAfter) {
          for (const ev of pd.statusAfter) E.fxPush(game, ev);
        }
      }
      game.pending = null;
      // 如果有"弹簧窗口"挂着，现在轮到它
      if (pd.springAfter) {
        game.pending = pd.springAfter;
        return true;
      }
      // 如果是多段攻击的后续
      if (pd.after) {
        game.pending = { kind: "multi", attacker: pd.after.attacker !== undefined ? pd.after.attacker : pd.attacker, defender: pd.defender, hits: pd.after.hits, done: pd.after.done, perHit: pd.after.perHit, reason: pd.after.reason };
        E.resolveMulti(game);
      }
      return true;
    }
    case "choice_block": {
      // 刀：对方可以丢一张牌抵挡
      const def = P[pd.defender];
      if (msg.discardCard && def.hand.includes(msg.discardCard)) {
        def.hand.splice(def.hand.indexOf(msg.discardCard), 1);
        game.discard.push(msg.discardCard);
        game.log.push(`${def.name} 丢掉【${msg.discardCard}】抵挡了攻击`);
      } else {
        E.applyDamage(game, P[pd.attacker], def, pd.amount, pd.reason);
      }
      game.pending = null;
      return true;
    }
    case "execute": {
      const def = P[pd.defender];
      // 走格挡窗口：先让防守方决定是否格挡
      game.pending = {
        kind: "block",
        attacker: pd.attacker,
        defender: pd.defender,
        amount: E.calcDamage(game, def, pd.amount, P[pd.attacker]),
        reason: pd.reason + "（斩杀）",
        isExecute: true,
      };
      return true;
    }
    case "blackhole": {
      // msg: { take: ["牌名", ...] }
      const t = P[pd.target];
      const take = msg.take || [];
      const removed = [];
      for (const n of take) {
        const i = t.hand.indexOf(n);
        if (i >= 0) { t.hand.splice(i, 1); game.discard.push(n); removed.push(n); }
      }
      game.log.push(`黑洞从对方手上抽掉了 ${removed.length} 张：${removed.join("、") || "无"}`);
      game.pending = null;
      // 🎬 黑洞生效了 → 播演出
      E.fxPush(game, { kind: "status", seq: game.lastPlay ? game.lastPlay.seq : 0,
        player: pd.player, target: pd.target, card: "黑洞", status: "黑洞" });
      return true;
    }
    case "trophy": {
      // msg: { take: "牌名" } —— 从牌库顶 5 张里选 1
      const p = P[pd.player];
      const top = p.deck.slice(0, Math.min(5, p.deck.length));
      if (msg.take && top.includes(msg.take)) {
        p.deck.splice(p.deck.indexOf(msg.take), 1);
        p.hand.push(msg.take);
        game.log.push(`${p.name} 用战利拿到了【${msg.take}】`);
      } else if (top.length > 0) {
        p.deck.shift();
        p.hand.push(top[0]);
        game.log.push(`${p.name} 用战利拿到了【${top[0]}】`);
      }
      game.pending = null;
      return true;
    }
    case "peek": {
      game.log.push(`（窥视：${P[pd.target].name} 的手牌被看了）`);
      game.pending = null;
      return true;
    }
    case "mulligan": {
      const p = P[pd.player];
      const discard = msg.discard || [];
      for (const n of discard) {
        const i = p.hand.indexOf(n);
        if (i >= 0) { p.hand.splice(i, 1); game.discard.push(n); }
      }
      E.drawCards(game, p, Math.min(3, Math.max(0, discard.length)) || 0);
      game.log.push(`${p.name} 用洗牌换了 ${discard.length} 张`);
      game.pending = null;
      return true;
    }
    case "spinner": {
      // 转转：丢 X 张 → +3X 能量
      //   ⚠️ 规则：转转是"额外丢掉"，所以它自己已经进弃牌堆了，
      //      这里丢的牌是额外代价。同名多张也支持（一张一张扣）。
      const p = P[pd.player];
      const discard = msg.discard || [];
      const cap = p.maxEnergy + (E.hasStatus(p, "钻石镐") ? 2 : 0);
      // 先看能拿到多少能量（超过上限就别白丢牌了）
      let n = 0;
      for (const name of discard) {
        if (p.hand.indexOf(name) >= 0) n++;
      }
      const room = cap - p.energy;
      let useful = 0;
      const picked = [];
      if (room <= 0) {
        // 能量已经满了 → 丢了也是白丢，一张都不丢
        game.log.push(`${p.name} 的能量已满（${p.energy}/${cap}），转转没有丢牌`);
        game.pending = null;
        return true;
      }
      // 只丢"有用的"张数（能量满了就不再丢）
      for (const name of discard) {
        if (useful >= Math.ceil(room / 3)) break;
        const i = p.hand.indexOf(name);
        if (i >= 0) {
          p.hand.splice(i, 1);
          game.discard.push(name);
          picked.push(name);
          useful++;
        }
      }
      p.energy = Math.min(cap, p.energy + 3 * useful);
      game.log.push(`${p.name} 用转转丢了 ${useful} 张牌（${picked.join("、") || "无"}）→ +${3 * useful} 能量（现在 ${p.energy}/${cap}）`);
      game.pending = null;
      return true;
    }
    case "convert": {
      // 转换：血 ⇄ 能量，1:1
      const p = P[pd.player];
      const amount = Number(msg.amount) || 0;
      if (amount <= 0) { game.pending = null; return true; }
      if (msg.direction === "hp2energy") {
        if (p.hp <= amount) return false; // 不能把自己换死
        p.hp = E.floor05(p.hp - amount);
        const cap = p.maxEnergy + (E.hasStatus(p, "钻石镐") ? 2 : 0);
        p.energy = Math.min(cap, p.energy + amount);
        game.log.push(`${p.name} 用 ${amount} 点血换了 ${amount} 点能量`);
      } else {
        if (p.energy < amount) return false;
        p.energy = E.floor05(p.energy - amount);
        E.healHp(game, p, amount, "转换");
      }
      game.pending = null;
      return true;
    }
    case "letter": {
      const p = P[pd.player];
      const t = P[pd.target];
      const name = msg.card;
      if (name && p.hand.includes(name)) {
        p.hand.splice(p.hand.indexOf(name), 1);
        t.deck.unshift(name);
        t.deck.unshift("信");
        game.log.push(`${p.name} 用信把【${name}】和一张空白牌放到了对方牌库顶`);
      }
      game.pending = null;
      return true;
    }
    case "scapegoat": {
      const p = P[pd.player];
      const name = msg.card;
      if (name && game.discard.includes(name)) {
        game.discard.splice(game.discard.indexOf(name), 1);
        p.hand.push(name);
        game.log.push(`${p.name} 用替罪羊捞回了【${name}】`);
      }
      game.pending = null;
      return true;
    }
    case "copy": {
      // 复制：复制本回合打过的牌
      const p = P[pd.player];
      const name = msg.card;
      const played = p.playedNamesThisTurn || [];
      if (name && played.includes(name)) {
        const card = CARD_BY_NAME[name];
        let cost = card.cost === "X" ? 0 : card.cost;
        if (E.hasStatus(p, "幸运儿")) cost = E.floor05(cost / 2);
        if (p.energy >= cost) {
          p.energy = E.floor05(p.energy - cost);
          game.log.push(`${p.name} 复制了【${name}】并再次打出`);
          // 递归执行效果（简化：再走一次效果）
          const before = game.pending;
          game.pending = null;
          const r = E.playCard(game, pd.player, name, { x: msg.x, skipHandCheck: true });
          if (!r.ok) game.log.push(`复制失败：${r.error}`);
        } else {
          game.log.push(`复制失败：能量不够`);
        }
      }
      game.pending = null;
      return true;
    }
    case "spring": {
      E.resolveSpring(game, msg.use === true);
      return true;
    }
    case "discard_to_limit": {
      const names = msg.discard || [];
      // ⚠️ 日志不要打印玩家的手牌内容：
      //    ① 那是隐藏信息，日志可能被别人看到
      //    ② 客户端反复发错参数时会刷爆日志
      if (!Array.isArray(names) || names.length !== pd.count) {
        console.log(`[弃牌] ❌ 张数不对（要 ${pd.count} 张，收到 ${(names || []).length} 张）`);
        return false;
      }
      // 检查这些牌是不是真的在他手上
      const handCopy = game.players[pd.player].hand.slice();
      for (const n of names) {
        const i = handCopy.indexOf(n);
        if (i < 0) { console.log(`[弃牌] ❌ 他手上没有这张牌`); return false; }
        handCopy.splice(i, 1);
      }
      E.resolveDiscardToLimit(game, names, pd.player);
      console.log(`[弃牌] ✅ 玩家${pd.player + 1} 弃了 ${names.length} 张，之后 pending = ${game.pending ? game.pending.kind : "无"}`);
      return true;
    }
    case "timebomb": {
      const choice = msg.choice === "discard" ? "discard" : "play";
      const who = pd.player !== undefined ? pd.player : game.current;
      const foeIdx = 1 - who;
      const hpBefore = game.players[who].hp;
      // 📖 "打回去"要付能量（费用每次 +1，见设计文档第 301 行）
      //    ⚠️ 之前不检查也不扣能量 → 免费无限对传 → 双方满血永远打不完
      //       （实测 1502 回合、对传 1478 次）→ 付不起就回绝
      const rb = E.resolveTimeBomb(game, choice);
      if (rb && rb.ok === false) {
        console.log("[定时炸弹] 拒绝: " + rb.error);
        c.conn.send({ type: "error", message: rb.error });
        return false;
      }
      // 🎬 演出：定时炸弹的三种结果
      if (choice === "discard") {
        // 丢掉了 → 炸自己
        E.fxPush(game, {
          kind: "damage", seq: game.lastPlay ? game.lastPlay.seq : 0,
          card: "定时炸弹", attacker: foeIdx, defender: who,
          amount: hpBefore - game.players[who].hp || 6,
          reason: "定时炸弹",
          hpAfter: game.players[who].hp, hpBefore: hpBefore,
          bombChoice: "discard",
        });
      } else {
        // 打回去了 → 传给对方牌库顶（更危险的一轮）
        E.fxPush(game, {
          kind: "status", seq: game.lastPlay ? game.lastPlay.seq : 0,
          player: who, target: foeIdx, card: "定时炸弹", status: "定时炸弹",
          bombChoice: "play",
          bombCount: game.timeBombCount || 1,
        });
      }
      return true;
    }
    case "multi": {
      E.resolveMulti(game);
      return true;
    }
    default:
      game.pending = null;
      return true;
  }
}

// ---------- 启动 ----------
// 任何未捕获的错误都不要让服务器整个挂掉
process.on("uncaughtException", (e) => {
  console.log("[未捕获错误] " + e.message);
  console.log(e.stack);
});
process.on("unhandledRejection", (e) => {
  console.log("[未处理的 Promise 错误] " + (e && e.message ? e.message : e));
});

const server = http.createServer((req, res) => {
  console.log(`[请求] ${req.method} ${req.url}  来自 ${req.socket.remoteAddress}`);
  // ============================================================
  // /clearseats —— 强制踢掉所有连接、清空座位
  //   用途：测试时用（因为 socket 断开后要 60 秒才超时，
  //         期间 /reset 不会释放座位，新连接会被当成观战者）
  //   浏览器会自动重连，所以踢掉之后它们会按网址里的 ?p= 重新坐好
  // ============================================================
  if (req.url === "/clearseats") {
    const n = clients.length;
    for (const c of clients.slice()) {
      if (c.timer) clearTimeout(c.timer);
      try { if (c.conn && c.conn.close) c.conn.close(); } catch (e) { }
      try { if (c.conn && c.conn.socket) c.conn.socket.destroy(); } catch (e) { }
      const i = clients.indexOf(c);
      if (i >= 0) clients.splice(i, 1);
    }
    console.log(`   ♻️ /clearseats：清掉了 ${n} 个连接，座位全部释放`);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("已清空 " + n + " 个连接（浏览器会自动重连并重新坐好）");
    return;
  }

  // 🎯 重置木桩（把血量刷回 100、清掉状态）
  if (req.url === "/dummyreset") {
    if (!game) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("还没开始游戏");
      return;
    }
    const dummy = game.players.find((p) => p.isDummy);
    if (!dummy) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("这不是木桩局");
      return;
    }
    dummy.hp = dummy.maxHp || 100;
    dummy.statuses = [];
    dummy.units = [];
    dummy.shieldThisTurn = 0;
    game.phase = "playing";
    game.winner = null;
    game.log.push("🎯 木桩已修好（血量回满 100）");
    console.log("[木桩] 血量已重置");
    broadcast();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("木桩已修好（100 血）");
    return;
  }

  if (req.url === "/reset") {
    game = null;
    // ⚠️ 同时把"断线保留中的座位"也清掉
    //    否则重置后再连会变成观战者（座位被旧连接占着，要等 30 秒）
    for (const c of clients.slice()) {
      if (c.online && c.conn.alive) {
        c.conn.send({ type: "state", view: null });
      } else {
        // 断线但还在宽限期的 → 直接释放座位
        if (c.timer) clearTimeout(c.timer);
        const i = clients.indexOf(c);
        if (i >= 0) clients.splice(i, 1);
        console.log(`   ♻️ 重置：释放了 ${c.player === "spectator" ? "观战者" : "玩家" + (c.player + 1)} 的保留座位`);
      }
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("已重置（座位也清空了）");
    return;
  }
  // ============================================================
  // 图片文件工具（用来放"真照片"素材，比如烧鸡照片）
  //   GET  /imglist          → 列出 images 文件夹里有什么
  //   POST /imgupload        → 接收浏览器上传的图片，存进 images/
  //   GET  /imgfind?name=xxx → 查某个名字的图在不在（给 fx.js 用）
  // ============================================================
  if (req.url === "/imglist") {
    const dir = path.join(ROOT, "images");
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f)); } catch (e) { }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ dir: dir, files: files }));
    return;
  }
  if (req.url.indexOf("/imgfind") === 0) {
    const q = require("url").parse(req.url, true).query;
    const want = String(q.name || "").replace(/[^\w.\-]/g, "");
    const dir = path.join(ROOT, "images");
    let found = null;
    try {
      const all = fs.readdirSync(dir);
      for (const f of all) {
        if (!/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f)) continue;
        const base = f.replace(/\.[^.]+$/, "");
        if (base === want) { found = "images/" + f; break; }
      }
    } catch (e) { }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ name: want, found: found }));
    return;
  }
  if (req.url === "/imgupload" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) req.destroy();   // 最大 30MB
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const name = String(data.name || "").replace(/[^\w.\-]/g, "");
        if (!name || !data.base64) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "缺少 name 或 base64" }));
          return;
        }
        const dir = path.join(ROOT, "images");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const buf = Buffer.from(data.base64, "base64");
        fs.writeFileSync(path.join(dir, name), buf);
        console.log(`[图片] 已保存 images/${name}（${buf.length} 字节）`);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, name: name, bytes: buf.length }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  if (req.url === "/cards") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(CARDS));
    return;
  }
  // ============================================================
  // 音效文件工具
  //   GET  /sfxlist        → 列出 sounds 文件夹里有什么
  //   POST /sfxupload      → 接收浏览器下载好的音频，存进 sounds/
  //   POST /sfxfetch       → 让浏览器去下载指定网址的声音（返回给浏览器自己存）
  // ============================================================
  if (req.url === "/sfxlist") {
    const dir = path.join(ROOT, "sounds");
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /\.(mp3|ogg|wav|m4a|webm)$/i.test(f)); } catch (e) { }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ dir: dir, files: files }));
    return;
  }
  if (req.url === "/sfxupload" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) { req.destroy(); }   // 最大 20MB
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const name = String(data.name || "").replace(/[^\w.\-]/g, "");
        if (!name || !data.base64) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "缺少 name 或 base64" }));
          return;
        }
        const dir = path.join(ROOT, "sounds");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const buf = Buffer.from(data.base64, "base64");
        fs.writeFileSync(path.join(dir, name), buf);
        console.log(`[音效] 已保存 sounds/${name}（${buf.length} 字节）`);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, name: name, bytes: buf.length }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  // 🩺 调试用（只在启动时加 --debug 才开）：直接看服务器内部的 pending
  //    ⚠️ 会暴露手牌数等信息 → **默认关闭**，不给朋友玩的版本用
  // 📼 黑匣子（排查"卡住"用）：只在本机访问，且只在 --debug 下开
  if (req.url === "/blackbox" && req.socket.remoteAddress &&
      /^(127\.|::1|::ffff:127\.)/.test(req.socket.remoteAddress)) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(BLACKBOX.join("\n") + "\n\n=== 当前状态 ===\n" +
      (game ? ("回合=" + game.turn + " 当前=P" + (game.current + 1) +
        " pending=" + (game.pending ? JSON.stringify(game.pending) : "无") +
        " AI=" + aiOn + "\n血=" + game.players.map((p) => p.hp).join("/") +
        "\n手牌=" + game.players.map((p) => p.hand.length).join("/")) : "（没有对局）"));
    return;
  }
  if (req.url === "/pending" && process.argv.indexOf("--debug") >= 0) {
    const body = game ? {
      阶段: game.phase,
      回合: game.turn,
      当前行动方: game.current,
      待决策: game.pending || null,
      待决策归属: game.pending ? pendingOwner(game.pending) : null,
      玩家: game.players.map((p, i) => ({
        序号: i + 1, 名字: p.name, 血量: p.hp, 能量: p.energy,
        手牌数: p.hand.length, 手牌上限: p.handLimitThisTurn, 牌库数: p.deck.length,
        能出牌: p.canPlayThisTurn, 状态: p.statuses.map((s) => s.type),
      })),
    } : null;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body, null, 2));
    return;
  }
  if (req.url === "/info") {    const os = require("os");
    const ips = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) ips.push(net.address);
      }
    }
    const info = {
      本机地址: "http://127.0.0.1:" + PORT,
      "玩家1地址(本机)": "http://127.0.0.1:" + PORT + "/?p=1",
      "玩家2地址(本机)": "http://127.0.0.1:" + PORT + "/?p=2",
      局域网地址: ips.map((ip) => ({
        "玩家1": "http://" + ip + ":" + PORT + "/?p=1",
        "玩家2": "http://" + ip + ":" + PORT + "/?p=2",
      })),
      已连接客户端: clients.map((c, i) => ({
        _序: i + 1,
        角色: c.player === "spectator" ? "观战者" : "玩家" + (c.player + 1),
        在线: !!c.online,
        _地址: c.conn.socket ? (c.conn.socket.remoteAddress + ":" + c.conn.socket.remotePort) : "?",
      })),
      游戏状态: game ? {
        回合: game.turn,
        当前行动: "玩家" + (game.current + 1),
        阶段: game.phase,
        血量: [game.players[0].hp, game.players[1].hp],
        手牌数: [game.players[0].hand.length, game.players[1].hand.length],
      } : "还没开始",
    };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(info, null, 2));
    return;
  }
  serveStatic(req, res);
});

server.on("upgrade", (req, socket) => {
  console.log(`[WebSocket] 有客户端连接`);
  const conn = upgradeSocket(req, socket);
  if (!conn) return;
  // 判断这个客户端控制哪一方：
  //   ?p=1  → 玩家1     ?p=2 → 玩家2
  //   不写  → 自动分配；如果"两个座位都有人了" → 变成【观战者】
  //
  // ⚠️ 座位有"宽限期"：断线后座位保留 30 秒，
  //    这样刷新页面 / 不小心关掉再打开，还能坐回原来的位置
  const url = new URL(req.url, "http://localhost");
  const pParam = url.searchParams.get("p");
  // 😈 网址里带 ?cheat=1 → 自动开启作弊模式（只给这个连接）
  const cheatParam = url.searchParams.get("cheat") === "1";
  if (cheatParam && !cheatOn) {
    cheatOn = true;
    console.log("[作弊] 因为网址带了 ?cheat=1，作弊模式已开启");
  }
  // 🎯 网址里带 ?dummy=1 → 木桩模式（对面是 100 血的死木桩）
  const dummyParam = url.searchParams.get("dummy") === "1";

  // 座位占用：分三种情况
  //   ① 有人在用          → 占了
  //   ② 断线但在宽限期内  → 可以被原主人"抢回"，但别人不能占
  //   ③ 宽限期过了        → 释放
  const onlineAt = (idx) => clients.find((x) => x.player === idx && x.online);
  const offlineAt = (idx) => clients.find((x) => x.player === idx && !x.online);
  const seatTaken = (idx) => clients.some((x) => x.player === idx);
  const freeSeat = () => (!seatTaken(0) ? 0 : (!seatTaken(1) ? 1 : null));

  let role;
  let reclaimed = null;
  if (pParam === "1" || pParam === "2") {
    const want = pParam === "1" ? 0 : 1;
    if (!seatTaken(want)) {
      role = want;
    } else if (!onlineAt(want)) {
      // 这个座位的主人断线了，但还在宽限期内 → 新连接可以坐回来
      const old = offlineAt(want);
      if (old) {
        if (old.timer) clearTimeout(old.timer);
        const i = clients.indexOf(old);
        if (i >= 0) clients.splice(i, 1);
        console.log(`   ♻️ 玩家${want + 1} 的座位被重新坐上（原主人断线未超时）`);
      }
      role = want;
    } else {
      // 真有人在用 → 观战
      role = "spectator";
    }
  } else {
    const f = freeSeat();
    if (f === null) {
      // 两个座位都被占；如果有"断线宽限期"的座位，也当观战处理（别抢别人的）
      role = "spectator";
    } else {
      role = f;
    }
  }

  const c = { conn, player: (role === "spectator" ? "spectator" : role), online: true, timer: null, cheat: cheatParam };

  // 🎯 木桩模式：连上就自动开一局（不用点开始）
  clients.push(c);
  // 🎯 木桩模式：连上就自动开一局（不用点开始）
  if (dummyParam && role !== "spectator") {
    console.log("   🎯 木桩模式：自动开始一局（对面 100 血死木桩）");
    game = startDummyGame();
    c.dummyMode = true;
  }
  conn.onMessage = (raw) => {
    try { handleMessage(c, raw); }
    catch (e) { console.log("[错误] 处理消息时出错:", e.message); console.log(e.stack); }
  };
  // ⚠️ close 和 error 可能都触发 → 用 online 标记防止重复处理
  conn.onClose = () => {
    if (!c.online) return;         // 已经处理过了
    c.online = false;
    const label2 = c.player === "spectator" ? "观战者" : "玩家" + (c.player + 1);
    if (c.player === "spectator") {
      // 观战者直接移除
      const i = clients.indexOf(c);
      if (i >= 0) clients.splice(i, 1);
      console.log(`   ← ${label2}断开了（已移除）`);
    } else {
      console.log(`   ← ${label2}断线（座位保留 30 秒，可以刷新后坐回来）`);
      c.timer = setTimeout(() => {
        const i = clients.indexOf(c);
        if (i >= 0) clients.splice(i, 1);
        console.log(`   ⏰ ${label2}的座位宽限期到了，已释放`);
        broadcast();
      }, 30000);
    }
  };
  const label = role === "spectator" ? "观战者（能看到双方手牌，不能操作）" : "玩家" + (role + 1);
  console.log(`   → 这个客户端是：${label}`);
  conn.send({ type: "hello", message: "已连接", player: role === "spectator" ? null : role, spectator: role === "spectator" });
  if (game) broadcast();
});
// 监听地址：0.0.0.0 = 允许同一个局域网里的其他设备连进来
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  const os = require("os");
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  const isCloudEnv = !!(process.env.PORT || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT ||
    process.env.FLY_APP_NAME || process.env.NO_OPEN) ||
    process.platform !== "win32";

  console.log("=====================================");
  console.log("  卡牌游戏服务器已启动" + (isCloudEnv ? "（云端模式）" : ""));
  console.log("");
  console.log("  监听端口: " + PORT + "   地址: " + HOST);
  if (isCloudEnv) {
    console.log("");
    console.log("  ☁ 云端部署：用平台给你的网址访问");
    console.log("     玩家1:  <你的网址>/?p=1");
    console.log("     玩家2:  <你的网址>/?p=2");
    console.log("     观战:   <你的网址>/");
    console.log("     木桩:   <你的网址>/?p=1&dummy=1");
    console.log("     演出:   <你的网址>/demo.html");
  } else {
    console.log("  本机打开:        http://127.0.0.1:" + PORT);
    console.log("  玩家1:           http://127.0.0.1:" + PORT + "/?p=1");
    console.log("  玩家2:           http://127.0.0.1:" + PORT + "/?p=2");
    console.log("  🎯 木桩模式:      http://127.0.0.1:" + PORT + "/?p=1&dummy=1   （对面100血不还手）");
    console.log("  😈 作弊模式:      http://127.0.0.1:" + PORT + "/?p=1&cheat=1");
    console.log("");
    if (ips.length) {
      console.log("  📡 同一个 wifi / 热点下的其他设备用这些地址：");
      for (const ip of ips) {
        console.log("     http://" + ip + ":" + PORT + "/?p=1   （玩家1）");
        console.log("     http://" + ip + ":" + PORT + "/?p=2   （玩家2）");
      }
    } else {
      console.log("  （没有检测到局域网 IP）");
    }
  }
  console.log("");
  console.log("  停止服务: Ctrl + C");
  console.log("=====================================");
  // 服务器真正起来之后，再自动打开浏览器（避免"打开太早、页面报错"）
  //   ⚠️ 云服务器上不要做这个：Linux 上没有 cmd/start，也没有浏览器
  if (!isCloudEnv) {
    try {
      const { spawn } = require("child_process");
      spawn("cmd", ["/c", "start", "", "http://127.0.0.1:" + PORT], {
        detached: true,
        stdio: "ignore",
      }).unref();
      console.log("  （已自动打开浏览器）");
    } catch (e) { }
  } else {
    console.log("  ☁ 云端模式：不自动开浏览器（直接用平台给的网址访问）");
  }
});
