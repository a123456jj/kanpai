// ============================================================
//  🤖 AI 对手
//    设计原则：
//      ① **只看公开信息** —— 血量、能量、手牌数、牌库数、场上单位、状态、战报。
//         绝不偷看对方手牌内容（那是作弊，不是 AI）。
//      ② 不出"人类做不到的操作" —— 所有决策都走和真人一样的出口
//         （服务器拿到 AI 的决策后，照样调 resolvePending / playCard）
//      ③ 有难度分级：
//           easy   会乱打（30% 概率随机选一张），格挡也经常忘
//           normal 按评分出牌，该挡就挡
//           hard   在 normal 基础上：算斩杀、留格挡费、优先解威胁
//      ④ 有"思考延迟"，让人看清它在干什么
// ============================================================

// ---------- 牌的"参考价值"（只看牌本身，不看局面）----------
function cardBaseValue(card) {
  // ⚠️ 必须能接受 undefined / null：
  //    服务器在"超时兜底、自动弃牌"时会对整副手牌排序，
  //    而手牌里可能有卡表里没有的牌（比如信塞进去的"空白牌"）
  if (!card) return 0;
  const cost = card.cost === "X" ? 4 : (card.cost === "X+1" ? 4 : (Number(card.cost) || 0));
  const v = typeof card.value === "number" ? card.value : 0;
  let s = 0;
  switch (card.effect) {
    // 伤害：数值就是价值
    case "dmg": case "dmg_cond": case "dmg_multi": case "dmg_scale":
      s = v * 1.15; break;
    // 治疗：按需求算（下面 fv 会再乘"缺多少血"）
    case "heal": case "heal_half_lost":
      s = v * 0.85; break;
    // 格挡
    case "block_dmg":
      s = v * 0.95; break;
    case "block_lethal": s = 6.5; break;         // 名刀：免疫致死，很值
    case "block_reflect": s = 3.5 + v * 0.7; break;
    case "block_heal": s = v * 0.8; break;
    case "block_draw": s = 2.6; break;
    // 过牌
    case "draw3": s = 3.2; break;
    case "draw2": s = 2.2; break;
    case "peek": s = 2.4; break;
    // 特殊
    case "summon": s = 5.5; break;
    case "lifesteal": s = 3.2; break;
    case "thorns": s = 2.6; break;
    case "lucky": s = 2.4; break;
    case "convert": s = 1.6; break;
    default: s = 2.2;
  }
  // 效果类（挂状态、破坏对方资源）有额外价值
  if (/饥荒|末日|黑洞|断头台|定时炸弹|土豆地雷|红绿灯|烟雾弹|转头|硫酸/.test(card.name)) s += 2.4;
  if (/欠钱|替罪羊|复制|信|弹簧/.test(card.name)) s += 1.4;
  // 费用惩罚（贵牌要留到关键时候，平时扣分）
  s -= cost * 0.85;
  return s;
}

// ---------- "留着这张牌值多少"（弃牌时用）----------
//   ⚠️ 和 cardBaseValue 的区别：
//     cardBaseValue 算的是"现在打出去划不划算" → 贵牌会被扣很多分
//     cardKeepValue 算的是"留在手里值不值"   → 贵牌虽然是负担但也是资源，
//                                              不能因为"现在打不出来"就扔掉
//   之前用 cardBaseValue 排序弃牌 → 会把核弹/末日这种大牌当垃圾丢掉
function cardKeepValue(card) {
  if (!card) return 0;
  const cost = card.cost === "X" ? 4 : (card.cost === "X+1" ? 4 : (Number(card.cost) || 0));
  const v = typeof card.value === "number" ? card.value : 0;
  let s = 0;
  switch (card.effect) {
    case "dmg": case "dmg_cond": case "dmg_multi": case "dmg_scale":
      s = v * 1.0; break;
    case "heal": case "heal_half_lost": s = v * 0.8; break;
    case "block_dmg": s = v * 0.85; break;
    case "block_lethal": s = 6.5; break;
    case "block_reflect": s = 3.5 + v * 0.6; break;
    case "block_heal": case "block_draw": s = 2.8; break;
    case "draw3": case "draw2": s = 3.0; break;
    case "peek": s = 2.2; break;
    case "summon": s = 5.5; break;
    case "lifesteal": s = 3.5; break;
    case "thorns": s = 2.8; break;
    case "lucky": s = 2.6; break;
    case "convert": s = 1.4; break;
    default: s = 2.2;
  }
  // 关键牌额外加成（这些牌值得留着等机会）
  if (/核弹|末日|天崩地裂|黑洞|斩杀|一拳|断头台|定时炸弹/.test(card.name)) s += 4.5;
  if (/狙击枪|末影龙|皮卡|八音盒|医疗包|回光返照/.test(card.name)) s += 2.2;
  if (/饥荒|土豆地雷|红绿灯|烟雾弹|硫酸/.test(card.name)) s += 1.4;
  // 费用只做轻微惩罚（贵牌是负担，但不是垃圾）
  s -= cost * 0.28;
  return s;
}

// ---------- 场上局面（只看公开信息）----------
function boardInfo(g, me) {
  const foe = g.players[1 - g.players.indexOf(me)];
  const { CARD_BY_NAME } = require("./cards.js");
  return {
    myHp: me.hp, foeHp: foe.hp,
    myEnergy: me.energy, myMax: me.maxEnergy,
    myHand: me.hand.length, foeHand: foe.hand.length,
    foeUnits: foe.units.length, myUnits: me.units.length,
    myStatus: me.statuses.map((s) => s.type),
    foeStatus: foe.statuses.map((s) => s.type),
    foeShield: foe.shieldThisTurn || 0,
    myShield: me.shieldThisTurn || 0,
    shieldCards: me.hand.filter((n) => {
      const c = CARD_BY_NAME[n];
      return c && (c.kind === "block" || /block/.test(c.effect || ""));
    }),
  };
}

// 每张牌在当前局面下的分数
function scoreCard(g, me, cardName, diff) {
  const { CARD_BY_NAME } = require("./cards.js");
  const card = CARD_BY_NAME[cardName];
  if (!card) return -99;
  const b = boardInfo(g, me);
  let s = cardBaseValue(card);
  const cost = card.cost === "X" ? 4 : (card.cost === "X+1" ? 4 : (Number(card.cost) || 0));

  // ① 能斩杀 → 直接加分（hard 会抓，normal 也会）
  const v = typeof card.value === "number" ? card.value : 0;
  const dmgish = /^(dmg|block_reflect)/.test(card.effect || "");
  if (dmgish) {
    const real = Math.max(0, v - b.foeShield);
    if (real >= b.foeHp) s += 25;                       // 这一下能打死
    else if (real >= b.foeHp * 0.5) s += 4;             // 打掉一半以上
  }
  // 单位/持续伤害对"血少的敌人"更值
  if (card.effect === "summon" && b.foeHp <= 10) s += 2.5;

  // ② 治疗：血越少越值
  //    ⚠️ 原来只按"缺多少血"给分，结果自己 6 血时它还是去打人（不保命）
  //       现在：血少时给一个大额固定加成 —— 保命优先于输出
  if (/^heal/.test(card.effect || "")) {
    const need = 25 - b.myHp;
    s = cardBaseValue(card) * (need <= 0 ? 0.15 : Math.min(2.2, need / 8));
    if (b.myHp <= 6) s += 16;                        // 快死了 → 救命第一
    else if (b.myHp <= 10) s += 9;                   // 危险 → 优先治疗
    else if (b.myHp <= 14) s += 3;
  }
  // ③ 格挡牌：手里没别的牌 / 对方能量高 → 留着的价值更高（出它反而扣分）
  if (card.kind === "block") {
    s *= 0.55;                                          // 主动出格挡牌不划算
    if (b.foeHand >= 4 && b.myHp <= 12) s += 2;         // 对方手牌多+自己血少 → 可以出
  }
  // ④ 能量：留 2 点给格挡（hard 更在意）
  const reserve = diff === "hard" ? 3 : (diff === "normal" ? 2 : 0);
  if (cost > b.myEnergy - reserve) s -= 3.5;

  // ⑤ 手上还有更好/更便宜的伤害牌 → 贵牌降权
  if (dmgish && cost >= 5 && b.foeHp > 14) s -= 1.6;

  // ⑥ 对方有大单位 → 优先解单位（单位牌/伤害都行）
  if (b.foeUnits > 0 && (dmgish || card.effect === "summon")) s += 1.6;

  // ⑦ 自己身上有负面状态 → 治疗/清状态优先
  if (b.myStatus.length && /heal|牛奶|回光返照/.test(cardName)) s += 1.8;

  return s;
}

// 选出这一回合要出的牌（可多次调用，每次出完重挑）
function aiChooseCard(g, meIdx, diff) {
  const me = g.players[meIdx];
  if (!me || me.hp <= 0 || g.phase !== "playing") return null;
  // ⚠️ 这一回合被禁止出牌（狙击枪 / 烟雾弹 / 断头台）→ 一张都别出
  //    否则会"出牌失败 → 重试 → 死循环"（之前真出过这个 bug）
  if (me.canPlayThisTurn === false) return null;
  const { CARD_BY_NAME } = require("./cards.js");
  const playable = [];
  for (const name of me.hand) {
    const c = CARD_BY_NAME[name];
    if (!c) continue;
    const cost = c.cost === "X" ? 0 : (c.cost === "X+1" ? 0 : (Number(c.cost) || 0));
    if (cost > me.energy) continue;                       // 能量不够
    if (c.effect === "dmg_cond" && me.hand.length > (c.condHandMax || 3)) continue;  // 石头这类条件牌
    playable.push({ name, s: scoreCard(g, me, name, diff) });
  }
  if (!playable.length) return null;
  playable.sort((a, b) => b.s - a.s);

  // ⚔️ 能一击必杀 → 直接打（优先级最高，比保命还高）
  const foeP = g.players[1 - meIdx];
  const killNow = playable.find((p) => {
    const c = CARD_BY_NAME[p.name];
    if (!c || !/^(dmg|block_reflect)/.test(c.effect || "")) return false;
    const v = typeof c.value === "number" ? c.value : 0;
    return Math.max(0, v - (foeP.shieldThisTurn || 0)) >= foeP.hp;
  });
  if (killNow && !(diff === "easy" && Math.random() < 0.2)) return killNow.name;

  // 💚 保命优先：血很少时，如果手里有治疗牌，先治（easy 偶尔会忘）
  if (me.hp <= 8) {
    const heal = playable.find((p) => {
      const c = CARD_BY_NAME[p.name];
      return c && /^heal/.test(c.effect || "");
    });
    if (heal && (diff !== "easy" || Math.random() < 0.75)) return heal.name;
  }

  // easy：30% 概率乱选
  if (diff === "easy" && Math.random() < 0.3) {
    return playable[(Math.random() * playable.length) | 0].name;
  }
  // normal：前 2 名里随机（不那么死板）
  if (diff !== "hard" && playable.length > 1 && Math.random() < 0.25) {
    return playable[1].name;
  }
  // 分数太低就别出了（省能量）
  if (playable[0].s < -3.5 && diff !== "easy") return null;
  return playable[0].name;
}

// ---------- 各种"待决策"怎么处理 ----------
function aiResolve(g, pd, diff) {
  const { CARD_BY_NAME } = require("./cards.js");
  const meIdx = (pd.kind === "block" || pd.kind === "choice_block")
    ? (pd.defender !== undefined ? pd.defender : pd.player)
    : (pd.player !== undefined ? pd.player : g.current);
  const me = g.players[meIdx];
  const foe = g.players[1 - meIdx];

  switch (pd.kind) {
    // 🛡 要不要格挡
    case "block": {
      const dmg = pd.amount || 0;
      // 能挡的牌（有格挡牌 + 能量够）
      const canUse = me.hand.filter((n) => {
        const c = CARD_BY_NAME[n];
        if (!c || c.kind !== "block") return false;
        const cost = c.cost === "X" ? 0 : (Number(c.cost) || 0);
        return cost <= me.energy;
      });
      if (!canUse.length) return { block: null };

      // 致死伤害 → 必挡（有牌就挡）
      const lethal = dmg >= me.hp;
      // 名刀能挡致死
      const hasMingdao = canUse.includes("名刀");
      if (lethal) {
        if (hasMingdao) return { block: "名刀" };
        // 挡一下能活就挡（easy 有时会忘）
        if (diff === "easy" && Math.random() < 0.35) return { block: null };
        // 挑最能扛的
        const best = canUse.map((n) => ({ n, v: CARD_BY_NAME[n].value || 0 }))
          .sort((a, b) => b.v - a.v)[0];
        return { block: best.n };
      }
      // 不致死：血少才挡，或者伤害够大
      const wantBlock = (me.hp <= 12 && dmg >= 4) || dmg >= 8 || (me.hp <= 8);
      if (!wantBlock) return { block: null };
      if (diff === "easy" && Math.random() < 0.45) return { block: null };

      // 挑"刚好够挡"的最省牌（别用大盾挡小伤害）
      const sorted = canUse.map((n) => ({ n, v: CARD_BY_NAME[n].value || 0 }))
        .sort((a, b) => a.v - b.v);
      const enough = sorted.find((x) => x.v >= dmg) || sorted[sorted.length - 1];
      // 盾反/水晶盾这类有额外效果的优先
      const fancy = canUse.find((n) => /盾反|水晶盾|名刀/.test(n));
      if (fancy && diff !== "easy" && dmg >= 5) return { block: fancy };
      return { block: enough.n };
    }

    // 刀：丢一张牌抵挡
    case "choice_block": {
      if (!me.hand.length) return {};
      if (diff === "easy" && Math.random() < 0.4) return {};
      // 丢最没用的那张
      const worst = me.hand.map((n) => ({ n, v: cardKeepValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => a.v - b.v)[0];
      // 伤害很小就别丢牌了
      if ((pd.amount || 0) <= 2 && me.hp > 12) return {};
      return { discardCard: worst.n };
    }

    // 🌌 黑洞：从对方手上抽掉 N 张
    //   ⚠️ 规则上只能看到"对方有几张手牌"，看不到内容
    //      → AI 只能瞎抽（服务器会校验，抽不到就算了）
    case "blackhole": {
      const t = g.players[pd.target !== undefined ? pd.target : (1 - meIdx)];
      const cnt = Math.min(2, t.hand.length);       // 一般抽 2 张
      if (cnt <= 0) return { take: [] };
      const pool = t.hand.slice();
      const take = [];
      for (let i = 0; i < cnt && pool.length; i++) {
        take.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
      }
      return { take: take };
    }

    // 🏆 战利：看**自己**牌库顶 5 张，选 1 张（这个是自己知道的）
    case "trophy": {
      const top = me.deck.slice(0, Math.min(5, me.deck.length));
      if (!top.length) return { take: null };
      const best = top.map((n) => ({ n, v: cardBaseValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => b.v - a.v)[0];
      return { take: best.n };
    }

    // 窥视：看一眼就行（不用选东西）
    case "peek": return {};

    // 🔀 洗牌：丢 3 张重抽 —— 手牌差就换
    case "mulligan": {
      const hand = me.hand.slice();
      if (hand.length < 3) return { discard: [] };
      const sorted = hand.map((n) => ({ n, v: cardKeepValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => a.v - b.v);
      const worst3 = sorted.slice(0, 3);
      const avgWorst = worst3.reduce((a, x) => a + x.v, 0) / 3;
      if (avgWorst > -1 && diff !== "easy") return { discard: [] };   // 牌还行，不换
      return { discard: worst3.map((x) => x.n) };
    }

    // 🎡 转转：丢牌换能量（挑最没用的丢，别丢过头）
    case "spinner": {
      const need = Math.max(0, me.maxEnergy - me.energy);
      if (need <= 0) return { discard: [] };                          // 能量满了不丢
      const wantN = Math.min(Math.ceil(need / 3), Math.max(0, me.hand.length - 2));
      if (wantN <= 0) return { discard: [] };
      const worst = me.hand.map((n) => ({ n, v: cardKeepValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => a.v - b.v).slice(0, wantN);
      return { discard: worst.map((x) => x.n) };
    }

    // ♻️ 转换：血 ⇄ 能量
    case "convert": {
      // 能量不够 4 且血 > 12 → 拿点血换能量；否则不换
      if (me.energy <= 3 && me.hp > 12) return { direction: "hp2energy", amount: 3 };
      return { amount: 0 };
    }

    // ✉️ 信：塞一张烂牌给对方牌库顶
    case "letter": {
      const others = me.hand.filter((n) => n !== "信");
      if (!others.length) return {};
      const worst = others.map((n) => ({ n, v: cardKeepValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => a.v - b.v)[0];
      return { card: worst.n };
    }

    // 🐐 替罪羊：从**共用**弃牌堆捞回一张（弃牌堆是公开的，能用）
    case "scapegoat": {
      const pool = (g.discard || []).slice();
      if (!pool.length) return {};
      const best = pool.map((n) => ({ n, v: cardBaseValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => b.v - a.v)[0];
      return { card: best.n };
    }

    // 📋 复制：复制**本回合自己打过的**牌（自己知道有哪些）
    case "copy": {
      const played = me.playedNamesThisTurn || [];
      if (!played.length) return {};
      // 只挑现在能量还够的
      const ok = played.filter((n) => {
        const c = CARD_BY_NAME[n];
        if (!c) return false;
        const cost = c.cost === "X" ? 0 : (Number(c.cost) || 0);
        return cost <= me.energy;
      });
      if (!ok.length) return {};
      const best = ok.map((n) => ({ n, v: cardBaseValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => b.v - a.v)[0];
      return { card: best.n };
    }

    // 🧷 弹簧：要不要取消对方的牌
    case "spring": {
      const cost = pd.cost || 3;
      const worth = /核弹|末日|黑洞|天崩地裂|一拳|斩杀|狙击枪|末影龙/.test(pd.cardName || "");
      if (cost > me.energy) return { use: false };
      if (worth) return { use: true };
      if (diff === "easy" && Math.random() < 0.5) return { use: false };
      // 普通牌：血量还行就不浪费
      return { use: me.hp <= 10 };
    }

    // 🗑 弃牌到上限：丢最没用的
    case "discard_to_limit": {
      const cnt = pd.count || 0;
      if (cnt <= 0) return { discard: [] };
      const worst = me.hand.map((n) => ({ n, v: cardKeepValue(CARD_BY_NAME[n]) }))
        .sort((a, b) => a.v - b.v).slice(0, cnt);
      return { discard: worst.map((x) => x.n) };
    }

    // 💣 定时炸弹：打回去 vs 丢掉
    case "timebomb": {
      const cost = 3 + Math.max(0, (g.timeBombCount || 1) - 1);
      if (cost <= me.energy) return { choice: "play" };     // 有能量就打回去
      if (me.hp > 8) return { choice: "discard" };          // 血够就硬吃
      return { choice: "play" };                            // 快死了，赌一把
    }

    // 多段攻击：自动继续
    case "multi": return {};
    case "execute": return {};

    // 不认识的：什么都不做（服务器有兜底）
    default: return {};
  }
}

// ---------- 对外接口 ----------
const AI_DELAY = { easy: 700, normal: 850, hard: 1000 };
function aiDelay(diff, extra) {
  const base = AI_DELAY[diff] || 850;
  return base + (extra || 0) + Math.random() * 400;
}

module.exports = {
  aiChooseCard, aiResolve, aiDelay, cardBaseValue, cardKeepValue, boardInfo,
};
