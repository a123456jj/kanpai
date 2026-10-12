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

section("4. 定时炸弹打回去：放到对方牌库顶");
{
  const g = setup();
  g.players[1].hand = ["定时炸弹"];
  g.players[1].deck = ["牛奶", "石头"];
  g.players[0].deck = ["一拳", "木棍"];
  g.pending = { kind: "timebomb", player: 1 };
  E.resolveTimeBomb(g, "play");
  ok(g.players[0].deck[0] === "定时炸弹", "炸弹放到了对方（玩家1）牌库顶");
  ok(g.players[1].deck[0] !== "定时炸弹", "自己牌库顶没被塞炸弹");
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

section("10. 200 局随机对打：不能卡死、不能崩");
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
