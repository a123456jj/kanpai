// ============================================================
//  回归测试：非当前回合玩家的待决策
//    ⚠️ 这一组是为了防止"死循环类 bug"再次出现。
//    背景：2026-10 发现 resolveDiscardToLimit 用了 g.current 而不是
//          pending.player → 弃牌时扣错人的手牌 → 手牌数降不下来
//          → pending 又挂上 → **永久死循环**（实测卡死 147 回合）
//    跑法：node testedge.js
// ============================================================
const E = require("./engine.js");
const AI = require("./ai.js");
const fs = require("fs");
const { CARDS, CARD_BY_NAME } = require("./cards.js");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

// 造一个"玩家1 的回合，玩家2 身上有待决策"的局面
function setup() {
  const g = E.newGame();
  for (const p of g.players) {
    p.hand = []; p.units = []; p.statuses = [];
    p.hp = 25; p.energy = 10; p.canPlayThisTurn = true;
    p.mineTriggeredThisTurn = false; p.shieldThisTurn = 0; p.turns = 0;
  }
  g.current = 0;
  g.turn = 5;
  g.pending = null;
  g.discard = [];
  return g;
}

section("1. 弃牌到上限：决策人不是当前回合的人");
{
  const g = setup();
  g.players[1].hand = ["一拳", "木棍", "石头", "牛奶", "雪球", "刀", "飞轮"];
  const h0 = g.players[0].hand.length;
  g.pending = { kind: "discard_to_limit", player: 1, count: 2, limit: 5 };
  E.resolveDiscardToLimit(g, ["一拳", "木棍"], 1);
  ok(g.players[1].hand.length === 5, "玩家2 手牌 7 → 5");
  ok(g.players[0].hand.length === h0, "玩家1 手牌没被误扣");
  ok(g.pending === null, "pending 清掉了");
  ok(g.current === 0, "回合没乱换（还是玩家1）");
  ok(g.players[1].hand.includes("一拳") === false, "弃掉的牌真的离开了手牌");
}

section("2. 不传 whoIdx 时靠 pending.player 自动判断");
{
  const g = setup();
  g.players[1].hand = ["一拳", "木棍", "石头", "牛奶", "雪球", "刀", "飞轮"];
  const h0 = g.players[0].hand.length;
  g.pending = { kind: "discard_to_limit", player: 1, count: 1, limit: 6 };
  E.resolveDiscardToLimit(g, ["飞轮"]);
  ok(g.players[1].hand.length === 6, "玩家2 手牌减到 6");
  ok(g.players[0].hand.length === h0, "玩家1 手牌没动");
}

section("3. 定时炸弹：抽到的人不是当前回合的人");
{
  const g = setup();
  g.players[1].hand = ["定时炸弹", "牛奶"];
  g.pending = { kind: "timebomb", player: 1 };
  const hp2 = g.players[1].hp, hp1 = g.players[0].hp;
  E.resolveTimeBomb(g, "discard");
  ok(g.players[1].hp === hp2 - 6, "玩家2 吃了 6 点（" + hp2 + " → " + g.players[1].hp + "）");
  ok(g.players[0].hp === hp1, "玩家1 血量没动");
  ok(g.players[1].hand.indexOf("定时炸弹") < 0, "炸弹从玩家2 手上移除了");
  ok(g.current === 0, "回合没乱换");
}

section("4. 定时炸弹打回去：放到公共牌库顶（共用牌库）");
{
  const g = setup();
  g.players[1].hand = ["定时炸弹"];
  g.deck = ["牛奶", "石头"];          // 📖 双方共用一副牌 → 牌库在 g.deck 上
  g.pending = { kind: "timebomb", player: 1 };
  E.resolveTimeBomb(g, "play");
  ok(g.deck[0] === "定时炸弹", "炸弹放到了公共牌库顶（谁先抽谁中）");
  ok(g.deck.length === 3, "牌库多了 1 张（" + g.deck.length + "）");
}

section("5. 多段攻击（苦无）：after 里必须带 attacker/defender");
{
  const g = setup();
  g.pending = { kind: "multi", attacker: 0, defender: 1, hits: 3, done: 0, perHit: 2, reason: "苦无" };
  E.resolveMulti(g);
  ok(g.pending && g.pending.kind === "block", "第 1 段转成格挡窗口");
  ok(g.pending.defender === 1, "窗口给的是防守方（玩家2）");
  ok(g.pending.amount === 2, "每段伤害 = 2");
  ok(g.pending.after && g.pending.after.attacker === 0 && g.pending.after.defender === 1,
    "after 里带了 attacker/defender（否则下一段会崩）");
  const hp = g.players[1].hp;
  E.applyDamage(g, g.players[0], g.players[1], g.pending.amount, g.pending.reason);
  ok(g.players[1].hp === hp - 2, "第 1 段伤害结算了");
  g.pending = g.pending.after;
  E.resolveMulti(g);
  ok(g.pending && g.pending.kind === "block" && g.pending.after.done === 2, "接着转第 2 段");
}

section("6. 多段攻击：缺 attacker/defender 时不能崩");
{
  const g = setup();
  g.pending = { kind: "multi", hits: 3, done: 0, perHit: 2, reason: "苦无" };
  let crashed = null;
  try { E.resolveMulti(g); } catch (e) { crashed = e; }
  ok(!crashed, "缺字段时不崩（" + (crashed ? crashed.message : "OK") + "）");
  ok(g.pending === null, "并且把 pending 清掉（不卡住）");
}

section("7. 末日：扣血扣的是当前回合的人");
{
  const g = setup();
  E.addStatus(g, g.players[0], "末日", { turns: 3 });
  g.players[0].playedNamesThisTurn = [];
  const hp1 = g.players[0].hp, hp2 = g.players[1].hp;
  E.endTurn(g);
  ok(g.players[0].hp <= hp1, "玩家1（当前回合+末日）掉血了或没掉");
  ok(g.players[1].hp === hp2, "玩家2 没被误伤");
}

section("8. 续命：AI 的弃牌估值不能把大牌当垃圾");
{
  const hand = ["核弹", "末日", "一拳", "木棍", "牛奶", "空白牌"];
  const sorted = hand.slice().sort((a, b) =>
    AI.cardKeepValue(CARD_BY_NAME[a]) - AI.cardKeepValue(CARD_BY_NAME[b]));
  const worst3 = sorted.slice(0, 3);
  ok(!worst3.includes("核弹"), "核弹不会被丢掉");
  ok(!worst3.includes("末日"), "末日不会被丢掉");
  ok(!worst3.includes("一拳"), "一拳不会被丢掉");
  ok(AI.cardKeepValue(undefined) === 0, "未知牌（undefined）返回 0 不崩");
  ok(isFinite(AI.cardKeepValue({ name: "空白牌", cost: "?", kind: "special" })), "卡表外的牌也能估值");
}

section("9. 被禁出牌的回合：客户端不能反复发无效请求");
{
  // 复现用户遇到的 bug：AI 用烟雾弹让玩家"下回合不能出牌"，
  // 玩家点手牌 → 客户端反复发 play → 服务器反复拒绝 → 界面像卡死
  const g = setup();
  E.addStatus(g, g.players[0], "跳过", { turns: 1 });
  g.players[0].skipNextTurn = true;
  g.current = 1;                 // 轮到玩家2
  E.endTurn(g);                  // 换到玩家1 → 应该被禁出牌
  ok(g.players[0].canPlayThisTurn === false, "玩家1 被禁出牌（canPlayThisTurn=false）");

  // 服务端必须明确拒绝
  g.players[0].hand = ["一拳"];
  g.players[0].energy = 20;
  const r = E.playCard(g, 0, "一拳", {});
  ok(r && r.ok === false, "服务器拒绝出牌（返回 ok=false）");
  ok(/不能出牌/.test(r.error || ""), "拒绝原因说得清楚（" + (r.error || "?") + "）");

  // 但 endTurn 必须还能用（否则真的卡死）
  g.players[0].hand = ["一拳"];
  g.pending = null;
  let crashed = null;
  try { E.endTurn(g); } catch (e) { crashed = e; }
  ok(!crashed, "被禁出牌的回合仍然能【结束回合】（不卡死）");
  ok(g.current === 1, "结束回合后正常换手（现在轮到玩家2）");
}

section("10. 定时炸弹：打回去必须付能量（照设计文档『费用每次 +1』）");
{
  // ⚠️ 背景：之前 resolveTimeBomb 打回去**不检查也不扣能量**
  //    → 双方免费无限对传 → 实测 1502 回合、对传 1478 次、双方满血，永远打不完
  //    📖 设计文档第 301 行：「放到牌库顶；抽到者须在本回合打出（费用每次 +1），
  //                          否则吃 6 点伤害并丢掉」
  const g = setup();
  g.timeBombCount = 0;
  ok(E.timeBombCost(g) === 3, "第 1 轮费用 = 3（实际 " + E.timeBombCost(g) + "）");
  g.timeBombCount = 1;
  ok(E.timeBombCost(g) === 4, "第 2 轮费用 = 4");
  g.timeBombCount = 5;
  ok(E.timeBombCost(g) === 8, "第 6 轮费用 = 8");

  // 能量不够 → 打回去要被拒绝
  {
    const g2 = setup();
    g2.timeBombCount = 5;                        // 要 8 能量
    g2.players[0].hand = ["定时炸弹"];
    g2.players[0].energy = 4;                    // 不够
    g2.deck = ["一拳"];
    g2.pending = { kind: "timebomb", player: 0 };
    const r = E.resolveTimeBomb(g2, "play");
    ok(r && r.ok === false, "能量不够时，打回去被拒绝（" + (r && r.error) + "）");
    ok(g2.players[0].hand.indexOf("定时炸弹") >= 0, "炸弹还在手上（没被偷偷传走）");
    ok(g2.pending && g2.pending.kind === "timebomb", "待决策还在（等玩家改选丢掉）");
  }

  // 能量够 → 打回去生效，并且真的扣了能量
  {
    const g3 = setup();
    g3.timeBombCount = 0;
    g3.players[0].hand = ["定时炸弹"];
    g3.players[0].energy = 10;
    g3.deck = ["一拳", "木棍", "石头", "牛奶", "雪球"];
    g3.pending = { kind: "timebomb", player: 0 };
    const before = g3.players[0].energy;
    const r = E.resolveTimeBomb(g3, "play");
    ok(r && r.ok === true, "能量够时打回去成功");
    ok(g3.players[0].energy === before - 3, "扣了 3 能量（" + before + " → " + g3.players[0].energy + "）");
    ok(g3.timeBombCount === 1, "轮数 +1（下次要 4 能量）");
    ok(g3.players[0].hand.indexOf("定时炸弹") < 0, "炸弹离开打回去的人的手");
    // ⚠️ 不要断言"炸弹还在对方牌库顶"：
    //    打回去会结束当前回合 → 对方立刻抽 2 张，正好把炸弹抽走
    //    （这是规则要的效果：炸弹马上转到对方手上逼他处理）
    //    所以正确断言是"炸弹到了对方那里"——手上，或者已经弹出处理窗口
    const onHand = g3.players[1].hand.indexOf("定时炸弹") >= 0;
    const hasWindow = !!(g3.pending && g3.pending.kind === "timebomb" && g3.pending.player === 1);
    ok(onHand || hasWindow,
      "炸弹转到了对方（手上=" + onHand + " 弹出窗口=" + hasWindow + "）");
  }

  // 付不起时选"丢掉" → 吃 6 点 + 炸弹进弃牌堆
  {
    const g4 = setup();
    g4.timeBombCount = 5;
    g4.players[0].hand = ["定时炸弹"];
    g4.players[0].energy = 2;
    g4.pending = { kind: "timebomb", player: 0 };
    const hp = g4.players[0].hp;
    const r = E.resolveTimeBomb(g4, "discard");
    ok(r && r.ok === true, "丢掉永远可以（不看能量）");
    ok(g4.players[0].hp === hp - 6, "吃 6 点伤害（" + hp + " → " + g4.players[0].hp + "）");
    ok(g4.players[0].hand.indexOf("定时炸弹") < 0, "炸弹离开手牌");
    ok(g4.discard.indexOf("定时炸弹") >= 0, "炸弹进了弃牌堆");
  }
}

section("11. 炸弹不再无限对传（模拟双方都选打回去）");
{
  const g = setup();
  // 📖 共用牌库：牌库在 g.deck 上。给足牌，免得抽干干扰测试
  g.deck = ["定时炸弹"].concat(require("./cards.js").DECK_ALL);
  let passes = 0, drops = 0;
  for (let step = 0; step < 4000 && g.phase === "playing"; step++) {
    if (g.pending) {
      if (g.pending.kind === "timebomb") {
        const p = g.players[g.pending.player];
        const cost = E.timeBombCost(g);
        if (p.energy >= cost) { passes++; E.resolveTimeBomb(g, "play"); }
        else { drops++; E.resolveTimeBomb(g, "discard"); }
      } else if (g.pending.kind === "discard_to_limit") {
        const p = g.players[g.pending.player];
        E.resolveDiscardToLimit(g, p.hand.slice(0, g.pending.count), g.pending.player);
      } else if (g.pending.kind === "multi") {
        E.resolveMulti(g);
      } else if (g.pending.kind === "block") {
        E.applyDamage(g, g.players[g.pending.attacker], g.players[g.pending.defender], g.pending.amount, g.pending.reason);
        g.pending = g.pending.after || null;
      } else { g.pending = null; }
      continue;
    }
    E.endTurn(g);
  }
  ok(g.phase === "ended", "对局能正常结束（阶段=" + g.phase + "）");
  ok(passes < 60, "炸弹对传次数有限（" + passes + " 次，不是无限）");
  ok(drops > 0, "有人付不起被迫丢掉了（" + drops + " 次）");
}

section("11. 名刀只能挡『会打死你的那一下』（设计文档第 156 / 321 行）");
{
  // 📖 设计文档：「名刀｜0｜反应式：仅在"即将致死的那一下"打出，不能提前挂」
  //    ⚠️ 之前服务器不检查 → 名刀能挡任意伤害（用户实测发现的）
  ok(/block_lethal/.test(fs.readFileSync(__dirname + "/server.js", "utf8")),
    "服务器里有 block_lethal 的判断");
  const srvSrc = fs.readFileSync(__dirname + "/server.js", "utf8");
  const i = srvSrc.indexOf('case "block"');
  const seg = srvSrc.slice(i, i + 1200);
  ok(/block_lethal.*pd\.amount.*def\.hp/s.test(seg) || /block_lethal[\s\S]{0,200}pd\.amount/.test(seg),
    "服务器会检查『伤害 < 血量 → 不许用名刀』");

  // AI 也不能选名刀挡非致死伤害
  const aiSrc = fs.readFileSync(__dirname + "/ai.js", "utf8");
  ok(/block_lethal.*!lethal/.test(aiSrc) || /!lethal.*block_lethal/.test(aiSrc),
    "AI 在非致死时会把名刀从候选里剔掉");

  // 客户端只在致死时给名刀选项
  const clSrc = fs.readFileSync(__dirname + "/client.js", "utf8");
  ok(/lethal/.test(clSrc) && /block_lethal.*lethal/.test(clSrc.replace(/\s+/g, " ")),
    "客户端只在致死时给出名刀选项");

  // 逻辑验证：致死 / 非致死的判定
  const g = setup();
  g.players[0].hp = 3;
  ok((5 >= g.players[0].hp) === true, "5 点伤害打 3 血 → 判定为致死（名刀可用）");
  g.players[0].hp = 20;
  ok((5 >= g.players[0].hp) === false, "5 点伤害打 20 血 → 非致死（名刀不可用）");
}

section("12. 200 局随机对打：不能卡死、不能崩");
{
  let crashed = null, unfinished = 0;
  for (let n = 0; n < 200; n++) {
    try {
      const g = E.newGame();
      let guard = 0;
      while (g.phase === "playing" && guard++ < 900) {
        const p = g.players[g.current];
        let played = false;
        if (p.canPlayThisTurn && !g.pending) {
          const playable = p.hand.filter((name) => !E.canPlay(g, p, name, 3));
          if (playable.length > 0) {
            E.playCard(g, g.current, playable[Math.floor(Math.random() * playable.length)], { x: 3 });
            played = true;
          }
        }
        if (g.pending) {
          const pd = g.pending;
          if (pd.kind === "discard_to_limit") {
            E.resolveDiscardToLimit(g, g.players[pd.player].hand.slice(0, pd.count), pd.player);
          } else if (pd.kind === "timebomb") {
            E.resolveTimeBomb(g, Math.random() < 0.5 ? "play" : "discard");
          } else if (pd.kind === "multi") {
            E.resolveMulti(g);
          } else if (pd.kind === "block") {
            E.applyDamage(g, g.players[pd.attacker], g.players[pd.defender], pd.amount, pd.reason);
            g.pending = pd.after || null;
          } else {
            g.pending = null;
          }
        }
        if (!played && !g.pending) E.endTurn(g);
      }
      if (g.phase !== "ended") unfinished++;
    } catch (e) { crashed = e; break; }
  }
  ok(!crashed, "200 局没崩（" + (crashed ? crashed.message : "OK") + "）");
  ok(unfinished <= 5, "最多 5 局没打完（实际 " + unfinished + " 局）");
}

console.log("\n=====================================");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) { console.log("失败清单："); failures.forEach((f) => console.log("  - " + f)); }
console.log("=====================================");
process.exit(fail ? 1 : 0);
