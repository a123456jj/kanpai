// ============================================================
// 卡牌定义（60 张）
// 每张牌：{ name, cost, kind, text }
//   cost: 能量费用（数字，"X" 表示可变费用，需要在出牌时指定）
//   kind: attack / block / status / control / draw / economy / unit / heal / special
//   effect: 引擎里的实现函数名（见 engine.js）
// ============================================================

const CARDS = [
  // ---------- 攻击 ----------
  { name: "木棍", cost: 1, kind: "attack", effect: "dmg", value: 2, text: "造成 2 点伤害" },
  { name: "手术刀", cost: 2, kind: "attack", effect: "dmg", value: 3, text: "造成 3 点伤害（无附加效果）" },
  { name: "血刃", cost: 3, kind: "attack", effect: "dmg_self", value: 6, self: 2, text: "造成 6 点伤害，自己扣 2 点血" },
  { name: "雪球", cost: "X", kind: "attack", effect: "dmg_x", text: "X 费造成 X 点伤害（X 自选）" },
  { name: "闪电", cost: 3, kind: "attack", effect: "dmg", value: 5, text: "造成 5 点伤害" },
  { name: "狙击枪", cost: 3, kind: "attack", effect: "dmg_lock", value: 6, text: "造成 6 点伤害；下个我方回合不能出牌" },
  { name: "一拳", cost: 7, kind: "attack", effect: "dmg", value: 12, text: "造成 12 点伤害" },
  { name: "苦无", cost: 5, kind: "attack", effect: "dmg_multi", value: 2, hits: 3, text: "造成 3 段 × 2 点伤害（3 次独立攻击事件）" },
  { name: "核弹", cost: 8, kind: "attack", effect: "dmg_discard_random", value: 10, discard: 2, text: "随机丢掉对方 2 张手牌 + 造成 10 点伤害" },
  { name: "石头", cost: 0, kind: "attack", effect: "dmg_cond", value: 2, condHandMax: 3, text: "造成 2 点伤害；手牌 >3 张时不能打出" },

  // ---------- 攻击 + 附带 ----------
  { name: "天崩地裂", cost: 6, kind: "attack", effect: "dmg_shock", value: 6, text: "造成 6 点伤害 + 对方抗性 -1（状态：震荡，永久）" },
  { name: "西瓜", cost: 5, kind: "attack", effect: "dmg_heal", value: 5, heal: 3, text: "造成 5 点伤害 + 回复 3 点血" },
  { name: "斩杀", cost: 5, kind: "attack", effect: "execute", value: 5, execAt: 3, text: "造成 5 点伤害；若对方血量 ≤3 则直接杀掉" },
  { name: "刀", cost: 1, kind: "attack", effect: "choice_block", value: 3, text: "造成 3 点伤害；对方可选择丢一张牌抵挡" },

  // ---------- 格挡 ----------
  { name: "名刀", cost: 0, kind: "block", effect: "block_lethal", text: "反应式：在即将受到致死伤害时打出，抵挡该段伤害" },
  { name: "飞轮", cost: 2, kind: "block", effect: "block_one", text: "反应式：顶掉一段伤害" },
  { name: "圣诞树", cost: 3, kind: "block", effect: "block_draw", text: "反应式：挡一次伤害 + 摸 1 张牌" },
  { name: "盾反", cost: 5, kind: "block", effect: "block_reflect", text: "反应式：不受此段伤害 + 将伤害原地返还" },
  { name: "水晶盾", cost: 6, kind: "block", effect: "block_heal", text: "反应式：抵挡一段伤害 + 回复 1.5 × 挡掉伤害的血" },
  { name: "镇定剂", cost: 1, kind: "block", effect: "shield_next", shield: 5, selfDmg: 1, text: "扣自己 1 点血；下回合获得 5 点护盾（只持续一回合）" },

  // ---------- 放大器 ----------
  { name: "蓄力", cost: 1, kind: "special", effect: "buff_one", mult: 0.5, text: "本回合打出的下一张牌伤害 +0.5 倍" },
  { name: "兴奋剂", cost: 2, kind: "special", effect: "buff_all", mult: 0.5, text: "本回合我方所有伤害 +0.5 倍" },
  { name: "嗜血", cost: 2, kind: "special", effect: "lifesteal", text: "本回合我方造成的所有伤害（含自伤）转化为回血" },
  { name: "复制", cost: "X+1", kind: "special", effect: "copy_card", text: "复制一张本回合我方打出的牌并立即打出（不能保留）" },

  // ---------- 状态 ----------
  { name: "毒鸡汤", cost: 5, kind: "status", effect: "dmg_poison", value: 3, text: "造成 3 点伤害 + 中毒（每回合 1 点，永久，可叠层）" },
  { name: "焚烧", cost: 7, kind: "status", effect: "burn", value: 5, discard: 2, text: "造成 5 点伤害 + 丢掉对方 2 张牌；之后每回合须额外丢 1 张，否则扣 2 血（永久）" },
  { name: "转头", cost: 4, kind: "status", effect: "dmg_antiheal", value: 5, text: "造成 5 点伤害；敌方下一次回血 ×0.5" },
  { name: "末日", cost: 10, kind: "status", effect: "doom", value: 10, text: "造成 10 点伤害；3 回合内对方不回能量，且其回合内未出牌则扣 2 血" },

  // ---------- 控制 ----------
  { name: "断头台", cost: 5, kind: "control", effect: "guillotine", text: "对方下回合无法出牌；其弃牌时造成 5 点伤害" },
  { name: "黑洞", cost: 5, kind: "control", effect: "blackhole", text: "观看对方全部手牌，从中选择 3 张抽掉" },
  { name: "硫酸", cost: 3, kind: "control", effect: "acid", text: "消灭对方所有 3 费及以下的牌" },
  { name: "弹簧", cost: 3, kind: "control", effect: "spring", text: "反应式：对方的出牌被取消，该牌回到其手上（其能量白花）" },
  { name: "烟雾弹", cost: 3, kind: "control", effect: "smoke", text: "对方下回合不能主动出牌" },
  { name: "红绿灯", cost: 1, kind: "control", effect: "trafficlight", turns: 1, text: "对方下回合手牌上限变为 3（规则修改类，牛奶清不掉）" },
  { name: "土豆地雷", cost: 1, kind: "control", effect: "landmine", value: 3, text: "对方下回合只要出了牌 → 扣 3 点血（整回合只触发一次）" },
  { name: "定时炸弹", cost: 3, kind: "special", effect: "timebomb", text: "放到对方牌库顶；其抽到后必须打出（费用每次 +1），否则吃 6 点伤害并丢掉" },
  { name: "信", cost: 0, kind: "control", effect: "letter", text: "从手牌选一张，与其一起放到对方牌库顶" },

  // ---------- 过牌 / 信息 ----------
  { name: "无中生有", cost: 5, kind: "draw", effect: "draw3", text: "摸 3 张牌" },
  { name: "战利", cost: 3, kind: "draw", effect: "trophy", text: "观看牌库顶 5 张，从中选 1 张加入手牌" },
  { name: "窥视", cost: 0, kind: "draw", effect: "peek", text: "观看对方手牌（对方知道被看）" },
  { name: "抽奖", cost: 2, kind: "draw", effect: "lottery", text: "随机抽对方一张牌，造成该牌能量 × 1/2 的伤害（下限 1），再把牌还给他" },
  { name: "洗牌", cost: 1, kind: "draw", effect: "mulligan", text: "丢弃 3 张手牌，然后重新抽 3 张" },

  // ---------- 经济 ----------
  { name: "奖励箱", cost: 5, kind: "economy", effect: "extra_draw", text: "永久：每回合多摸一张牌" },
  { name: "钻石镐", cost: 6, kind: "economy", effect: "extra_energy", text: "永久：每回合回能 +1，能量上限 +2" },
  { name: "转转", cost: 0, kind: "economy", effect: "spinner", text: "额外丢掉 X 张手牌 → 得到 3X 能量" },
  { name: "胡萝卜", cost: 0, kind: "economy", effect: "energy2", text: "+2 能量" },
  { name: "转换", cost: 0, kind: "economy", effect: "convert", text: "血量 ⇄ 能量，汇率 1:1，量自定" },
  { name: "欠钱", cost: 0, kind: "economy", effect: "debt", text: "本回合 +4 能量；下回合回能少 3 点" },
  { name: "苦肉计", cost: 0, kind: "economy", effect: "selfharm", self: 5, draw: 2, text: "扣自己 5 点血 + 摸 2 张牌" },
  { name: "溜溜球", cost: 2, kind: "economy", effect: "yoyo", value: 2, text: "造成 2 点伤害；使用后回到自己手上；每回合限用一次" },

  // ---------- 单位 ----------
  { name: "末影龙", cost: 5, kind: "unit", effect: "summon", hp: 5, atk: 2, resist: 0, text: "单位：5 血，每回合立即造成 2 点伤害；留在场上；我方可替它格挡" },
  { name: "皮卡", cost: 8, kind: "unit", effect: "summon", hp: 6, atk: 3, resist: 1, text: "单位：6 血，每回合立即造成 3 点伤害；自带 1 层抗性" },

  // ---------- 回复 ----------
  { name: "牛奶", cost: 6, kind: "heal", effect: "milk", heal: 7, text: "回复 7 点血 + 解除自身一切状态（规则修改类清不掉）" },
  { name: "医疗包", cost: 3, kind: "heal", effect: "heal", heal: 5, text: "回复 5 点血" },
  { name: "回光返照", cost: 4, kind: "heal", effect: "heal_half_lost", text: "回复已损失血量的 50%" },
  { name: "腐肉", cost: 0, kind: "heal", effect: "rotten", heal: 6, text: "回复 6 点血 + 中毒（每回合扣 1 点，永久）" },

  // ---------- 反甲 ----------
  { name: "反甲", cost: 5, kind: "special", effect: "thorns", text: "永久：受到攻击时，对攻击方造成所受伤害 50% 的反伤（不可被清除）" },

  // ---------- 改写胜负 ----------
  { name: "八音盒", cost: 1, kind: "special", effect: "musicbox", turns: 3, text: "3 回合内绝对不死；3 回合后自动判负（状态：诅咒）" },

  // ---------- 回收 ----------
  { name: "替罪羊", cost: 2, kind: "special", effect: "scapegoat", text: "从共用弃牌堆捞回本回合扔进去的任意 1 张牌" },

  // ---------- 幸运儿 ----------
  { name: "幸运儿", cost: 2, kind: "special", effect: "lucky", text: "本回合所有能量消耗减半" },
];

const CARD_BY_NAME = {};
for (const c of CARDS) CARD_BY_NAME[c.name] = c;

// 每个玩家的牌库
//   ⚠️ 2026-10 改动：原来 DECK_A / DECK_B 是两套**完全不同**的 30 张牌（零重叠），
//      结果是"两个人玩的是两个不同的游戏"（玩家1 永远见不到核弹/末影龙，
//      玩家2 永远见不到一拳/斩杀），而且每局只用掉 60 张里的一半。
//   现在：**双方用同一套牌**（最公平），并且把牌库加深到 40 张
//      （牌池 60 张，抽 40 张 → 每局见面率更高，也不会太快抽完）
//
//   DECK_A / DECK_B 保留成同一个内容（兼容旧代码的引用）
const DECK_ALL = [
  // ── 攻击（14）──
  "一拳", "木棍", "石头", "手术刀", "刀", "血刃", "雪球", "闪电",
  "狙击枪", "苦无", "核弹", "天崩地裂", "斩杀", "西瓜",
  // ── 防御（6）──
  "飞轮", "名刀", "圣诞树", "盾反", "水晶盾", "镇定剂",
  // ── 治疗（4）──
  "牛奶", "医疗包", "回光返照", "腐肉",
  // ── 经济（8）──
  "胡萝卜", "欠钱", "奖励箱", "钻石镐", "转转", "转换", "苦肉计", "溜溜球",
  // ── 状态（4）──
  "毒鸡汤", "焚烧", "末日", "硫酸",
  // ── 控制（8）──
  "断头台", "黑洞", "弹簧", "烟雾弹", "红绿灯", "土豆地雷", "信", "定时炸弹",
  // ── 过牌（5）──
  "无中生有", "窥视", "战利", "抽奖", "洗牌",
  // ── 特殊（9）──
  "嗜血", "复制", "替罪羊", "蓄力", "兴奋剂", "反甲", "幸运儿", "八音盒", "转头",
  // ── 单位（2）──
  "末影龙", "皮卡",
];

// 兼容：两边用同一副
const DECK_A = DECK_ALL.slice();
const DECK_B = DECK_ALL.slice();

module.exports = { CARDS, CARD_BY_NAME, DECK_A, DECK_B, DECK_ALL };
