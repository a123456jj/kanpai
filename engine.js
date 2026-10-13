// ============================================================
// 游戏引擎：纯逻辑，不碰网络、不碰界面
// 所有规则都写在这里
// ============================================================

const { CARDS, CARD_BY_NAME, DECK_A, DECK_B } = require("./cards.js");

// ---------- 工具 ----------
function floor05(v) {
  // 数值精度 0.5，向下取整到 0.5
  return Math.floor(v * 2) / 2;
}
function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 状态定义 ----------
// 状态对象：{ type, stacks, turns|null(永久), tag }
function makeStatus(type, opts = {}) {
  return { type, stacks: opts.stacks || 1, turns: opts.turns === undefined ? null : opts.turns, tag: opts.tag || null };
}

// ---------- 玩家 ----------
function newPlayer(name, deckNames) {
  return {
    name,
    hp: 25,
    maxHp: 25,
    energy: 5,
    maxEnergy: 10,
    regen: 3,
    drawPerTurn: 2,
    maxHand: 5,
    hand: [],
    deck: shuffle(deckNames),
    // 记录自己的牌有哪些（用来判断"弃牌堆里哪些牌是自己的"，各洗各的）
    myCards: deckNames.slice(),
    units: [],
    statuses: [],
    // 本回合临时
    turnBuffs: [], // { mult } 或 { lifesteal:true }
    playedThisTurn: [],
    playedNamesThisTurn: [],
    yoyoUsed: false,
    // 规则修改类永久效果
    thorns: false,
  };
}

function newGame(opts = {}) {
  const g = {
    players: [
      newPlayer("玩家1", opts.deckA || DECK_A),
      newPlayer("玩家2", opts.deckB || DECK_B),
    ],
    discard: [], // 共用弃牌堆
    turn: 1, // 全局回合数
    current: 0, // 当前行动的玩家索引
    phase: "playing", // playing | ended
    winner: null,
    log: [],
    pending: null, // 等待决策：{ kind, ... }
    firstPlayer: 0,
    fx: [],        // 🎬 演出事件队列（给客户端播动画用）
    fxSeq: 0,      // 演出事件序号
    playSeq: 0,    // 出牌序号
    lastPlay: null // 最近一次出牌 { seq, player, card }
  };
  // 开局：先手 8 能量 5 张；后手 5 能量 3 张
  dealOpening(g);
  return g;
}

function dealOpening(g) {
  const [p1, p2] = g.players;
  // 先手：开局就是 8 能量 + 5 张（= 5+3 能量、3+2 张）
  drawCards(g, p1, 5);
  p1.energy = 8;
  p1.canPlayThisTurn = true;
  p1.handLimitThisTurn = p1.maxHand;
  p1.shieldThisTurn = 0;
  p1.turnBuffs = [];
  p1.playedThisTurn = [];
  p1.playedNamesThisTurn = [];
  p1.pendingOneCardBuff = 0;
  p1.mineTriggeredThisTurn = false;
  p1.yoyoUsed = false;
  // 后手：5 能量 + 3 张
  drawCards(g, p2, 3);
  p2.energy = 5;
  p2.canPlayThisTurn = false;
  p2.turnBuffs = [];
  p2.playedThisTurn = [];
  p2.playedNamesThisTurn = [];
  p2.pendingOneCardBuff = 0;
  p2.mineTriggeredThisTurn = false;
  p2.yoyoUsed = false;
  g.current = g.firstPlayer;
  log(g, `开局：${p1.name} 8 能量 / 5 张；${p2.name} 5 能量 / 3 张`);
  log(g, `—— 第 1 回合 · ${g.players[g.current].name} ——`);
  // 第一个回合不再额外抽牌/回能（已经算进开局了）
}

function log(g, msg) {
  g.log.push(msg);
}

// ---------- 抽牌 ----------
function drawCards(g, p, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      // 牌库空了：把"自己的牌"从共用弃牌堆里捞出来洗回去（各洗各的）
      const mine = (p.myCards || []);
      const back = [];
      const keep = [];
      for (const c of g.discard) {
        if (mine.includes(c)) back.push(c);
        else keep.push(c);
      }
      if (back.length === 0) break; // 自己没牌了，抽不到
      p.deck = shuffle(back);
      g.discard = keep; // 别人的牌留在弃牌堆
      log(g, `${p.name} 的牌库空了，把自己的 ${back.length} 张弃牌洗回牌库`);
    }
    const c = p.deck.shift();
    p.hand.push(c);
    got.push(c);
    // 🔴 定时炸弹：一抽到就要处理（打出 或 丢掉吃 6 点）
    //    ⚠️ 它可能是在"别人的回合"里被抽到的（比如对方用效果让我抽牌），
    //       那之后对方的 startTurn 会把 pending 清掉 → 炸弹就烂在手里。
    //       所以 startTurn 结束前会再检查一次"手上有没有没处理的炸弹"。
    if (c === "定时炸弹" && !g.pending) {
      g.pending = { kind: "timebomb", player: g.players.indexOf(p) };
      log(g, `${p.name} 抽到了定时炸弹！必须处理（打出 或 丢掉吃 6 点）`);
    }
  }
  return got;
}

// ---------- 状态管理 ----------
function getStatus(p, type) {
  return p.statuses.filter((s) => s.type === type);
}
function statusStacks(p, type) {
  return getStatus(p, type).reduce((a, s) => a + s.stacks, 0);
}
function addStatus(g, p, type, opts = {}) {
  if (type === "无敌" || type === "诅咒") {
    // 八音盒：无敌 + 诅咒 是一个"诅咒"状态，两个效果绑在一起
    p.statuses.push(makeStatus("诅咒", { stacks: opts.stacks || 1, turns: opts.turns || 3 }));
    return;
  }
  p.statuses.push(makeStatus(type, opts));
}
function hasStatus(p, type) {
  return p.statuses.some((s) => s.type === type);
}
// 清除状态（牛奶）——只清"状态"，不清规则修改类
function clearStatuses(g, p) {
  const before = p.statuses.length;
  p.statuses = [];
  log(g, `${p.name} 清除了 ${before} 个状态`);
}
// 抗性：震荡 -1/层，皮卡自带 +1
function resistanceOf(p) {
  let r = 0;
  r -= statusStacks(p, "震荡");
  for (const u of p.units) if (u.resist) r += u.resist;
  // 临时治疗阻挡
  if (hasStatus(p, "治疗阻挡")) r += 0; // 不影响抗性
  return r;
}

// ---------- 伤害 ----------
// 伤害顺序：先加抗性 → 再乘百分比 → 下限 1 → 向下取整到 0.5
function calcDamage(g, target, base, attackerOverride) {
  const ti = g.players.indexOf(target);
  const attacker = attackerOverride || g.players[1 - ti];
  // 抗性：resistanceOf 返回 "+N 表示减伤 N 点"
  // 所以实际伤害 = 基础伤害 - 抗性（抗性为负 → 伤害增加）
  let dmg = base - resistanceOf(target);
  // 攻击方的百分比加成（蓄力 / 兴奋剂，加算）
  let mult = 1;
  if (attacker) {
    for (const b of attacker.turnBuffs) if (b.mult) mult += b.mult;
    if (attacker.pendingOneCardBuff) {
      mult += attacker.pendingOneCardBuff;
      attacker.pendingOneCardBuff = 0; // 只用一次
    }
  }
  dmg = dmg * mult;
  if (dmg < 1) dmg = 1; // 伤害下限 1
  return floor05(dmg);
}

// 直接扣血（不经过攻击窗口）—— 状态伤害、自伤等
function loseHp(g, p, amount, reason) {
  if (amount <= 0) return 0;
  // 无敌：绝对不死
  const inv = getStatus(p, "诅咒");
  p.hp = floor05(p.hp - amount);
  log(g, `${p.name} 因${reason}失去 ${amount} 点血 → ${p.hp}`);
  if (p.hp <= 0) {
    if (inv.length > 0 && !reason.includes("八音盒")) {
      p.hp = 0.5;
      log(g, `${p.name} 处于无敌状态，没有死（保留 0.5 血）`);
    } else {
      endGame(g, g.players.indexOf(p) === 0 ? 1 : 0, reason);
    }
  }
  return amount;
}

function healHp(g, p, amount, reason) {
  if (amount <= 0) return;
  // 转头：下一次回血 ×0.5
  const anti = getStatus(p, "治疗阻挡");
  if (anti.length > 0) {
    amount = floor05(amount * 0.5);
    p.statuses = p.statuses.filter((s) => s.type !== "治疗阻挡");
    log(g, `${p.name} 身上有"回血减半"，实际回复 ${amount}`);
  }
  const lost = p.maxHp - p.hp;
  const real = Math.max(0, Math.min(amount, lost));
  p.hp = floor05(p.hp + real);
  log(g, `${p.name} 回复 ${real} 点血（${reason}）→ ${p.hp}`);
}

// ---------- 结束 ----------
function endGame(g, winnerIdx, reason) {
  if (g.phase === "ended") return;
  g.phase = "ended";
  g.winner = winnerIdx;
  log(g, `游戏结束：${g.players[winnerIdx].name} 获胜（${reason}）`);
}

// ---------- 回合流程 ----------
function startTurn(g) {
  const p = g.players[g.current];
  const opp = g.players[1 - g.current];
  g.pending = null;
  log(g, `—— 第 ${g.turn} 回合 · ${p.name} ——`);

  // ① 回合开始时结算：状态伤害、单位攻击、过期检查
  resolveTurnStart(g, p, opp);

  if (g.phase === "ended") return;

  // ② 抽牌（可能抽到定时炸弹 → 会产生待决策）
  const n = p.drawPerTurn + (hasStatus(p, "奖励箱") ? 1 : 0);
  const got = drawCards(g, p, n);
  log(g, `${p.name} 抽了 ${got.length} 张牌`);

  // ③ 回能量
  let regen = p.regen;
  if (hasStatus(p, "钻石镐")) regen += 1;
  if (hasStatus(p, "欠钱")) regen -= 3;
  if (hasStatus(p, "末日")) regen = 0;
  if (regen < 0) regen = 0;
  let cap = p.maxEnergy + (hasStatus(p, "钻石镐") ? 2 : 0);
  p.energy = Math.min(cap, p.energy + regen);
  log(g, `${p.name} 回能 ${regen} → ${p.energy} 能量`);

  // ④ 本回合临时状态
  p.turnBuffs = [];
  p.playedThisTurn = [];
  p.playedNamesThisTurn = [];
  p.yoyoUsed = false;
  p.pendingOneCardBuff = 0;
  p.mineTriggeredThisTurn = false;
  p.springUsedThisTurn = false;

  // ⑤ 手牌上限（红绿灯）
  p.handLimitThisTurn = hasStatus(p, "红绿灯") ? 3 : p.maxHand;

  // ⑥ 出牌限制（控制 / 断头台 / 烟雾弹 / 狙击枪）
  if (p.skipNextTurn) {
    p.canPlayThisTurn = false;
    p.skipNextTurn = false;
    log(g, `${p.name} 本回合不能出牌`);
  } else {
    p.canPlayThisTurn = true;
  }

  // ⑦ 护盾（镇定剂）在本回合生效
  p.shieldThisTurn = p.shieldNextTurn || 0;
  p.shieldNextTurn = 0;

  // ⑧ 定时炸弹兜底检查
  //    ⚠️ 炸弹可能是在"别人的回合"里被抽到的（对方用效果让我抽牌），
  //       那之后对方的 startTurn 会把 pending 清掉 → 炸弹就烂在手里什么也不发生。
  //       所以这里补一次：谁的回合开始，如果谁手上有炸弹且没有待决策 → 补一个。
  //       （在回合开始的抽牌里抽到的情况，上面 ② 已经设过 pending 了）
  if (!g.pending && p.hand.indexOf("定时炸弹") >= 0) {
    g.pending = { kind: "timebomb", player: g.current };
    log(g, `${p.name} 手上有没处理的定时炸弹！必须处理`);
  }
}

function resolveTurnStart(g, p, opp) {
  const pIdx = g.players.indexOf(p);
  // 状态跳伤的小工具：扣血 + 记一个"通用打击"演出事件
  //   ⚠️ 以前状态跳伤**完全不产生事件** → 玩家只看到血少了，没有任何反馈
  //      现在给它一个中性的"状态伤害"事件（客户端播通用掉血效果，不套用任何牌的动画）
  function statusHit(amount, reason) {
    const before = p.hp;
    loseHp(g, p, amount, reason);
    const real = floor05(before - p.hp);
    if (real > 0 && g.phase === "playing") {
      fxPush(g, {
        kind: "damage",
        seq: g.lastPlay ? g.lastPlay.seq : 0,
        card: "状态伤害",
        statusName: reason,
        attacker: 1 - pIdx,
        defender: pIdx,
        amount: real,
        reason: reason,
        hpAfter: p.hp,
        hpBefore: before,
        statusTick: true,
      });
    }
  }

  // 中毒：每层 1 点
  const poison = statusStacks(p, "中毒");
  if (poison > 0) statusHit(poison, "中毒");
  if (g.phase === "ended") return;

  // 焚烧：不丢 1 张牌就扣 2 血
  if (hasStatus(p, "焚烧")) {
    // 由玩家决定（简化：自动丢最贵的一张？不，这里交给决策）
    // 为了先跑通，采用"如果手牌>0 就丢一张，否则扣血"
    if (p.hand.length > 0) {
      const idx = 0;
      const c = p.hand.splice(idx, 1)[0];
      g.discard.push(c);
      log(g, `${p.name} 因焚烧丢弃了 1 张牌`);
    } else {
      loseHp(g, p, 2, "焚烧");
    }
  }
  if (g.phase === "ended") return;

  // 末日：自己回合内未出牌则扣 2 血（在本回合结束时检查）
  // 八音盒诅咒：倒计时
  const curses = getStatus(p, "诅咒");
  for (const c of curses) {
    c.turns -= 1;
    if (c.turns <= 0) {
      log(g, `${p.name} 的八音盒到期 → 自动判负`);
      endGame(g, 1 - g.current, "八音盒到期判负");
      return;
    }
  }
  p.statuses = p.statuses.filter((s) => s.turns === null || s.turns > 0);

  // 单位攻击
  for (const u of p.units.slice()) {
    if (u.hp <= 0) continue;
    // 如果对方有单位，打单位；否则打脸
    if (opp.units.length > 0) {
      const t = opp.units[0];
      t.hp = floor05(t.hp - u.atk);
      log(g, `${p.name} 的${u.name} 攻击 ${opp.name} 的${t.name} ${u.atk} 点`);
      if (t.hp <= 0) {
        opp.units = opp.units.filter((x) => x !== t);
        log(g, `${t.name} 被击杀`);
      }
    } else {
      dealAttackDamage(g, p, opp, u.atk, `${u.name} 的攻击`, true);
    }
    if (g.phase === "ended") return;
  }

  // 状态过期（非永久的）
  p.statuses = p.statuses.filter((s) => s.turns === null || s.turns > 0);
}

// ---------- 演出事件（给客户端播动画用） ----------
//   只有在"真的造成了影响"时才记录：
//     ・damage   ：真扣了血（没被格挡）
//     ・blocked  ：被格挡了（不播演出）
//     ・heal / block / status / summon / draw 等辅助事件
//   每次都带上 playSeq（是哪一次出牌造成的），客户端据此配对
function fxPush(g, ev) {
  if (!g.fx) g.fx = [];
  ev.n = ++g.fxSeq;
  g.fx.push(ev);
  if (g.fx.length > 80) g.fx.shift();          // 别无限增长
}

// 记一次"给对手/自己挂上了状态"（这也算"打出了效果"，该播动画）
//   被挡掉的伤害不会有这个事件 → 所以"被格挡就不播"这条规则不受影响
function fxStatus(g, targetIdx, cardName, statusName) {
  fxPush(g, {
    kind: "status",
    seq: g.lastPlay ? g.lastPlay.seq : 0,
    player: g.lastPlay ? g.lastPlay.player : targetIdx,
    target: targetIdx,
    card: cardName,
    status: statusName,
  });
}

// 记一次"出牌"（后面的事件都挂在这个序号上）
function fxPlay(g, playerIdx, cardName) {
  g.lastPlay = { seq: ++g.playSeq, player: playerIdx, card: cardName, t: Date.now() };
  return g.lastPlay.seq;
}

// ---------- 攻击伤害（带格挡窗口） ----------
// useWindow: 是否让防守方有机会格挡（单位攻击也走窗口，但简化为不走）
function dealAttackDamage(g, attacker, defender, amount, reason, noWindow = false) {
  const dmg = calcDamage(g, defender, amount);
  if (noWindow) {
    applyDamage(g, attacker, defender, dmg, reason);
    return dmg;
  }
  // 需要防守方决策：这里返回一个决策请求
  g.pending = {
    kind: "block",
    attacker: g.players.indexOf(attacker),
    defender: g.players.indexOf(defender),
    amount: dmg,
    reason,
    playSeq: g.lastPlay ? g.lastPlay.seq : 0,      // 记住是哪次出牌
  };
  return dmg;
}

// 给"伤害事件"算一个正确的 card 名（客户端拿它决定播什么动画）
//   ⚠️ 背景：以前一律用 g.lastPlay.card，但状态跳伤（中毒/焚烧/饥荒/末日/
//      断头台/反甲/土豆地雷…）不是任何卡牌打出来的 → 会误播上一张牌的动画
//      （用户实测：自己打出毒鸡汤后，对面回合中毒掉血时又播了一次汤碗动画）
//   规则：
//     ① 如果是某张牌打出来的（reason 里含牌名，或者这一下就是刚打出的那张牌）
//        → 用那张牌
//     ② 否则用 reason 里能识别的"来源名"，客户端会播对应的通用演出
//     ③ 认不出来的 → 用"普通伤害"，播通用打击动画
function cardNameForEvent(g, reason) {
  const r = String(reason || "");
  // ① 刚打出的牌：reason 一般就是牌名（"一拳"）或"牌名（第 N 段）"或"牌名 + 的攻击"
  if (g.lastPlay && g.lastPlay.card) {
    const lc = g.lastPlay.card;
    if (r === lc || r.indexOf(lc) === 0) return lc;
  }
  // ② 状态/机制类来源：直接用它自己的名字（客户端 CARD_FX 里有这些键就能播专属演出）
  const KNOWN = ["中毒", "焚烧", "饥荒", "流血", "末日（未出牌）", "末日", "断头台",
    "反甲", "土豆地雷", "定时炸弹", "盾反", "自伤", "诅咒"];
  for (const k of KNOWN) if (r.indexOf(k) >= 0) return k;
  // ③ 认不出来 → 通用
  return "普通伤害";
}

// 实际扣血（已经算完伤害，且防守方选择不挡）
function applyDamage(g, attacker, defender, dmg, reason) {  // 护盾（镇定剂）：本回合有效，按数值吸收
  if (defender.shieldThisTurn > 0) {
    const absorb = Math.min(defender.shieldThisTurn, dmg);
    defender.shieldThisTurn = floor05(defender.shieldThisTurn - absorb);
    dmg = floor05(dmg - absorb);
    log(g, `护盾吸收了 ${absorb} 点（剩 ${defender.shieldThisTurn}）`);
  }
  if (dmg > 0) {
    loseHp(g, defender, dmg, reason);
    // 🎬 真扣血 → 记一个演出事件（客户端据此播动画）
    //   ⚠️ card 只在"这一下确实是某张牌打出来的"时才用 lastPlay.card。
    //      状态跳伤（中毒/焚烧/饥荒/末日/断头台/反甲/地雷…）不是任何卡牌打的，
    //      如果沿用 lastPlay.card，客户端会**再播一次那张牌的动画**
    //      （用户报过：中毒掉血时播了毒鸡汤的汤碗动画）
    const realCard = cardNameForEvent(g, reason);
    fxPush(g, {
      kind: "damage",
      seq: g.lastPlay ? g.lastPlay.seq : 0,
      card: realCard,
      attacker: g.players.indexOf(attacker),
      defender: g.players.indexOf(defender),
      amount: dmg,
      reason: reason,
      hpAfter: defender.hp,
      hpBefore: floor05(defender.hp + dmg),
    });
    // 嗜血：攻击方本回合造成的伤害转回血
    if (attacker && attacker.turnBuffs.some((b) => b.lifesteal)) {
      healHp(g, attacker, dmg, "嗜血");
    }
  } else {
    // 伤害被护盾吸光了 → 也不算"真受伤"
    fxPush(g, {
      kind: "absorbed",
      seq: g.lastPlay ? g.lastPlay.seq : 0,
      card: g.lastPlay ? g.lastPlay.card : reason,
      attacker: g.players.indexOf(attacker),
      defender: g.players.indexOf(defender),
      amount: 0,
      reason: reason,
    });
  }
  // 反甲：防守方身上的反伤（永久效果）
  if (attacker && defender.thorns && dmg > 0) {
    const back = floor05(dmg * 0.5);
    if (back > 0) {
      log(g, `${defender.name} 的反甲反弹 ${back} 点`);
      loseHp(g, attacker, back, "反甲");
      fxPush(g, {
        kind: "damage", seq: g.lastPlay ? g.lastPlay.seq : 0, card: "反甲",
        attacker: g.players.indexOf(defender), defender: g.players.indexOf(attacker),
        amount: back, reason: "反甲", hpAfter: attacker.hp, hpBefore: floor05(attacker.hp + back),
      });
    }
  }
}

// ---------- 出牌 ----------
function canPlay(g, p, cardName, xValue) {
  const card = CARD_BY_NAME[cardName];
  if (!card) return "没有这张牌";
  if (g.phase === "ended") return "游戏已结束";
  if (!p.canPlayThisTurn) return "本回合不能出牌";
  if (!p.hand.includes(cardName)) return "手牌里没有这张牌";
  if (card.effect === "dmg_cond" && p.hand.length > card.condHandMax) return "手牌太多，打不出";
  if (card.effect === "selfharm" && p.hp <= card.self) return "血量不够（自伤会致死）";
  if (card.effect === "dmg_self" && p.hp <= card.self) return "血量不够（自伤会致死）";
  if (card.effect === "shield_next" && p.hp <= (card.selfDmg || 0)) return "血量不够";
  if (card.effect === "yoyo" && p.yoyoUsed) return "溜溜球本回合已用过";

  // 费用
  let cost = card.cost;
  if (cost === "X") cost = xValue;
  else if (cost === "X+1") cost = xValue + 1;
  if (typeof cost !== "number" || cost < 0) return "费用不合法";
  let real = cost;
  if (hasStatus(p, "幸运儿")) real = floor05(real / 2);
  if (p.energy < real) return `能量不够（需要 ${real}，只有 ${p.energy}）`;
  return null;
}

function payCost(g, p, cardName, xValue) {
  const card = CARD_BY_NAME[cardName];
  let cost = card.cost;
  if (cost === "X") cost = xValue;
  else if (cost === "X+1") cost = xValue + 1;
  let real = cost;
  if (hasStatus(p, "幸运儿")) real = floor05(real / 2);
  p.energy = floor05(p.energy - real);
  return real;
}

// 出牌（主入口）
function playCard(g, playerIdx, cardName, opts = {}) {
  const p = g.players[playerIdx];
  const opp = g.players[1 - playerIdx];
  const err = canPlay(g, p, cardName, opts.x);
  if (err) return { ok: false, error: err };

  const card = CARD_BY_NAME[cardName];
  const paid = payCost(g, p, cardName, opts.x);

  // 从手牌移除（溜溜球除外，之后会回手）
  const hi = p.hand.indexOf(cardName);
  p.hand.splice(hi, 1);
  p.playedThisTurn.push(cardName);
  p.playedNamesThisTurn.push(cardName);

  log(g, `${p.name} 打出【${cardName}】（${paid} 费）`);
  // 🎬 记下这次出牌（后面产生的伤害事件都会挂这个序号）
  fxPlay(g, playerIdx, cardName);
  fxPush(g, { kind: "play", seq: g.lastPlay.seq, player: playerIdx, card: cardName, cost: paid });

  // 饥荒：对方每出一张牌扣 1 血（注意：饥荒挂在自己身上时，是自己出牌扣自己？）
  // 按规则：饥荒是"敌方每出一张牌，扣 1 血"→ 挂在对方身上，对方出牌时扣对方的血
  for (const s of getStatus(p, "饥荒")) {
    for (let i = 0; i < s.stacks; i++) loseHp(g, p, 1, "饥荒");
  }
  if (g.phase === "ended") return { ok: true };

  // 土豆地雷：如果自己身上有地雷且这回合第一次出牌 → 扣 3 血
  const mine = getStatus(p, "土豆地雷");
  if (mine.length > 0 && !p.mineTriggeredThisTurn) {
    p.mineTriggeredThisTurn = true;
    const hpBeforeMine = p.hp;
    loseHp(g, p, 3, "土豆地雷");
    // 🥔 演出：踩爆了！（客户端据此播"地雷爆炸"+ 移除徽章）
    fxPush(g, {
      kind: "damage",
      seq: g.lastPlay ? g.lastPlay.seq : 0,
      card: "土豆地雷",
      attacker: 1 - g.players.indexOf(p),
      defender: g.players.indexOf(p),
      amount: hpBeforeMine - p.hp || 3,
      reason: "土豆地雷",
      hpAfter: p.hp, hpBefore: hpBeforeMine,
      mineBoom: true,
    });
    if (g.phase === "ended") return { ok: true };
  }

  // 先判断"对方能不能用弹簧取消这张牌"
  // ⚠️ 不能马上设 pending —— 因为伤害类牌会在 execEffect 里产生"格挡窗口"，
  //    那个窗口要先生效；等格挡结算完再问弹簧（见服务器 resolvePending 的 block 分支）
  const springInfo = checkSpring(g, playerIdx, cardName);

  // 执行效果
  const res = execEffect(g, playerIdx, card, opts);

  // 🎬 收尾处理：如果这张牌"给对手挂了状态"但**产生了一个格挡窗口**，
  //    那说明对方还有机会挡掉 → 把状态事件推迟到"格挡结算完"再发
  //    （这样"被挡掉就不播动画"的规则对状态牌也成立）
  if (g.fx && g.fx.length) {
    const mine2 = g.fx.filter((e) => e.kind === "status" && e.seq === g.lastPlay.seq);
    if (mine2.length && g.pending && g.pending.kind === "block") {
      // 先摘出来，挂到 pending 上
      g.fx = g.fx.filter((e) => !(e.kind === "status" && e.seq === g.lastPlay.seq));
      g.pending.statusAfter = mine2;
    }
  }

  // 牌进弃牌堆（溜溜球回手、复制等特殊处理）
  if (card.effect === "yoyo") {
    p.hand.push(cardName);
    p.yoyoUsed = true;
  } else {
    g.discard.push(cardName);
  }

  // 如果这张牌没有产生别的待决策 → 现在就问弹簧
  if (springInfo && !g.pending) {
    g.pending = springInfo;
  } else if (springInfo && g.pending) {
    // 挂着，等格挡结算完之后再问
    g.pending.springAfter = springInfo;
  }

  // 手牌超过上限（回合结束时检查，这里不处理）
  return { ok: true, result: res };
}

// 检查"对方能不能用弹簧取消这一手"
function checkSpring(g, playerIdx, cardName) {
  const card = CARD_BY_NAME[cardName];
  // 弹簧本身不能取消弹簧；格挡牌是反应式的，也不走这个窗口
  if (cardName === "弹簧") return null;
  if (card.effect === "spring") return null;

  const opp = g.players[1 - playerIdx];
  if (opp.springUsedThisTurn) return null; // 一回合只能弹一次
  const si = opp.hand.indexOf("弹簧");
  if (si < 0) return null;

  // 算弹簧的费用（幸运儿减半）
  let cost = CARD_BY_NAME["弹簧"].cost;
  if (hasStatus(opp, "幸运儿")) cost = floor05(cost / 2);
  if (opp.energy < cost) return null;

  return {
    kind: "spring",
    attacker: playerIdx,
    defender: 1 - playerIdx,
    cardName,
    cost,
  };
}

// 对方打出了弹簧：取消这一手，牌回到攻击方手上，能量白花
function resolveSpring(g, use) {
  const pd = g.pending;
  if (!pd || pd.kind !== "spring") return;
  const att = g.players[pd.attacker];
  const def = g.players[pd.defender];

  if (!use) {
    g.pending = null;
    return;
  }

  // 付弹簧的费用
  def.energy = floor05(def.energy - pd.cost);
  def.springUsedThisTurn = true;
  const si = def.hand.indexOf("弹簧");
  if (si >= 0) def.hand.splice(si, 1);
  g.discard.push("弹簧");
  log(g, `${def.name} 打出【弹簧】（${pd.cost} 费）`);

  // 把打出的那张牌从弃牌堆挪回攻击方手上
  const di = g.discard.lastIndexOf(pd.cardName);
  if (di >= 0) g.discard.splice(di, 1);
  att.hand.push(pd.cardName);
  // 从"本回合打出的牌"里也撤掉
  const pi = att.playedNamesThisTurn.lastIndexOf(pd.cardName);
  if (pi >= 0) att.playedNamesThisTurn.splice(pi, 1);

  log(g, `弹簧取消了【${pd.cardName}】—— 那张牌回到 ${att.name} 手上，能量白花`);
  g.pending = null;
}

// ---------- 卡牌效果实现 ----------
function execEffect(g, idx, card, opts) {
  const p = g.players[idx];
  const opp = g.players[1 - idx];
  const e = card.effect;

  switch (e) {
    case "dmg": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      return;
    }
    case "dmg_self": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      // 自伤
      if (p.turnBuffs.some((b) => b.lifesteal)) {
        // 嗜血：自伤也转回血 → 净效果为 0
        log(g, `嗜血把 ${card.self} 点自伤转回血`);
      } else {
        loseHp(g, p, card.self, card.name + "的自伤");
      }
      return;
    }
    case "dmg_x": {
      dealAttackDamage(g, p, opp, opts.x, card.name);
      return;
    }
    case "dmg_multi": {
      // 多段：逐段结算（每段都要问格挡）
      g.pending = {
        kind: "multi",
        attacker: idx,
        defender: 1 - idx,
        hits: card.hits,
        done: 0,
        perHit: card.value,
        reason: card.name,
      };
      resolveMulti(g);
      return;
    }
    case "dmg_lock": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      p.skipNextTurn = true;
      log(g, `${p.name} 下回合不能出牌`);
      return;
    }
    case "dmg_discard_random": {
      // 随机丢对方 n 张
      for (let i = 0; i < card.discard; i++) {
        if (opp.hand.length === 0) break;
        const j = Math.floor(Math.random() * opp.hand.length);
        const c = opp.hand.splice(j, 1)[0];
        g.discard.push(c);
        log(g, `随机丢掉了对方的【${c}】`);
      }
      dealAttackDamage(g, p, opp, card.value, card.name);
      return;
    }
    case "dmg_cond": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      return;
    }
    case "dmg_shock": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      addStatus(g, opp, "震荡");
      log(g, `${opp.name} 获得"震荡"（抗性 -1，永久）`);
      return;
    }
    case "dmg_heal": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      healHp(g, p, card.heal, card.name);
      return;
    }
    case "execute": {
      // 先判定：如果对方血量 ≤3，直接杀
      if (opp.hp <= card.execAt) {
        log(g, `${opp.name} 血量 ≤${card.execAt}，被${card.name}直接斩杀`);
        g.pending = {
          kind: "execute",
          attacker: idx,
          defender: 1 - idx,
          amount: card.value,
          reason: card.name,
        };
        return;
      }
      dealAttackDamage(g, p, opp, card.value, card.name);
      return;
    }
    case "choice_block": {
      // 对方可以丢一张牌抵挡
      g.pending = {
        kind: "choice_block",
        attacker: idx,
        defender: 1 - idx,
        amount: card.value,
        reason: card.name,
      };
      return;
    }
    // ---- 格挡牌（都是反应式，出牌时不生效，只登记）----
    case "block_lethal":
    case "block_one":
    case "block_draw":
    case "block_reflect":
    case "block_heal": {
      log(g, `（${card.name} 需要在被攻击时打出才生效）`);
      return;
    }
    case "shield_next": {
      if (p.hp <= card.selfDmg) {
        log(g, "血量不够，无法打出");
        return;
      }
      loseHp(g, p, card.selfDmg, card.name);
      p.shieldNextTurn = (p.shieldNextTurn || 0) + card.shield;
      log(g, `${p.name} 下回合将获得 ${card.shield} 点护盾`);
      return;
    }
    // ---- 放大器 ----
    case "buff_one": {
      p.pendingOneCardBuff = (p.pendingOneCardBuff || 0) + card.mult;
      log(g, `${p.name} 下一张牌伤害 +${card.mult} 倍`);
      return;
    }
    case "buff_all": {
      p.turnBuffs.push({ mult: card.mult });
      log(g, `${p.name} 本回合所有伤害 +${card.mult} 倍`);
      return;
    }
    case "lifesteal": {
      p.turnBuffs.push({ lifesteal: true });
      log(g, `${p.name} 本回合造成的伤害将转化为回血`);
      return;
    }
    case "copy_card": {
      g.pending = { kind: "copy", player: idx, reason: card.name };
      return;
    }
    case "lucky": {
      addStatus(g, p, "幸运儿", { turns: 1 });
      log(g, `${p.name} 本回合所有消耗减半`);
      return;
    }
    // ---- 状态 ----
    case "dmg_poison": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      addStatus(g, opp, "中毒");
      log(g, `${opp.name} 中毒 1 层`);
      fxStatus(g, g.players.indexOf(opp), card.name, "中毒");
      return;
    }
    case "burn": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      for (let i = 0; i < card.discard; i++) {
        if (opp.hand.length === 0) break;
        const c = opp.hand.splice(0, 1)[0];
        g.discard.push(c);
        log(g, `丢掉对方的【${c}】`);
      }
      addStatus(g, opp, "焚烧");
      log(g, `${opp.name} 获得"焚烧"（每回合须额外丢 1 张，否则扣 2 血）`);
      fxStatus(g, g.players.indexOf(opp), card.name, "焚烧");
      return;
    }
    case "dmg_antiheal": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      addStatus(g, opp, "治疗阻挡");
      log(g, `${opp.name} 下一次回血减半`);
      fxStatus(g, g.players.indexOf(opp), card.name, "治疗阻挡");
      return;
    }
    case "doom": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      addStatus(g, opp, "末日", { turns: 3 });
      log(g, `${opp.name} 进入"末日"（3 回合不回能量、不出牌扣 2 血）`);
      fxStatus(g, g.players.indexOf(opp), card.name, "末日");
      return;
    }
    case "famine": {
      addStatus(g, opp, "饥荒");
      log(g, `${opp.name} 获得"饥荒"（每出一张牌扣 1 血，永久）`);
      fxStatus(g, g.players.indexOf(opp), card.name, "饥荒");
      return;
    }
    // ---- 控制 ----
    case "guillotine": {
      opp.skipNextTurn = true;
      addStatus(g, opp, "断头台");
      log(g, `${opp.name} 下回合不能出牌（弃牌时会受 5 点伤害）`);
      fxStatus(g, g.players.indexOf(opp), card.name, "断头台");
      return;
    }
    case "blackhole": {
      g.pending = { kind: "blackhole", player: idx, target: 1 - idx, reason: card.name };
      return;
    }
    case "acid": {
      const removed = [];
      opp.hand = opp.hand.filter((n) => {
        const c = CARD_BY_NAME[n];
        const costNum = typeof c.cost === "number" ? c.cost : 99;
        if (costNum <= 3) {
          removed.push(n);
          g.discard.push(n);
          return false;
        }
        return true;
      });
      log(g, `硫酸消灭了对方 ${removed.length} 张牌：${removed.join("、") || "无"}`);
      return;
    }
    case "spring": {
      log(g, `（弹簧需要在对方出牌时打出才生效）`);
      return;
    }
    case "smoke": {
      opp.skipNextTurn = true;
      log(g, `${opp.name} 下回合不能主动出牌`);
      return;
    }
    case "trafficlight": {
      addStatus(g, opp, "红绿灯", { turns: 1 });
      log(g, `${opp.name} 下回合手牌上限变为 3`);
      return;
    }
    case "landmine": {
      // 🥔 埋雷
      //    ⚠️ 木桩不会自己出牌，所以它的"踩雷"由服务器在它回合开始时模拟
      //       （见 server.js 的 skipDummyTurn → "木桩踩到土豆地雷了"）
      //       这里照常给它挂状态，别跳过
      addStatus(g, opp, "土豆地雷", { turns: 1 });
      opp.mineTriggeredThisTurn = false;
      log(g, `${opp.name} 下回合出牌将扣 3 血`);
      // 🥔 演出：地雷埋到对方身上（客户端会显示一个"埋着的雷"徽章）
      fxStatus(g, 1 - idx, "土豆地雷", "土豆地雷");
      return;
    }
    case "timebomb": {
      opp.deck.unshift("定时炸弹");
      log(g, `定时炸弹被放到了 ${opp.name} 的牌库顶`);
      // 💣 演出：炸弹掉下来贴着对方牌库（第几轮决定它多"危险"）
      g.timeBombPlanted = (g.timeBombPlanted || 0) + 1;
      fxStatus(g, 1 - idx, "定时炸弹", "定时炸弹");
      g.fx[g.fx.length - 1].bombChoice = "plant";
      g.fx[g.fx.length - 1].bombCount = g.timeBombPlanted;
      return;
    }
    case "letter": {
      g.pending = { kind: "letter", player: idx, target: 1 - idx, reason: card.name };
      return;
    }
    // ---- 过牌 ----
    case "draw3": {
      drawCards(g, p, 3);
      log(g, `${p.name} 摸了 3 张牌`);
      return;
    }
    case "trophy": {
      g.pending = { kind: "trophy", player: idx, reason: card.name };
      return;
    }
    case "peek": {
      g.pending = { kind: "peek", player: idx, target: 1 - idx, reason: card.name };
      return;
    }
    case "lottery": {
      if (opp.hand.length === 0) {
        log(g, "对方没有手牌，抽奖无效");
        return;
      }
      const j = Math.floor(Math.random() * opp.hand.length);
      const picked = opp.hand[j];
      const c = CARD_BY_NAME[picked];
      const costNum = typeof c.cost === "number" ? c.cost : 4;
      let d = floor05(costNum / 2);
      if (d < 1) d = 1;
      log(g, `抽奖抽到了对方的【${picked}】→ 造成 ${d} 点伤害`);
      dealAttackDamage(g, p, opp, d, card.name + "（抽到 " + picked + "）");
      return;
    }
    case "mulligan": {
      g.pending = { kind: "mulligan", player: idx, reason: card.name };
      return;
    }
    // ---- 经济 ----
    case "extra_draw": {
      addStatus(g, p, "奖励箱");
      log(g, `${p.name} 永久获得"每回合多摸 1 张"`);
      return;
    }
    case "extra_energy": {
      addStatus(g, p, "钻石镐");
      log(g, `${p.name} 永久获得"回能 +1、上限 +2"`);
      return;
    }
    case "spinner": {
      g.pending = { kind: "spinner", player: idx, reason: card.name };
      return;
    }
    case "energy2": {
      const cap = p.maxEnergy + (hasStatus(p, "钻石镐") ? 2 : 0);
      p.energy = Math.min(cap, p.energy + 2);
      log(g, `${p.name} +2 能量 → ${p.energy}`);
      return;
    }
    case "convert": {
      g.pending = { kind: "convert", player: idx, reason: card.name };
      return;
    }
    case "debt": {
      const cap = p.maxEnergy + (hasStatus(p, "钻石镐") ? 2 : 0);
      p.energy = Math.min(cap, p.energy + 4);
      addStatus(g, p, "欠钱", { turns: 1 });
      log(g, `${p.name} +4 能量（下回合回能 -3）`);
      return;
    }
    case "selfharm": {
      loseHp(g, p, card.self, card.name);
      if (g.phase === "ended") return;
      drawCards(g, p, card.draw);
      log(g, `${p.name} 摸了 ${card.draw} 张牌`);
      return;
    }
    case "yoyo": {
      dealAttackDamage(g, p, opp, card.value, card.name);
      return;
    }
    // ---- 单位 ----
    case "summon": {
      const u = { name: card.name, hp: card.hp, maxHp: card.hp, atk: card.atk, resist: card.resist || 0 };
      p.units.push(u);
      log(g, `${p.name} 召唤了${card.name}（${u.hp} 血 / 每回合 ${u.atk} 点）`);
      fxPush(g, { kind: "summon", seq: g.lastPlay ? g.lastPlay.seq : 0, player: g.players.indexOf(p),
        card: card.name, unit: card.name });
      // 立即造成伤害
      dealAttackDamage(g, p, opp, u.atk, card.name + "的攻击", true);
      return;
    }
    // ---- 回复 ----
    case "heal": {
      const before = p.hp;
      healHp(g, p, card.heal, card.name);
      fxPush(g, { kind: "heal", seq: g.lastPlay ? g.lastPlay.seq : 0, player: g.players.indexOf(p),
        card: card.name, amount: floor05(p.hp - before), hpAfter: p.hp });
      return;
    }
    case "milk": {
      const b2 = p.hp;
      healHp(g, p, card.heal, card.name);
      clearStatuses(g, p);
      fxPush(g, { kind: "heal", seq: g.lastPlay ? g.lastPlay.seq : 0, player: g.players.indexOf(p),
        card: card.name, amount: floor05(p.hp - b2), hpAfter: p.hp });
      return;
    }
    case "heal_half_lost": {
      const lost = p.maxHp - p.hp;
      const b3 = p.hp;
      healHp(g, p, floor05(lost * 0.5), card.name);
      fxPush(g, { kind: "heal", seq: g.lastPlay ? g.lastPlay.seq : 0, player: g.players.indexOf(p),
        card: card.name, amount: floor05(p.hp - b3), hpAfter: p.hp });
      return;
    }
    case "rotten": {
      const b4 = p.hp;
      healHp(g, p, card.heal, card.name);
      addStatus(g, p, "中毒");
      log(g, `${p.name} 中毒 1 层`);
      fxPush(g, { kind: "heal", seq: g.lastPlay ? g.lastPlay.seq : 0, player: g.players.indexOf(p),
        card: card.name, amount: floor05(p.hp - b4), hpAfter: p.hp });
      return;
    }
    // ---- 特殊 ----
    case "thorns": {
      p.thorns = true;
      log(g, `${p.name} 获得永久反甲（受到攻击时反弹 50%）`);
      return;
    }
    case "musicbox": {
      addStatus(g, p, "诅咒", { turns: card.turns });
      log(g, `${p.name} 进入八音盒状态（${card.turns} 回合内绝对不死）`);
      return;
    }
    case "scapegoat": {
      g.pending = { kind: "scapegoat", player: idx, reason: card.name };
      return;
    }
    default:
      log(g, `⚠️ 未实现的效果：${e}`);
      return;
  }
}

// ---------- 多段攻击的逐段结算 ----------
function resolveMulti(g) {
  const pd = g.pending;
  if (!pd || pd.kind !== "multi") return;
  // ⚠️ 兼容：after 里可能没带 attacker/defender（老代码就漏了这两个字段）
  //    → 缺了会变成 g.players[undefined] → calcDamage 直接崩
  const attacker = pd.attacker !== undefined ? pd.attacker : pd.attackerIdx;
  const defender = pd.defender !== undefined ? pd.defender : pd.defenderIdx;
  if (pd.done >= pd.hits) {
    g.pending = null;
    return;
  }
  if (attacker === undefined || defender === undefined) {
    console.log("[多段攻击] ⚠️ pending 里没有 attacker/defender，无法继续 → 直接结束");
    g.pending = null;
    return;
  }
  // 请求防守方对第 done+1 段做格挡决策
  g.pending = {
    kind: "block",
    attacker: attacker,
    defender: defender,
    amount: calcDamage(g, g.players[defender], pd.perHit, g.players[attacker]),
    reason: `${pd.reason}（第 ${pd.done + 1} 段）`,
    // ⚠️ after 里**必须**带上 attacker/defender，否则下一段没法算伤害（会崩）
    after: {
      kind: "multi",
      attacker: attacker,
      defender: defender,
      hits: pd.hits,
      done: pd.done + 1,
      perHit: pd.perHit,
      reason: pd.reason,
    },
    attackerIdx: attacker,
    defenderIdx: defender,
  };
}

// ---------- 结束回合 ----------
// 返回 true 表示"这回合还没真正结束"（有事情要玩家决定）
function endTurn(g) {
  const p = g.players[g.current];

  if (g.phase === "ended") return;

  // 末日：自己回合内未出牌则扣 2 血
  if (hasStatus(p, "末日")) {
    if (p.playedNamesThisTurn.length === 0) {
      loseHp(g, p, 2, "末日（未出牌）");
      if (g.phase === "ended") return;
    }
  }

  // ① 弃牌到上限 → 让玩家自己选弃哪几张
  const limit = p.handLimitThisTurn !== undefined ? p.handLimitThisTurn : p.maxHand;
  if (p.hand.length > limit) {
    g.pending = {
      kind: "discard_to_limit",
      player: g.current,
      count: p.hand.length - limit,
      limit,
    };
    log(g, `${p.name} 手牌 ${p.hand.length} 张，超过上限 ${limit} → 需要弃 ${g.pending.count} 张`);
    return true;
  }

  // ② 没有要决定的 → 正常结束
  finishTurn(g);
  return false;
}

// 真正执行"换手"
function finishTurn(g) {
  const p = g.players[g.current];

  // 状态回合数递减（限时的）
  for (const s of p.statuses) {
    if (s.type === "幸运儿" || s.type === "红绿灯" || s.type === "欠钱") {
      s.turns = (s.turns || 1) - 1;
    }
  }
  p.statuses = p.statuses.filter((s) => s.turns === null || s.turns > 0);

  // 换手
  g.current = 1 - g.current;
  g.turn += 1;
  p.shieldThisTurn = 0;
  p.mineTriggeredThisTurn = false;

  if (g.phase === "ended") return;
  startTurn(g);
}

// 玩家选完要弃的牌之后调用
// 玩家选完"要弃哪几张"之后调用
//   ⚠️ 必须用 pending 里记的 player，**不能用 g.current**
//      之前用 g.current → 万一回合已经换人了，就会从错误的人手里扣牌，
//      手牌数没降下来 → pending 又被挂上 → **永久死循环**（实测会卡死）
function resolveDiscardToLimit(g, names, whoIdx) {
  let who = whoIdx;
  if (who === undefined || who === null) {
    who = (g.pending && g.pending.kind === "discard_to_limit" && g.pending.player !== undefined)
      ? g.pending.player : g.current;
  }
  const p = g.players[who];
  if (!p) { g.pending = null; return; }
  let n = 0;
  for (const name of (names || [])) {
    const i = p.hand.indexOf(name);
    if (i >= 0) { p.hand.splice(i, 1); g.discard.push(name); n++; }
  }
  log(g, `${p.name} 弃掉了 ${n} 张牌`);
  // 断头台：弃牌时受 5 点伤害
  if (n > 0 && hasStatus(p, "断头台")) {
    loseHp(g, p, 5, "断头台");
    if (g.phase === "ended") { g.pending = null; return; }
  }
  g.pending = null;
  // ⚠️ 只有"弃牌的人就是当前回合的人"时才推回合
  //    否则会出现"把回合推给错误的人"（另一个死循环来源）
  if (who === g.current) finishTurn(g);
}

// 玩家选完"定时炸弹"怎么处理之后调用
//   ⚠️ 用 pending 里记的 player（抽到炸弹的人），不能用 g.current
//      —— 定时炸弹可能是"回合开始抽牌"时抽到的，
//         也可能是别的效果让对方抽到的，那时 g.current 未必是抽到的人
//
//  📖 设计文档的规则（第 301 行）：
//     「放到牌库顶；抽到者须在本回合打出（**费用每次 +1**），否则吃 6 点伤害并丢掉」
//     ⚠️ 之前"打回去"**不检查也不扣能量** → 永远免费 → 双方无限对传
//        （实测 1502 回合、对传 1478 次、双方满血，游戏永远打不完）
//     现在照文档实现：打回去要付 3 + (已经传过几次) 的能量；
//     能量不够就只能"丢掉吃 6 点"。
//
// 返回 { ok, error?, cost? } —— 调用方（服务器）据此回绝无效操作
function timeBombCost(g) {
  return 3 + Math.max(0, (g.timeBombCount || 0));
}

function resolveTimeBomb(g, choice) {
  const who = (g.pending && g.pending.kind === "timebomb" && g.pending.player !== undefined)
    ? g.pending.player : g.current;
  const p = g.players[who];
  if (!p) { g.pending = null; return { ok: false, error: "找不到玩家" }; }
  const idx = p.hand.indexOf("定时炸弹");
  if (idx < 0) { g.pending = null; return { ok: false, error: "手上没有炸弹" }; }

  if (choice === "discard") {
    // 丢掉炸弹 + 吃 6 点伤害
    p.hand.splice(idx, 1);
    g.discard.push("定时炸弹");
    log(g, `${p.name} 丢掉了定时炸弹（吃 6 点伤害）`);
    loseHp(g, p, 6, "定时炸弹");
  } else {
    // 打出去（放到对方牌库顶）—— 要付能量，费用每次 +1（照设计文档）
    const cost = timeBombCost(g);
    const realCost = hasStatus(p, "幸运儿") ? floor05(cost / 2) : cost;
    if (p.energy < realCost) {
      // 付不起 → 拒绝（服务器会告诉玩家，客户端只给"丢掉"的选项）
      return { ok: false, error: `打回去要 ${realCost} 能量，你只有 ${p.energy}` };
    }
    p.energy = floor05(p.energy - realCost);
    g.timeBombCount = (g.timeBombCount || 0) + 1;
    p.hand.splice(idx, 1);
    const opp = g.players[1 - who];
    opp.deck.unshift("定时炸弹");
    log(g, `${p.name} 花 ${realCost} 能量把定时炸弹交给了 ${opp.name}（第 ${g.timeBombCount} 轮，下次要 ${timeBombCost(g)} 能量）`);
  }
  g.pending = null;
  // ⚠️ 只有"当前回合的玩家"处理完才算这一回合结束
  if (who !== g.current) return { ok: true };
  if (g.phase === "ended") return { ok: true };
  // 可能还有弃牌要处理
  if (endTurn(g) === true) return { ok: true };
  return { ok: true };
}

// ---------- 导出 ----------
module.exports = {
  newGame,
  fxPush,
  fxPlay,
  startTurn,
  endTurn,
  finishTurn,
  resolveDiscardToLimit,
  resolveTimeBomb,
  timeBombCost,
  resolveSpring,
  checkSpring,
  playCard,
  canPlay,
  drawCards,
  loseHp,
  healHp,
  endGame,
  calcDamage,
  dealAttackDamage,
  applyDamage,
  getStatus,
  statusStacks,
  hasStatus,
  addStatus,
  clearStatuses,
  resistanceOf,
  floor05,
  shuffle,
  resolveMulti,
};
