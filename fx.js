/* ============================================================
   演出引擎（动画工具箱）
   用法见 demo.html
   ============================================================ */

(function () {
  // ---------- 把整个页面抖起来 ----------
  const SHAKES = {
    light: "shake-light .30s",
    mid: "shake-mid .45s",
    heavy: "shake-heavy .60s",
    quake: "shake-quake .90s",
  };
  // 找"要抖动的那个容器"：优先 #page，没有就用 body
  //   （游戏页没有 #page，所以必须兜底，否则震屏/褪色/切框全都失效）
  function pageEl() {
    return document.getElementById("page") || document.body;
  }
  function shake(kind) {
    const page = pageEl();
    if (!page) return;
    const anim = SHAKES[kind] || SHAKES.mid;
    page.style.animation = "none";
    void page.offsetWidth;          // 强制重排，让动画能重复触发
    page.style.animation = anim;
    setTimeout(() => { page.style.animation = ""; }, 1000);
  }

  // ---------- 全屏闪光 ----------
  const flashLayer = document.getElementById("fx-flash");
  function flash(color, ms) {
    if (!flashLayer) return;
    flashLayer.style.background = color;
    flashLayer.style.transition = "none";
    flashLayer.style.opacity = "0.95";
    requestAnimationFrame(() => {
      flashLayer.style.transition = `opacity ${ms || 320}ms ease-out`;
      flashLayer.style.opacity = "0";
    });
  }

  // ============================================================
  // 画质档位（自动检测）
  //   手机 / 低配电脑 → 自动降质：少粒子、少模糊、少层数
  //   原因：手机上特效元素太多会卡（核弹一发 700+ 个元素）
  //   手动覆盖：网址加 ?fxq=low 或 ?fxq=high
  // ============================================================
  const Q = (function detectQuality() {
    const LOW = { tier: "low", particle: 0.32, blur: 0.45, layers: 0.5, shake: 0.6 };
    const MID = { tier: "mid", particle: 0.68, blur: 0.8, layers: 0.8, shake: 0.85 };
    const HIGH = { tier: "high", particle: 1, blur: 1, layers: 1, shake: 1 };
    try {
      // 手动覆盖优先
      let force = null;
      try {
        const m = /[?&]fxq=(low|mid|high)/.exec(location.search);
        if (m) force = m[1];
      } catch (e) { }
      if (force === "low") return LOW;
      if (force === "high") return HIGH;
      if (force === "mid") return MID;

      const ua = (navigator && navigator.userAgent) || "";
      const touch = navigator.maxTouchPoints || 0;
      const cores = navigator.hardwareConcurrency || 4;
      const minSide = Math.min(window.innerWidth || 1200, window.innerHeight || 800);
      // 手机/平板：UA 或（触屏 + 屏幕小）
      const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Tablet/i.test(ua) ||
        (touch > 1 && minSide < 700);
      if (isMobile) return LOW;                       // 手机一律最低档（GPU 扛不住）
      if (cores <= 2) return LOW;                     // 很老的电脑
      if (minSide < 600) return LOW;                  // 很小的窗口
      if (cores >= 8) return HIGH;                    // 8 核以上 → 满效果
      return MID;                                     // 4~6 核
    } catch (e) {
      return MID;
    }
  })();
  // 按档位缩放数量
  function qc(n) { return Math.max(1, Math.round(n * Q.particle)); }
  // 按档位缩放模糊值（返回 css 字符串里能用的数字）
  function qb(px) { return Math.max(0, +(px * Q.blur).toFixed(1)); }
  // 低配时是否跳过"装饰性"的东西（尘埃、余烬、热浪…）
  function skipDeco() { return Q.tier === "low"; }
  try { console.log("[演出] 画质档位:", Q.tier, JSON.stringify(Q)); } catch (e) { }

  // ---------- 粒子 ----------
  const fxLayer = document.getElementById("fx");
  function burst(x, y, opts = {}) {
    const n = qc(opts.count || 18);
    const colors = opts.colors || ["#ffd166", "#ff6b35", "#fff", "#ff9f1c"];
    const size = opts.size || 10;
    const speed = opts.speed || 260;
    const life = opts.life || 620;

    for (let i = 0; i < n; i++) {
      const p = document.createElement("div");
      const c = colors[Math.floor(Math.random() * colors.length)];
      const s = size * (0.5 + Math.random());
      p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${s}px;height:${s}px;
        background:${c};border-radius:${opts.square ? "2px" : "50%"};
        pointer-events:none;z-index:9999;`;
      fxLayer.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random());
      const dx = Math.cos(ang) * v;
      const dy = Math.sin(ang) * v;
      p.animate(
        [
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.2)`, opacity: 0 },
        ],
        { duration: life * (0.6 + Math.random() * 0.6), easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
      ).onfinish = () => p.remove();
    }
  }

  // ---------- 冲击环 ----------
  function ring(x, y, color, maxSize) {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:20px;height:20px;
      margin-left:-10px;margin-top:-10px;border:4px solid ${color || "#fff"};border-radius:50%;
      pointer-events:none;z-index:9998;`;
    fxLayer.appendChild(d);
    d.animate(
      [
        { transform: "scale(0.2)", opacity: 1 },
        { transform: `scale(${maxSize || 14})`, opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(.1,.8,.2,1)", fill: "forwards" }
    ).onfinish = () => d.remove();
  }

  // ---------- 大字砸出（伤害数字 / 技能名） ----------
  function bigText(x, y, text, opts = {}) {
    const d = document.createElement("div");
    const size = opts.size || 64;
    d.textContent = text;
    d.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%) scale(0.3);
      font-size:${size}px;font-weight:900;color:${opts.color || "#fff"};
      text-shadow:0 0 12px ${opts.glow || "#ff6b35"}, 0 3px 0 #000, 0 0 30px rgba(0,0,0,.9);
      pointer-events:none;z-index:10000;font-family:Impact,"Microsoft YaHei",sans-serif;
      letter-spacing:2px;`;
    fxLayer.appendChild(d);
    d.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.3) rotate(-12deg)", opacity: 0 },
        { transform: "translate(-50%,-50%) scale(1.25) rotate(-4deg)", opacity: 1, offset: 0.25 },
        { transform: "translate(-50%,-50%) scale(1.0) rotate(-4deg)", opacity: 1, offset: 0.6 },
        { transform: "translate(-50%,-120%) scale(0.9) rotate(-4deg)", opacity: 0 },
      ],
      { duration: opts.life || 1100, easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" }
    ).onfinish = () => d.remove();
  }

  // ---------- 拳头的动画 ----------
  // speed: 0.5 = 慢一倍，1 = 原速，2 = 快一倍
  function punch(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;

    // ① 预备：上方浮出"一拳！"
    const warn = document.createElement("div");
    warn.textContent = "一拳！";
    warn.style.cssText = `position:fixed;left:50%;top:22%;transform:translate(-50%,-50%) scale(0.6);
      font-size:52px;font-weight:900;color:#ffd166;letter-spacing:8px;
      text-shadow:0 0 20px #ff6b35,0 0 50px #ff2d00,0 4px 0 #000;
      pointer-events:none;z-index:10000;font-family:Impact,"Microsoft YaHei",sans-serif;`;
    fxLayer.appendChild(warn);
    warn.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.5)", opacity: 0 },
        { transform: "translate(-50%,-50%) scale(1.15)", opacity: 1, offset: 0.4 },
        { transform: "translate(-50%,-50%) scale(1.0)", opacity: 1, offset: 0.75 },
        { transform: "translate(-50%,-50%) scale(1.3)", opacity: 0 },
      ],
      { duration: T(700), easing: "ease-out", fill: "forwards" }
    ).onfinish = () => warn.remove();

    // ② 拳头出场（横着飞）
    const fist = document.createElement("div");
    fist.textContent = "👊";
    fist.style.cssText = `position:fixed;left:0;top:0;font-size:112px;pointer-events:none;z-index:9997;
      filter:drop-shadow(0 0 22px #ff8c42) drop-shadow(0 0 60px #ff4d00);
      will-change:transform;transform-origin:50% 50%;`;
    fxLayer.appendChild(fist);

    const startX = window.innerWidth + 280;
    const startY = y - 50;
    const endX = x - 56;
    const endY = y - 56;

    // 🔴 关键：飞行时 rotate(96deg) 横躺 → 快撞到时转回 0（"翻正"）
    //    同时用 scaleX/scaleY 做一点"被风压扁"的感觉
    const anim = fist.animate(
      [
        { transform: `translate(${startX}px, ${startY}px) rotate(96deg) scale(2.0, 1.6)`, opacity: 0, offset: 0 },
        { transform: `translate(${startX - 260}px, ${startY}px) rotate(96deg) scale(1.9, 1.55)`, opacity: 1, offset: 0.10 },
        { transform: `translate(${startX - 560}px, ${startY - 8}px) rotate(88deg) scale(1.8, 1.5)`, opacity: 1, offset: 0.34 },
        { transform: `translate(${(startX + endX) / 2}px, ${startY}px) rotate(70deg) scale(1.65, 1.45)`, opacity: 1, offset: 0.58 },
        { transform: `translate(${endX + 100}px, ${endY}px) rotate(34deg) scale(1.45, 1.3)`, opacity: 1, offset: 0.78 },
        { transform: `translate(${endX + 20}px, ${endY}px) rotate(10deg) scale(1.3, 1.2)`, opacity: 1, offset: 0.88 },
        // 撞上：完全翻正（0 度）
        { transform: `translate(${endX}px, ${endY}px) rotate(0deg) scale(1.22)`, opacity: 1, offset: 0.94 },
        // 撒手：往后弹一点、淡出（交给"定格拳"接手）
        { transform: `translate(${endX - 60}px, ${endY}px) rotate(0deg) scale(1.9)`, opacity: 0, offset: 1 },
      ],
      { duration: T(1250), easing: "linear", fill: "forwards" }
    );

    // ③ 尾迹
    let trailing = 0;
    const timer = setInterval(() => {
      const r = fist.getBoundingClientRect();
      burst(r.left + 45, r.top + 45, {
        count: 4, size: 9, speed: 110, life: 520,
        colors: ["#ffb703", "#fb8500", "#fff"],
      });
      if (++trailing > 26) clearInterval(timer);
    }, T(46));

    // 🔴 用"定时器"而不是 onfinish 触发撞击
    //    （onfinish 在部分浏览器/部分时机不触发，会漏掉撞击和声音）
    setTimeout(() => {
      try {
        clearInterval(timer);
        if (fist.parentNode) fist.remove();
        impact(x, y, { speed: sp });
      } catch (e) {
        // 出错也要把声音放出来（免得"画面挂了声音也没了"）
        try { sfx("punch"); } catch (e2) { }
      }
    }, T(1250));
  }

  // ---------- 撞击那一瞬间 ----------
  function impact(x, y, opts = {}) {
    const sp = opts.speed || 1;
    const T = (ms) => ms / sp;

    // 🔊 撞击的声音就在这一刻（低频"咚" + 噪声"啪"）
    sfx("punch");

    // ① "定格拳"：正对着屏幕的一个大拳头，猛地放大后停住
    const slam = document.createElement("div");
    slam.textContent = "👊";
    slam.style.cssText = `position:fixed;left:${x}px;top:${y}px;font-size:150px;
      margin-left:-75px;margin-top:-75px;pointer-events:none;z-index:9999;
      filter:drop-shadow(0 0 30px #fff) drop-shadow(0 0 70px #ff6b35) drop-shadow(0 0 120px #ff2d00);
      transform-origin:50% 50%;`;
    fxLayer.appendChild(slam);
    slam.animate(
      [
        { transform: "scale(0.25) rotate(-18deg)", opacity: 0 },
        { transform: "scale(1.9) rotate(4deg)", opacity: 1, offset: 0.16 },   // 猛地放大
        { transform: "scale(1.55) rotate(0deg)", opacity: 1, offset: 0.34 },  // 回弹一点
        { transform: "scale(1.45) rotate(0deg)", opacity: 1, offset: 0.80 },  // 停住（定格）
        { transform: "scale(2.6) rotate(0deg)", opacity: 0, offset: 1 },      // 散去
      ],
      { duration: T(1250), easing: "cubic-bezier(.15,.9,.25,1)", fill: "forwards" }
    ).onfinish = () => slam.remove();

    // ② 撞击定格光（径向白光，停一下再散）
    const freeze = document.createElement("div");
    freeze.style.cssText = `position:fixed;inset:0;background:radial-gradient(circle at ${x}px ${y}px,
      rgba(255,255,255,.95) 0%, rgba(255,200,80,.55) 30%, rgba(255,80,0,0) 70%);
      pointer-events:none;z-index:9993;`;
    fxLayer.appendChild(freeze);
    freeze.animate(
      [{ opacity: 0.95 }, { opacity: 0.95, offset: 0.35 }, { opacity: 0 }],
      { duration: T(560), easing: "ease-out", fill: "forwards" }
    ).onfinish = () => freeze.remove();

    // ③ 闪光 + 三层冲击环
    flash("#fff", T(360));
    ring(x, y, "#ffd166", 18);
    setTimeout(() => ring(x, y, "rgba(255,255,255,.7)", 11), T(90));
    setTimeout(() => ring(x, y, "rgba(255,120,0,.6)", 24), T(180));

    // ④ 粒子三波
    burst(x, y, { count: 26, size: 15, speed: 380, life: 1100, colors: ["#ffd166", "#ff6b35", "#fff", "#ff2d00"] });
    setTimeout(() => burst(x, y, { count: 18, size: 10, speed: 260, life: 1300, colors: ["#fff", "#ffe066"], square: true }), T(90));
    setTimeout(() => burst(x, y, { count: 14, size: 20, speed: 180, life: 1500, colors: ["#ff8c42", "#ff2d00"] }), T(200));

    // ⑤ 震屏
    shake(opts.shake || "heavy");

    // ⑥ 伤害数字
    if (opts.text) {
      setTimeout(() => bigText(x, y - 40, opts.text, {
        size: opts.textSize || 96, color: "#fff", glow: "#ff4d00", life: T(2000),
      }), T(160));
    }
  }

  // ---------- 音效（用程序生成，不用音频文件） ----------
  let audioCtx = null;
  let audioUnlocked = false;
  const audioWaiters = [];

  // 声音状态变化时通知外面（demo 页面会显示一个小圆点）
  function notifyAudioState(state) {
    try {
      window.dispatchEvent(new CustomEvent("fx-audio-state", { detail: state }));
    } catch (e) { }
  }

  function getCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        notifyAudioState(audioCtx.state);
      } catch (e) { return null; }
    }
    return audioCtx;
  }

  // 🔴 解锁音频：必须在真实用户点击里调用（浏览器的规矩）
  function unlockAudio() {
    const c = getCtx();
    if (!c) return;
    if (c.state === "suspended") {
      c.resume().then(function () {
        audioUnlocked = (c.state === "running");
        notifyAudioState(c.state);
        flushAudioWaiters();     // 解锁成功 → 把排队的音效补播
        try { preloadFiles(); } catch (e) { }   // 顺便探测音效文件
      }).catch(function () { });
    } else {
      audioUnlocked = true;
      notifyAudioState(c.state);
      flushAudioWaiters();
      try { preloadFiles(); } catch (e) { }
    }
  }

  // 页面任何一次点击/按键都尝试解锁（只做一次就够，但多做几次没坏处）
  function installAudioUnlocker() {
    const handler = function () {
      unlockAudio();
      if (audioCtx && audioCtx.state === "running") {
        document.removeEventListener("pointerdown", handler);
        document.removeEventListener("click", handler);
        document.removeEventListener("keydown", handler);
        document.removeEventListener("touchstart", handler);
      }
    };
    document.addEventListener("pointerdown", handler);
    document.addEventListener("click", handler);
    document.addEventListener("keydown", handler);
    document.addEventListener("touchstart", handler);
  }

  // 播放音效（对外统一入口）
  //   只有 SFX_KEEP 里列出的才会真的响；其它一律静音
  //   （用户说音效他自己后面做，现在先只留那三个）
  function sfx(kind, speed) {
    if (!SFX_KEEP[kind]) return;
    playNamed(kind, speed);
  }

  // 解锁之后，把排队的音效补播一遍
  function flushAudioWaiters() {
    if (!audioWaiters.length) return;
    const list = audioWaiters.splice(0, audioWaiters.length);
    for (const w of list) playNow(w[0]);
  }

  function playNow(kind) {
    const c = audioCtx;
    if (!c || c.state !== "running") return;
    const t = c.currentTime;
    const master = 0.9;

    try {
      if (kind === "punch" || kind === "impact") {
        // 低频"咚"
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(170, t);
        osc.frequency.exponentialRampToValueAtTime(36, t + 0.38);
        g.gain.setValueAtTime(0.75 * master, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(g); g.connect(c.destination);
        osc.start(t); osc.stop(t + 0.46);

        // 噪声"啪"
        const len = Math.floor(0.2 * c.sampleRate);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = c.createBufferSource();
        src.buffer = buf;
        const f = c.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 1600;
        const g2 = c.createGain();
        g2.gain.setValueAtTime(0.7 * master, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        src.connect(f); f.connect(g2); g2.connect(c.destination);
        src.start(t);
      }

      if (kind === "thunder") {
        const dur = 1.1;
        const len = Math.floor(dur * c.sampleRate);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const p = i / len;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 1.5);
        }
        const src = c.createBufferSource();
        src.buffer = buf;
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(3600, t);
        f.frequency.exponentialRampToValueAtTime(160, t + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(0.6 * master, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f); f.connect(g); g.connect(c.destination);
        src.start(t);

        // 雷击瞬间的高频"啪"
        const osc = c.createOscillator();
        const og = c.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1100, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.14);
        og.gain.setValueAtTime(0.28 * master, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(og); og.connect(c.destination);
        osc.start(t); osc.stop(t + 0.17);
      }

      if (kind === "doom") {
        // 末日：超低频轰鸣 + 长尾噪声
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(70, t);
        osc.frequency.exponentialRampToValueAtTime(22, t + 1.6);
        g.gain.setValueAtTime(0.5 * master, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
        osc.connect(g); g.connect(c.destination);
        osc.start(t); osc.stop(t + 1.9);

        const dur = 2.0;
        const len = Math.floor(dur * c.sampleRate);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const p = i / len;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 2);
        }
        const src = c.createBufferSource();
        src.buffer = buf;
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(90, t + dur);
        const g2 = c.createGain();
        g2.gain.setValueAtTime(0.45 * master, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f); f.connect(g2); g2.connect(c.destination);
        src.start(t);
      }
    } catch (e) { /* 出错就算了，别影响画面 */ }
  }

  installAudioUnlocker();

  // ============================================================
  // 🔊 音效合成器（v2）
  //   分层做法：瞬态"咔" + 低频"体" + 噪声"质" + 混响"空间"
  //   （变量用 var + 延迟初始化，避免语法/兼容问题）
  // ============================================================
  var noiseBuf = null;
  var masterGain = null;
  var convolver = null;
  var wetGain = null;
  var masterVol = 0.85;
  try {
    var ls = (typeof window !== "undefined" && window) ? window.localStorage : null;
    if (ls && typeof ls.getItem === "function") {
      var sv = ls.getItem("fxVolume");
      if (sv !== null && sv !== undefined && sv !== "") {
        var num = parseFloat(sv);
        if (!isNaN(num) && isFinite(num)) masterVol = Math.max(0, Math.min(1, num));
      }
    }
  } catch (e) { }
  if (isNaN(masterVol) || !isFinite(masterVol)) masterVol = 0.85;   // 兜底

  function initChain() {
    var c = audioCtx;
    if (!c || masterGain) return;
    try {
      masterGain = c.createGain();
      masterGain.gain.value = masterVol;
      var comp = c.createDynamicsCompressor ? c.createDynamicsCompressor() : null;
      if (comp) { masterGain.connect(comp); comp.connect(c.destination); }
      else { masterGain.connect(c.destination); }
      if (c.createConvolver) {
        convolver = c.createConvolver();
        var dur = 1.1, len = Math.floor(c.sampleRate * dur);
        var ir = c.createBuffer(2, len, c.sampleRate);
        for (var ch = 0; ch < 2; ch++) {
          var d = ir.getChannelData(ch);
          for (var i = 0; i < len; i++) {
            var t = i / len;
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8);
          }
        }
        convolver.buffer = ir;
        wetGain = c.createGain();
        wetGain.gain.value = 0.3;
        wetGain.connect(convolver);
        convolver.connect(masterGain);
      }
    } catch (e) { }
  }

  function getNoise() {
    var c = audioCtx;
    if (!c) return null;
    if (!noiseBuf) {
      var len = Math.floor(c.sampleRate * 2);
      noiseBuf = c.createBuffer(1, len, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        // 🔴 振幅控制在 ±1 以内（之前是 3.5 倍，会严重削波）
        d[i] = Math.max(-1, Math.min(1, last * 2.2 + white * 0.35));
      }
    }
    return noiseBuf;
  }

  // 总音量预算：所有音效共用，避免叠加削波
  var SOUND_BUDGET = 0.62;

  function makeCurve(amount) {
    var n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * (1 + amount * 4));
    }
    return curve;
  }

  function tone(o) {
    var c = audioCtx;
    if (!c || !masterGain) return null;
    var t0 = c.currentTime + (o.at || 0);
    var osc = c.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t0);
    if (o.f1 && o.f1 !== o.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur * (o.sweep || 1));
    }
    var g = c.createGain();
    var peak = Math.max(0.0001, (o.gain === undefined ? 0.4 : o.gain));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (o.attack === undefined ? 0.005 : o.attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    var node = osc;
    if (o.sat && c.createWaveShaper) {
      var ws = c.createWaveShaper();
      ws.curve = makeCurve(o.sat);
      ws.oversample = "2x";
      node.connect(ws); node = ws;
    }
    node.connect(g);
    g.connect(masterGain);
    if (wetGain && o.send) {
      var sg = c.createGain(); sg.gain.value = o.send;
      g.connect(sg); sg.connect(wetGain);
    }
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
    return osc;
  }

  function noiseHit(o) {
    var c = audioCtx;
    if (!c || !masterGain) return null;
    var buf = getNoise();
    if (!buf) return null;
    var t0 = c.currentTime + (o.at || 0);
    var src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var f = c.createBiquadFilter();
    f.type = o.type || "lowpass";
    f.frequency.setValueAtTime(Math.max(20, o.f0), t0);
    if (o.f1 && o.f1 !== o.f0) {
      f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    }
    if (o.q !== undefined && f.Q) f.Q.value = o.q;
    var g = c.createGain();
    var peak = Math.max(0.0001, (o.gain === undefined ? 0.3 : o.gain));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (o.attack === undefined ? 0.004 : o.attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(masterGain);
    if (wetGain && o.send) {
      var sg = c.createGain(); sg.gain.value = o.send;
      g.connect(sg); sg.connect(wetGain);
    }
    src.start(t0);
    src.stop(t0 + o.dur + 0.02);
    return src;
  }

  function transient(o) {
    noiseHit({
      type: "highpass", f0: o.f0 || 3500, f1: o.f1 || 1800, q: 0.7,
      dur: o.dur || 0.03, gain: o.gain === undefined ? 0.22 : o.gain,
      attack: 0.001, send: 0.05, at: o.at,
    });
  }

  // ---------- 共振腔：噪声"撞"在一个共振体上，才像真的东西 ----------
  //   f   共振频率   q   尖锐度（越高越"金属"，越低越"闷"）
  //   dur 衰减时间   gain 音量    at 延迟   send 混响量
  function resonant(o) {
    var c = audioCtx;
    if (!c || !masterGain) return;
    var buf = getNoise();
    if (!buf) return;
    var t0 = c.currentTime + (o.at || 0);
    // ① 激励：极短的噪声脉冲
    var src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var exc = c.createGain();
    exc.gain.setValueAtTime(0.0001, t0);
    exc.gain.linearRampToValueAtTime(1, t0 + (o.attack === undefined ? 0.002 : o.attack));
    exc.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.excite || 0.02));
    // ② 共振体：带通 + 高 Q
    var f = c.createBiquadFilter();
    f.type = o.type || "bandpass";
    f.frequency.setValueAtTime(Math.max(20, o.f), t0);
    if (o.f1 && o.f1 !== o.f) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    if (f.Q) f.Q.value = (o.q === undefined ? 12 : o.q);
    // ③ 音量包络
    var g = c.createGain();
    var peak = Math.max(0.0001, (o.gain === undefined ? 0.4 : o.gain));
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(exc); exc.connect(f); f.connect(g); g.connect(masterGain);
    if (wetGain && o.send) {
      var sg = c.createGain(); sg.gain.value = o.send;
      g.connect(sg); sg.connect(wetGain);
    }
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
    return src;
  }

  var SOUNDS = {
    // ============================================================
    // 注意：每层的 gain 是"占总预算的比例"，
    //       乘以 SOUND_BUDGET(0.62) 后才是实际音量
    //       → 所有层加起来不超过 ~0.6，就不会削波
    // ============================================================

    // 打击：闪电那套方法压缩成"短促版"
    punch: function () {
      var B = SOUND_BUDGET;
      transient({ f0: 5000, f1: 2000, dur: 0.025, gain: 0.18 * B });
      noiseHit({ type: "bandpass", f0: 2400, f1: 600, q: 0.9, dur: 0.14, gain: 0.30 * B, attack: 0.001, send: 0.25 });
      noiseHit({ type: "lowpass", f0: 1000, f1: 90, dur: 0.26, gain: 0.55 * B, attack: 0.002, send: 0.2 });
      noiseHit({ type: "lowpass", f0: 340, f1: 60, dur: 0.42, gain: 0.45 * B, attack: 0.004, send: 0.35, at: 0.012 });
      tone({ type: "sine", f0: 130, f1: 38, dur: 0.34, gain: 0.40 * B, sweep: 0.5, sat: 0.3, send: 0.2 });
    },

    // 陨石砸地：飞行的呼啸 +（1.15 秒后）砸地
    //   跟你要求的一样：没有"开场音"，只有飞行声 + 砸地声
    meteor: function (sp) {
      var s = sp || 1;
      sfxFall(1150 / s);                                  // 飞行（越来越近）
      setTimeout(function () { sfxSlam(); }, 1150 / s);   // 砸地
    },

    // 只有砸地（不带飞行）
    slam: function () {
      var B = SOUND_BUDGET;
      // ① 极短高频"咔"——锋利的起点
      transient({ f0: 6000, f1: 1500, dur: 0.028, gain: 0.30 * B });
      // ② 高频"裂"——岩石碎开
      noiseHit({ type: "bandpass", f0: 2600, f1: 500, q: 0.9, dur: 0.30, gain: 0.48 * B, attack: 0.001, send: 0.35 });
      // ③ 中频"啪"——实感
      noiseHit({ type: "bandpass", f0: 1200, f1: 240, q: 0.8, dur: 0.42, gain: 0.42 * B, attack: 0.002, send: 0.3 });
      // ④ 低频"咚"——砸进地面
      noiseHit({ type: "lowpass", f0: 900, f1: 40, dur: 0.85, gain: 0.85 * B, attack: 0.002, send: 0.35 });
      // ⑤ 超低"闷"——一击到底
      tone({ type: "sine", f0: 140, f1: 26, dur: 0.80, gain: 0.95 * B, sweep: 0.35, sat: 0.6, send: 0.3 });
      // ⑥ 第二记余震
      noiseHit({ type: "lowpass", f0: 300, f1: 45, dur: 0.7, gain: 0.42 * B, attack: 0.004, send: 0.5, at: 0.18 });
    },

    // 只有飞行（不带砸地）
    fall: function () {
      sfxFall(1150);
    },

    // 天崩地裂：连续的地震轰隆（不要延迟，立刻响）
    quake: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "lowpass", f0: 500, f1: 60, dur: 1.4, gain: 0.65 * B, attack: 0.01, send: 0.45 });
      tone({ type: "sine", f0: 68, f1: 26, dur: 1.3, gain: 0.55 * B, sweep: 0.5, sat: 0.55, send: 0.35 });
      noiseHit({ type: "bandpass", f0: 1400, f1: 400, q: 0.9, dur: 0.5, gain: 0.30 * B, attack: 0.003, send: 0.3 });
      // 后面的余震
      noiseHit({ type: "lowpass", f0: 260, f1: 50, dur: 1.2, gain: 0.34 * B, attack: 0.06, send: 0.5, at: 0.34 });
      noiseHit({ type: "lowpass", f0: 200, f1: 45, dur: 1.0, gain: 0.26 * B, attack: 0.06, send: 0.5, at: 0.72 });
    },

    // 闪电（你说这个对 —— 只把总音量压到预算内，比例不变）
    thunder: function () {
      var B = SOUND_BUDGET;
      transient({ f0: 6500, f1: 3000, dur: 0.035, gain: 0.20 * B });
      noiseHit({ type: "bandpass", f0: 2600, f1: 700, q: 0.8, dur: 0.22, gain: 0.32 * B, attack: 0.001, send: 0.3 });
      noiseHit({ type: "lowpass", f0: 420, f1: 110, dur: 1.9, gain: 0.48 * B, attack: 0.02, send: 0.45, at: 0.03 });
      tone({ type: "sine", f0: 62, f1: 28, dur: 1.6, gain: 0.42 * B, send: 0.3, at: 0.04 });
      noiseHit({ type: "lowpass", f0: 260, f1: 90, dur: 2.4, gain: 0.18 * B, attack: 0.6, send: 0.5, at: 0.5 });
    },

    // 末日：删掉了开场的"上升音"
    //   只有：陨石飞行的呼啸 → 砸地
    //   ⚠️ 时间要跟动画一样按倍速缩放（T(ms) = ms/sp），否则声音会跟画面对不上
    doom: function (sp) {
      var s = sp || 1;
      // 动画：陨石在 T(1500) 开始飞，飞 T(1150) 后砸地
      setTimeout(function () { sfxFall(1150 / s); }, 1500 / s);
      setTimeout(function () { sfxSlam(); }, (1500 + 1150) / s);
    },

    // 刀锋
    slash: function () {
      var B = SOUND_BUDGET;
      transient({ f0: 9000, f1: 4000, dur: 0.02, gain: 0.18 * B });
      noiseHit({ type: "bandpass", f0: 7000, f1: 900, q: 1.6, dur: 0.22, gain: 0.45 * B, attack: 0.001, send: 0.3 });
      noiseHit({ type: "highpass", f0: 2400, f1: 800, dur: 0.16, gain: 0.22 * B, attack: 0.001, send: 0.25, at: 0.01 });
    },

    // 治疗
    heal: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "bandpass", f0: 3200, f1: 5200, q: 1.2, dur: 0.35, gain: 0.14 * B, attack: 0.06, send: 0.5 });
      var notes = [587.33, 739.99, 880, 1174.66];
      for (var i = 0; i < notes.length; i++) {
        tone({ type: "sine", f0: notes[i], dur: 0.9, gain: 0.13 * B, attack: 0.015, send: 0.55, at: i * 0.075 });
      }
    },

    // 格挡
    block: function () {
      var B = SOUND_BUDGET;
      transient({ f0: 9000, f1: 4500, dur: 0.018, gain: 0.16 * B });
      noiseHit({ type: "bandpass", f0: 5200, f1: 2600, q: 2.4, dur: 0.28, gain: 0.36 * B, attack: 0.001, send: 0.45 });
      tone({ type: "sine", f0: 1860, f1: 1760, dur: 0.55, gain: 0.14 * B, attack: 0.002, send: 0.5 });
      tone({ type: "sine", f0: 2790, f1: 2650, dur: 0.4, gain: 0.09 * B, attack: 0.002, send: 0.5 });
    },

    // 增益
    buff: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "bandpass", f0: 1800, f1: 5200, q: 1.4, dur: 0.5, gain: 0.16 * B, attack: 0.15, send: 0.5 });
      var chord = [392, 493.88, 587.33, 783.99];
      for (var i = 0; i < chord.length; i++) {
        tone({ type: "triangle", f0: chord[i], dur: 1.0, gain: 0.12 * B, attack: 0.03, send: 0.5, at: i * 0.07 });
      }
    },

    // 负面
    debuff: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "bandpass", f0: 1400, f1: 200, q: 1.1, dur: 0.85, gain: 0.32 * B, attack: 0.01, send: 0.4 });
      tone({ type: "sawtooth", f0: 233, f1: 82, dur: 0.85, gain: 0.16 * B, sat: 0.4, send: 0.4 });
      tone({ type: "sine", f0: 219, f1: 76, dur: 0.85, gain: 0.13 * B, send: 0.4 });
    },

    // 暗黑
    dark: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "lowpass", f0: 300, f1: 55, dur: 2.2, gain: 0.50 * B, attack: 0.15, send: 0.5 });
      noiseHit({ type: "bandpass", f0: 90, f1: 260, q: 1.0, dur: 1.6, gain: 0.24 * B, attack: 0.5, send: 0.4 });
      tone({ type: "sine", f0: 52, f1: 24, dur: 2.0, gain: 0.42 * B, sat: 0.5, send: 0.45 });
      noiseHit({ type: "lowpass", f0: 160, f1: 45, dur: 2.6, gain: 0.16 * B, attack: 0.9, send: 0.5, at: 0.6 });
    },

    // 火焰
    fire: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "bandpass", f0: 400, f1: 1500, q: 0.9, dur: 1.1, gain: 0.38 * B, attack: 0.15, send: 0.45 });
      noiseHit({ type: "bandpass", f0: 1300, f1: 500, q: 1.1, dur: 1.3, gain: 0.26 * B, attack: 0.3, send: 0.45, at: 0.15 });
      noiseHit({ type: "lowpass", f0: 180, f1: 90, dur: 1.5, gain: 0.24 * B, attack: 0.2, send: 0.35 });
      transient({ f0: 3500, f1: 1200, dur: 0.05, gain: 0.12 * B });
    },

    // 抽牌
    draw: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "bandpass", f0: 6000, f1: 2800, q: 1.8, dur: 0.13, gain: 0.32 * B, attack: 0.006, send: 0.2 });
      noiseHit({ type: "bandpass", f0: 4200, f1: 6000, q: 1.6, dur: 0.1, gain: 0.24 * B, attack: 0.004, send: 0.2, at: 0.07 });
      tone({ type: "sine", f0: 1318.5, dur: 0.35, gain: 0.12 * B, attack: 0.004, send: 0.5, at: 0.04 });
    },

    // 出牌
    card: function () {
      var B = SOUND_BUDGET;
      noiseHit({ type: "bandpass", f0: 4500, f1: 1800, q: 1.6, dur: 0.05, gain: 0.30 * B, attack: 0.002, send: 0.1 });
      tone({ type: "sine", f0: 520, f1: 300, dur: 0.06, gain: 0.12 * B, send: 0.1 });
    },

    // 八音盒的曲子（3.5 秒，A 小调华尔兹）
    //   曲谱和音色在 musicboxMelody() 里，这里只是接上"名字"的入口
    musicbox: function (sp) {
      musicboxFx._sp = sp || 1;
      musicboxMelody();
    },
  };

  function playNamed(name, speed) {
    var c = getCtx();
    if (!c) return;
    if (c.state !== "running") {
      audioWaiters.push([name, []]);
      unlockAudio();
      return;
    }
    initChain();
    // 🎵 优先用 sounds/ 里的音频文件（如果存在）
    if (playFile(name)) return;
    var fn = SOUNDS[name];
    if (fn) {
      try { fn(speed); } catch (e) { }
      return;
    }
    playNow(name);
  }

  // ============================================================
  // 🎵 音频文件播放（录制的音效比合成的好听得多）
  //   文件放在 sounds/ 里：punch.mp3 / thunder.mp3 / doom.mp3 …
  //   页面加载后会自动探测哪些文件存在；存在就用文件，不存在就用合成音
  // ============================================================
  var fileBuffers = {};     // name → AudioBuffer
  var fileTried = {};       // name → 是否探测过
  var fileOk = {};          // name → 是否可用
  var FILE_EXTS = ["mp3", "ogg", "wav", "m4a"];

  function tryLoadFile(name) {
    if (fileTried[name]) return;
    fileTried[name] = true;
    var c = audioCtx;
    if (!c) return;
    if (typeof fetch !== "function") { fileOk[name] = false; return; }   // 环境不支持就放弃
    var i = 0;
    function next() {
      if (i >= FILE_EXTS.length) { fileOk[name] = false; return; }
      var url = "sounds/" + name + "." + FILE_EXTS[i++];
      fetch(url, { method: "GET" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          if (buf.byteLength < 800) throw new Error("太小");
          return new Promise(function (res, rej) {
            var ok = false;
            try {
              // 兼容新旧浏览器
              var p = c.decodeAudioData(buf, function (b) { ok = true; res(b); }, function (e) { if (!ok) rej(e || new Error("解码失败")); });
              if (p && p.then) p.then(function (b) { if (!ok) { ok = true; res(b); } }).catch(function (e) { if (!ok) rej(e); });
            } catch (e) { rej(e); }
          });
        })
        .then(function (audioBuf) {
          fileBuffers[name] = audioBuf;
          fileOk[name] = true;
          if (window.__sfxDebug) window.__sfxDebug.push("音效文件已加载: " + name);
        })
        .catch(function () { next(); });
    }
    next();
  }

  function playFile(name) {
    if (typeof fetch !== "function") return false;                        // 没网络能力就别探测
    if (fileOk[name] === undefined) { tryLoadFile(name); return false; }   // 第一次先探测
    if (!fileOk[name] || !fileBuffers[name]) return false;
    var c = audioCtx;
    if (!c || !masterGain) return false;
    try {
      var src = c.createBufferSource();
      src.buffer = fileBuffers[name];
      var g = c.createGain();
      g.gain.value = 1;
      src.connect(g); g.connect(masterGain);
      if (wetGain) {
        var sg = c.createGain(); sg.gain.value = 0.15;
        g.connect(sg); sg.connect(wetGain);
      }
      src.start(0);
      return true;
    } catch (e) { return false; }
  }

  // 页面加载后：把常用音效都探测一遍
  function preloadFiles() {
    var names = ["punch", "thunder", "doom", "slash", "heal", "block", "buff", "debuff", "dark", "fire", "draw", "card"];
    for (var i = 0; i < names.length; i++) tryLoadFile(names[i]);
  }

  function setVolume(v) {
    masterVol = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = masterVol;
    try { window.localStorage && window.localStorage.setItem("fxVolume", String(masterVol)); } catch (e) { }
    return masterVol;
  }
  function getVolume() { return masterVol; }

  // ---------- 闪电：生成"上粗下细 + 曲线 + 多层发光"的形状 ----------
  // 关键：不是画线，是画一个"渐细的封闭形状"
  function boltShape(x1, y1, x2, y2, opts = {}) {
    const seg = opts.segments || 8;              // 弯的数量（少一点，才优雅）
    const spread = opts.spread || 0.20;          // 横向摆动幅度（相对长度）
    const baseW = opts.baseWidth || 22;          // 根部宽度
    const tipW = opts.tipWidth || 1.5;           // 尖端宽度
    const jitter = opts.jitter || 0.35;          // 随机的"抖动"

    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;          // 前进方向
    const px = -uy, py = ux;                     // 法线方向

    // ① 先算中心线的控制点（带一个整体弯曲 + 随机摆动）
    const lean = (Math.random() - 0.5) * len * 0.12;   // 整体歪一点
    const center = [{ x: x1, y: y1, t: 0 }];
    for (let i = 1; i < seg; i++) {
      const t = i / seg;
      // 弧形包络：中间摆动最大，两端收拢
      const envelope = Math.sin(t * Math.PI);
      const wob = Math.sin(t * Math.PI * 1.6) * len * spread * envelope;
      const rnd = (Math.random() - 0.5) * len * spread * jitter * envelope;
      center.push({
        x: x1 + ux * len * t + px * (wob + rnd) + px * lean * envelope,
        y: y1 + uy * len * t + py * (wob + rnd) + py * lean * envelope,
        t,
      });
    }
    center.push({ x: x2, y: y2, t: 1 });

    // ② 用二次贝塞尔把控制点变成顺滑曲线（经过中点做拐弯）
    let d = `M ${center[0].x.toFixed(1)} ${center[0].y.toFixed(1)}`;
    for (let i = 1; i < center.length; i++) {
      const a = center[i - 1], b = center[i];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      d += ` Q ${a.x.toFixed(1)} ${a.y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    d += ` L ${center[center.length - 1].x.toFixed(1)} ${center[center.length - 1].y.toFixed(1)}`;

    // ③ 把这条曲线"加粗成渐细的形状"（沿法线方向左右各偏移一半宽度）
    //    因为贝塞尔曲线不方便精确求法线，这里用控制点近似采样
    const samples = [];
    const N = 36;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // 在控制点之间线性插值（够用，而且形状更"雷"）
      const fi = t * (center.length - 1);
      const i0 = Math.min(Math.floor(fi), center.length - 2);
      const f = fi - i0;
      const a = center[i0], b = center[i0 + 1];
      samples.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        t,
      });
    }

    // 宽度：从根部到尖端非线性收细（前面收得慢，最后收得快）
    const widthAt = (t) => {
      const k = Math.pow(1 - t, 0.55);
      return Math.max(tipW, baseW * k);
    };

    const left = [], right = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      let tx = next.x - prev.x, ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const w = widthAt(s.t) / 2;
      left.push({ x: s.x + nx * w, y: s.y + ny * w });
      right.push({ x: s.x - nx * w, y: s.y - ny * w });
    }

    let shape = `M ${left[0].x.toFixed(1)} ${left[0].y.toFixed(1)}`;
    for (let i = 1; i < left.length; i++) shape += ` L ${left[i].x.toFixed(1)} ${left[i].y.toFixed(1)}`;
    for (let i = right.length - 1; i >= 0; i--) shape += ` L ${right[i].x.toFixed(1)} ${right[i].y.toFixed(1)}`;
    shape += " Z";

    return { shape, center };
  }

  // ---------- 画一道好看的雷 ----------
  function drawBolt(x1, y1, x2, y2, opts = {}) {
    const w = window.innerWidth, h = window.innerHeight;
    const life = opts.life || 560;
    const hue = opts.hue || "#bfe9ff";      // 雷的颜色
    const core = "#ffffff";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:9996;overflow:visible;
      mix-blend-mode:screen;`;
    fxLayer.appendChild(svg);

    // 模糊滤镜（做出发光）
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const mkFilter = (id, blur) => {
      const f = document.createElementNS("http://www.w3.org/2000/svg", "filter");
      f.setAttribute("id", id);
      f.setAttribute("x", "-60%"); f.setAttribute("y", "-60%");
      f.setAttribute("width", "220%"); f.setAttribute("height", "220%");
      const g = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
      g.setAttribute("stdDeviation", String(blur));
      f.appendChild(g);
      return f;
    };
    const idGlow = "bd" + Math.random().toString(36).slice(2, 8);
    const idMid = idGlow + "m";
    defs.appendChild(mkFilter(idGlow, 14));
    defs.appendChild(mkFilter(idMid, 5));
    svg.appendChild(defs);

    const addPath = (d, fill, filterId, opacity) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", fill);
      if (filterId) p.setAttribute("filter", `url(#${filterId})`);
      if (opacity !== undefined) p.setAttribute("opacity", String(opacity));
      svg.appendChild(p);
      return p;
    };

    // 主雷
    const main = boltShape(x1, y1, x2, y2, opts);
    addPath(main.shape, hue, idGlow, 0.55);        // 光晕（大模糊）
    addPath(main.shape, hue, idMid, 0.85);         // 亮边（小模糊）
    addPath(main.shape, hue, null, 1);             // 主体
    // 白芯：把同一个形状缩窄复制一遍（用 stroke 太粗，这里用中心线细描）
    let corePath = `M ${main.center[0].x.toFixed(1)} ${main.center[0].y.toFixed(1)}`;
    for (let i = 1; i < main.center.length; i++) {
      const a = main.center[i - 1], b = main.center[i];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      corePath += ` Q ${a.x.toFixed(1)} ${a.y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    const coreP = document.createElementNS("http://www.w3.org/2000/svg", "path");
    coreP.setAttribute("d", corePath);
    coreP.setAttribute("fill", "none");
    coreP.setAttribute("stroke", core);
    coreP.setAttribute("stroke-width", String(Math.max(1.5, (opts.baseWidth || 22) * 0.22)));
    coreP.setAttribute("stroke-linecap", "round");
    coreP.setAttribute("opacity", "0.95");
    svg.appendChild(coreP);

    // 分叉（也是渐细形状，更细更短）
    //   低配档位：分叉数量砍半（每根雷的每个分叉都是好几个 SVG 元素）
    const branches = qc(opts.branches === undefined ? 3 : opts.branches);
    for (let b = 0; b < branches; b++) {
      const idx = Math.max(1, Math.floor((0.25 + Math.random() * 0.5) * main.center.length));
      const s = main.center[Math.min(idx, main.center.length - 2)];
      const ang = Math.atan2(y2 - y1, x2 - x1) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7);
      const blen = len(x1, y1, x2, y2) * (0.14 + Math.random() * 0.16);
      const bx = s.x + Math.cos(ang) * blen;
      const by = s.y + Math.sin(ang) * blen;
      const br = boltShape(s.x, s.y, bx, by, {
        segments: 4, spread: 0.28, baseWidth: (opts.baseWidth || 22) * 0.45,
        tipWidth: 0.8, jitter: 0.5,
      });
      addPath(br.shape, hue, idMid, 0.6);
      addPath(br.shape, hue, null, 0.9);
    }

    // 闪烁（真实的雷是"亮-暗-亮-灭"）
    svg.animate(
      [
        { opacity: 0 },
        { opacity: 1, offset: 0.06 },
        { opacity: 0.25, offset: 0.26 },
        { opacity: 1, offset: 0.44 },
        { opacity: 0.35, offset: 0.66 },
        { opacity: 0.95, offset: 0.80 },
        { opacity: 0, offset: 1 },
      ],
      { duration: life, easing: "linear", fill: "forwards" }
    ).onfinish = () => svg.remove();

    return svg;
  }

  function len(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

  // ---------- 闪电演出（雷暴版） ----------
  function lightning(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const W = window.innerWidth, H = window.innerHeight;

    // ① 预告
    const warn = document.createElement("div");
    warn.textContent = "闪电！";
    warn.style.cssText = `position:fixed;left:50%;top:22%;transform:translate(-50%,-50%);
      font-size:50px;font-weight:900;color:#bfe9ff;letter-spacing:10px;
      text-shadow:0 0 24px #2ea8ff,0 0 60px #0066ff,0 4px 0 #000;
      pointer-events:none;z-index:10000;font-family:Impact,"Microsoft YaHei",sans-serif;`;
    fxLayer.appendChild(warn);
    warn.animate(
      [
        { transform: "translate(-50%,-50%) scale(1.6)", opacity: 0 },
        { transform: "translate(-50%,-50%) scale(1.0)", opacity: 1, offset: 0.25 },
        { transform: "translate(-50%,-50%) scale(1.0)", opacity: 1, offset: 0.7 },
        { transform: "translate(-50%,-50%) scale(1.4)", opacity: 0 },
      ],
      { duration: T(620), easing: "ease-out", fill: "forwards" }
    ).onfinish = () => warn.remove();

    // ② 天色压暗（雷暴前的乌云）
    const dark = document.createElement("div");
    dark.style.cssText = `position:fixed;inset:0;background:linear-gradient(180deg,
      rgba(8,16,50,.92), rgba(10,14,40,.55) 45%, rgba(0,0,0,.15));
      pointer-events:none;z-index:9991;`;
    fxLayer.appendChild(dark);
    dark.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 0.15, offset: 0.86 }, { opacity: 0 }],
      { duration: T(3400), easing: "ease-in-out", fill: "forwards" }).onfinish = () => dark.remove();

    // ③ 雷电工具箱：一道"主雷"（很粗 + 很多分叉）
    const mainBolt = (fromX, toX, toY, width, delay, life) => {
      setTimeout(() => {
        drawBolt(fromX, -40, toX, toY, {
          segments: 9 + Math.floor(Math.random() * 3),
          spread: 0.17, baseWidth: width, tipWidth: 1.2,
          jitter: 0.42, life: T(life), branches: 7,
        });
      }, T(delay));
    };

    // ④ 周围乱窜的支线（不落到目标，横着劈）
    const sideBolt = (delay, life) => {
      setTimeout(() => {
        const sx = Math.random() * W;
        const ex = sx + (Math.random() - 0.5) * W * 0.6;
        drawBolt(sx, -40, ex, H * (0.35 + Math.random() * 0.4), {
          segments: 7, spread: 0.26, baseWidth: 10 + Math.random() * 12,
          tipWidth: 0.7, jitter: 0.6, life: T(life), branches: 3,
        });
      }, T(delay));
    };

    // ⑤ 第一波：主雷轰下来（最粗）—— 声音就在这一刻
    mainBolt(x + (Math.random() - 0.5) * 50, x, y, 38, 420, 700);
    setTimeout(() => {
      sfx("thunder");                      // 🔊 雷劈下来的声音
      flash("#dff3ff", T(400));
      shake("quake");
      burst(x, y, { count: 40, size: 10, speed: 520, life: 1000,
        colors: ["#bfe9ff", "#2ea8ff", "#fff", "#7fd4ff", "#4fc3ff"], square: true });
      ring(x, y, "#7fd4ff", 18);
      ring(x, y, "rgba(255,255,255,.8)", 11);
    }, T(470));

    // ⑥ 第二波：左右各一道（同时 + 两道支线）
    setTimeout(() => {
      drawBolt(x + 150, -40, x + 30, y, { segments: 8, spread: 0.2, baseWidth: 24, tipWidth: 1, jitter: 0.5, life: T(520), branches: 5 });
      drawBolt(x - 140, -40, x - 24, y, { segments: 8, spread: 0.2, baseWidth: 24, tipWidth: 1, jitter: 0.5, life: T(520), branches: 5 });
      sideBolt(0, 460);
      flash("#e6f7ff", T(280));
      shake("heavy");
      burst(x, y, { count: 22, size: 8, speed: 380, life: 800,
        colors: ["#bfe9ff", "#fff", "#2ea8ff"], square: true });
    }, T(760));

    // ⑦ 第三波：更密的乱雷（全屏乱劈，营造"雷暴"）
    const stormCount = qc(5);
    for (let i = 0; i < stormCount; i++) {
      setTimeout(() => {
        sideBolt(0, 380 + Math.random() * 220);
        if (i % 2 === 0) flash("#eef9ff", T(170));
        if (i % 3 === 0) shake("mid");
      }, T(1020 + i * 150));
    }

    // ⑧ 第四波：三条一起砸在目标上（收束）
    setTimeout(() => {
      drawBolt(x + 60, -40, x, y, { segments: 7, spread: 0.16, baseWidth: 26, tipWidth: 1, jitter: 0.4, life: T(560), branches: 6 });
      drawBolt(x - 55, -40, x, y, { segments: 7, spread: 0.16, baseWidth: 26, tipWidth: 1, jitter: 0.4, life: T(560), branches: 6 });
      drawBolt(x, -40, x, y, { segments: 6, spread: 0.1, baseWidth: 30, tipWidth: 1, jitter: 0.3, life: T(560), branches: 4 });
      sfx("thunder");                      // 🔊 第二声雷（更近、更响）
      flash("#ffffff", T(360));
      shake("quake");
      ring(x, y, "#ffffff", 26);
      ring(x, y, "#7fd4ff", 16);
      burst(x, y, { count: 46, size: 11, speed: 560, life: 1100,
        colors: ["#fff", "#bfe9ff", "#2ea8ff", "#4fc3ff"], square: true });
    }, T(1500));

    // ⑨ 收尾：余电 + 伤害数字
    setTimeout(() => {
      for (let i = 0; i < 8; i++) {
        setTimeout(() => {
          burst(x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 60, {
            count: 8, size: 5, speed: 260 + Math.random() * 260, life: 520,
            colors: ["#bfe9ff", "#fff", "#2ea8ff"], square: true,
          });
        }, i * 55);
      }
      ring(x, y, "#bfe9ff", 24);
      bigText(x, y - 44, "-5", { size: 96, color: "#eaf8ff", glow: "#2ea8ff", life: T(2000) });
    }, T(1900));
  }

  // ---------- 末日演出：天罚（陨石坠落 + 世界变红 + 地裂） ----------
  function doom(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;

    // 🔊 声音（只有这两个会响，其它音效都关着）：
    //    陨石在 T(1500) 开始飞、飞 T(1150) 后砸地 —— 和画面用同一套时间
    setTimeout(function () { sfxFall(1150 / sp); }, T(1500));
    setTimeout(function () { sfxSlam(); }, T(1500 + 1150));

    // ① 世界褪色（黑白），像是"审判开始"
    //    ⚠️ backdrop-filter 在手机上极卡 → 低配档位改成"只用半透明黑遮罩"
    const gray = document.createElement("div");
    gray.style.cssText = (Q.tier === "high"
      ? "position:fixed;inset:0;backdrop-filter:grayscale(1) contrast(1.3) brightness(.75);background:rgba(0,0,0,.45);"
      : "position:fixed;inset:0;background:rgba(0,0,0,.62);") +
      "pointer-events:none;z-index:9990;";
    fxLayer.appendChild(gray);
    gray.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.22 }, { opacity: 1, offset: 0.80 }, { opacity: 0 }],
      { duration: T(3200), easing: "ease-in-out", fill: "forwards" }
    ).onfinish = () => gray.remove();

    // ② "末日"两个字砸出来（巨大、颤抖、血红）
    const title = document.createElement("div");
    title.textContent = "末 日";
    title.style.cssText = `position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);
      font-size:min(22vw,190px);font-weight:900;letter-spacing:22px;
      color:#ff2b2b;font-family:Impact,"Microsoft YaHei",sans-serif;
      text-shadow:0 0 30px #ff0000,0 0 80px #a80000,0 0 140px #550000,0 6px 0 #1a0000;
      pointer-events:none;z-index:10000;white-space:nowrap;`;
    fxLayer.appendChild(title);
    title.animate(
      [
        { transform: "translate(-50%,-50%) scale(3.4)", opacity: 0, filter: "blur(" + qb(14) + "px)" },
        { transform: "translate(-50%,-50%) scale(1.0)", opacity: 1, filter: "blur(0px)", offset: 0.16 },
        { transform: "translate(-50%,-50%) scale(1.06)", opacity: 1, offset: 0.30 },
        { transform: "translate(-50%,-50%) scale(1.0)", opacity: 1, offset: 0.86 },
        { transform: "translate(-50%,-50%) scale(1.5)", opacity: 0, filter: "blur(" + qb(8) + "px)" },
      ],
      { duration: T(1500), easing: "cubic-bezier(.15,.9,.2,1)", fill: "forwards" }
    ).onfinish = () => title.remove();

    // ③ 天空变血红（末日降临）
    const red = document.createElement("div");
    red.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:9989;
      background:radial-gradient(ellipse at 50% 120%, rgba(255,40,0,.55) 0%, rgba(120,0,0,.35) 40%, rgba(0,0,0,0) 75%);`;
    fxLayer.appendChild(red);
    red.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
      { duration: T(3400), easing: "ease-in-out", fill: "forwards" }
    ).onfinish = () => red.remove();

    // ④ 陨石坠落：从左上角一路烧下来
    setTimeout(() => {
      const meteor = document.createElement("div");
      meteor.textContent = "☄️";
      meteor.style.cssText = `position:fixed;left:0;top:0;font-size:120px;pointer-events:none;z-index:9997;
        filter:drop-shadow(0 0 30px #ff8c00) drop-shadow(0 0 80px #ff2d00);`;
      fxLayer.appendChild(meteor);
      const sx = -160, sy = -160;
      const ex = x, ey = y;
      meteor.animate(
        [
          { transform: `translate(${sx}px, ${sy}px) scale(0.5) rotate(-20deg)`, opacity: 0 },
          { transform: `translate(${sx + 60}px, ${sy + 40}px) scale(0.9) rotate(-10deg)`, opacity: 1, offset: 0.1 },
          { transform: `translate(${ex - 40}px, ${ey - 40}px) scale(1.25) rotate(10deg)`, opacity: 1, offset: 0.92 },
          { transform: `translate(${ex}px, ${ey}px) scale(1.6) rotate(20deg)`, opacity: 1 },
        ],
        { duration: T(1150), easing: "cubic-bezier(.5,0,.85,.35)", fill: "forwards" }
      );
      // 一路拖火
      let n = 0;
      const tm = setInterval(() => {
        const r = meteor.getBoundingClientRect();
        burst(r.left + 60, r.top + 60, {
          count: 5, size: 14, speed: 150, life: 800,
          colors: ["#ffd166", "#ff6b35", "#ff2d00", "#8a2b00"],
        });
        if (++n > 24) clearInterval(tm);
      }, T(46));
      setTimeout(() => { clearInterval(tm); meteor.remove(); doomImpact(x, y, sp); }, T(1150));
    }, T(1500));
  }

  // ---------- 陨石飞行的声音（越来越近、越来越响）----------
  //   真实的陨石落地**没有啸叫**，是低频的"轰隆隆"：
  //     远处 → 低闷、轻
  //     近了 → 越来越响、越来越亮（高频逐渐出来）+ 燃烧的"嗤嗤"声
  //   所以：全部用噪声，不用正弦（正弦会变成"炮弹啸叫"）
  //   dur = 飞行时长（毫秒），要跟动画对上
  function sfxFall(dur) {
    if (!SFX_KEEP.fall) return;
    if (!audioCtx || audioCtx.state !== "running") { unlockAudio(); return; }
    initChain();
    const B = SOUND_BUDGET;
    const D = Math.max(0.25, (dur || 1150) / 1000);
    const c = audioCtx;
    const t0 = c.currentTime + 0.02;
    const buf = getNoise();
    if (!buf || !masterGain) return;

    // 从左边飞过来 → 声像从左往中间移（有"移动"的感觉）
    let pan = null;
    if (c.createStereoPanner) {
      pan = c.createStereoPanner();
      pan.pan.setValueAtTime(-0.75, t0);
      pan.pan.linearRampToValueAtTime(-0.1, t0 + D);
      pan.connect(masterGain);
    }
    const dest = pan || masterGain;

    // ---------- ① 远处的那一层：闷、轻，一开始就存在 ----------
    {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(180, t0);
      f.frequency.linearRampToValueAtTime(500, t0 + D);
      const g = c.createGain();
      g.gain.setValueAtTime(0.10 * B, t0);
      g.gain.linearRampToValueAtTime(0.40 * B, t0 + D);       // 越飞越响
      s.connect(f); f.connect(g); g.connect(dest);
      if (wetGain) { const sg = c.createGain(); sg.gain.value = 0.3; g.connect(sg); sg.connect(wetGain); }
      s.start(t0); s.stop(t0 + D + 0.1);
    }

    // ---------- ② 主轰鸣：低频"轰隆隆"，后期才有 ----------
    {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(300, t0);
      f.frequency.linearRampToValueAtTime(1400, t0 + D);      // 越近越亮
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.55 * B, t0 + D);       // 越来越响
      s.connect(f); f.connect(g); g.connect(dest);
      if (wetGain) { const sg = c.createGain(); sg.gain.value = 0.35; g.connect(sg); sg.connect(wetGain); }
      s.start(t0); s.stop(t0 + D + 0.1);
    }

    // ---------- ③ 燃烧的"嗤嗤"声：大气电离/表面烧蚀，后期最响 ----------
    {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = "bandpass";
      f.frequency.setValueAtTime(2200, t0);
      f.frequency.linearRampToValueAtTime(3200, t0 + D);
      if (f.Q) f.Q.value = 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.20 * B, t0 + D);
      s.connect(f); f.connect(g); g.connect(dest);
      s.start(t0); s.stop(t0 + D + 0.1);
    }

    // ---------- ④ 低频"压过来"的那股气浪 ----------
    {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(90, t0);
      f.frequency.linearRampToValueAtTime(200, t0 + D);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.45 * B, t0 + D);
      s.connect(f); f.connect(g); g.connect(dest);
      s.start(t0); s.stop(t0 + D + 0.1);
    }
  }

  // ---------- 陨石砸地 ----------
  function sfxSlam() {
    if (!SFX_KEEP.slam) return;
    if (!audioCtx || audioCtx.state !== "running") { unlockAudio(); return; }
    initChain();
    const B = SOUND_BUDGET;
    // ① 极短高频"咔"——锋利的起点
    transient({ f0: 6000, f1: 1500, dur: 0.028, gain: 0.30 * B });
    // ② 高频"裂"——岩石碎开
    noiseHit({ type: "bandpass", f0: 2600, f1: 500, q: 0.9, dur: 0.30, gain: 0.48 * B, attack: 0.001, send: 0.35 });
    // ③ 中频"啪"——实感
    noiseHit({ type: "bandpass", f0: 1200, f1: 240, q: 0.8, dur: 0.42, gain: 0.42 * B, attack: 0.002, send: 0.3 });
    // ④ 低频"咚"——砸进地面（加重）
    noiseHit({ type: "lowpass", f0: 900, f1: 40, dur: 0.85, gain: 0.85 * B, attack: 0.002, send: 0.35 });
    // ⑤ 超低"闷"——一击到底（加重）
    tone({ type: "sine", f0: 140, f1: 26, dur: 0.80, gain: 0.95 * B, sweep: 0.35, sat: 0.6, send: 0.3 });
    // ⑥ 第二记余震（0.18 秒后，让"砸"更实在）
    noiseHit({ type: "lowpass", f0: 300, f1: 45, dur: 0.7, gain: 0.42 * B, attack: 0.004, send: 0.5, at: 0.18 });
  }

  // 末日撞击
  function doomImpact(x, y, sp) {
    const T = (ms) => ms / sp;
    const W = window.innerWidth, H = window.innerHeight;

    // 🔊 撞击的声音：超低频轰鸣 + 长尾噪声
    sfx("doom");

    // 全屏白→血红闪光
    flash("#fff5e0", T(420));
    setTimeout(() => flash("#ff2b00", T(700)), T(120));

    // 冲击环（多层，扩散更远）
    ring(x, y, "#fff", 40);
    setTimeout(() => ring(x, y, "#ffd166", 30), T(80));
    setTimeout(() => ring(x, y, "rgba(255,60,0,.75)", 52), T(170));
    setTimeout(() => ring(x, y, "rgba(120,0,0,.6)", 70), T(280));
    setTimeout(() => ring(x, y, "rgba(255,180,60,.35)", 90), T(420));

    // 粒子：四波
    burst(x, y, { count: 50, size: 18, speed: 620, life: 1400,
      colors: ["#fff", "#ffd166", "#ff6b35", "#ff2d00"] });
    setTimeout(() => burst(x, y, { count: 34, size: 24, speed: 420, life: 1800,
      colors: ["#ff8c42", "#8a2b00", "#3a1000"], square: true }), T(90));
    setTimeout(() => burst(x, y, { count: 40, size: 34, speed: 260, life: 2200,
      colors: ["rgba(80,20,0,.7)", "rgba(140,60,20,.6)", "rgba(40,10,0,.7)"] }), T(200));
    // 第四波：飞溅的碎片（往外飞得更远，停留更久）
    setTimeout(() => burst(x, y, { count: 26, size: 12, speed: 900, life: 2600,
      colors: ["#3a1000", "#5a2000", "#2a0a00"], square: true }), T(140));

    // 震屏（三波余震）
    shake("quake");
    setTimeout(() => shake("quake"), T(260));
    setTimeout(() => shake("heavy"), T(620));

    // 地裂
    crackApart(x, y, T);

    // 🌟 新增：地上的火（在地上烧 3 秒）
    groundFire(x, y, T, sp);

    // 🌟 新增：烟柱（往上升的烟）
    smokePlume(x, y, T);

    // 🌟 新增：热浪扭曲（撞击点周围空气扭动）
    heatHaze(x, y, T);

    // 🌟 新增：持续的小爆炸（噼里啪啦炸几下）
    for (let i = 0; i < 7; i++) {
      setTimeout(() => {
        const ox = x + (Math.random() - 0.5) * 260;
        const oy = y + (Math.random() - 0.5) * 120 + 40;
        burst(ox, oy, { count: 10, size: 9, speed: 220, life: 700,
          colors: ["#ffd166", "#ff6b35", "#ff2d00"] });
        ring(ox, oy, "rgba(255,140,0,.7)", 5);
        if (i % 3 === 0) shake("light");
      }, T(700 + i * 220));
    }

    // 伤害数字
    setTimeout(() => bigText(x, y - 50, "-10", {
      size: 120, color: "#fff2cc", glow: "#ff2d00", life: T(2400),
    }), T(220));
  }

  // 🌟 地上的火：一堆小火苗在地上跳动、慢慢熄灭
  function groundFire(x, y, T, sp) {
    const flames = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const el = document.createElement("div");
      const size = 24 + Math.random() * 40;
      const ox = x + (Math.random() - 0.5) * 300;
      const oy = y + (Math.random() - 0.5) * 80;
      el.textContent = "🔥";
      el.style.cssText = `position:fixed;left:${ox}px;top:${oy}px;font-size:${size}px;
        margin-left:${-size / 2}px;margin-top:${-size / 2}px;pointer-events:none;z-index:9992;
        filter:drop-shadow(0 0 14px #ff6b00) drop-shadow(0 0 34px #ff2d00);
        mix-blend-mode:screen;`;
      fxLayer.appendChild(el);
      flames.push(el);
      const delay = Math.random() * 400;
      const flameDur = 1400 + Math.random() * 1600;
      el.animate(
        [
          { transform: "scale(0.2) translateY(10px)", opacity: 0 },
          { transform: "scale(1.15) translateY(0)", opacity: 1, offset: 0.16 },
          { transform: "scale(0.95) translateY(-6px)", opacity: 0.95, offset: 0.5 },
          { transform: "scale(1.1) translateY(-10px)", opacity: 0.8, offset: 0.72 },
          { transform: "scale(0.5) translateY(-26px)", opacity: 0 },
        ],
        { duration: T(flameDur), delay: T(delay), easing: "ease-out", fill: "forwards" }
      ).onfinish = () => el.remove();
    }
    // 火苗位置偶尔跳一下（显得在烧）
    const jump = setInterval(() => {
      for (const el of flames) {
        if (!el.isConnected) continue;
        el.style.transform = `translate(${(Math.random() - 0.5) * 8}px, ${(Math.random() - 0.5) * 6}px)`;
      }
    }, 110);
    setTimeout(() => clearInterval(jump), (T(3200)));
  }

  // 🌟 烟柱：从撞击点往上飘的浓烟
  function smokePlume(x, y, T) {
    const N = 22;
    for (let i = 0; i < N; i++) {
      const el = document.createElement("div");
      const size = 60 + Math.random() * 120;
      el.style.cssText = `position:fixed;left:${x + (Math.random() - 0.5) * 140}px;top:${y}px;
        width:${size}px;height:${size}px;margin-left:${-size / 2}px;margin-top:${-size / 2}px;
        border-radius:50%;pointer-events:none;z-index:9988;background:radial-gradient(circle,
        rgba(90,50,20,.55) 0%, rgba(50,25,10,.35) 45%, rgba(20,10,5,0) 72%);
        filter:blur(8px);`;
      fxLayer.appendChild(el);
      const delay = i * 90 + Math.random() * 200;
      const dur = 2200 + Math.random() * 1800;
      const driftX = (Math.random() - 0.5) * 180;
      el.animate(
        [
          { transform: "translate(0,40px) scale(0.3)", opacity: 0 },
          { transform: `translate(${driftX * 0.3}px,-40px) scale(0.9)`, opacity: 0.85, offset: 0.28 },
          { transform: `translate(${driftX * 0.7}px,-160px) scale(1.5)`, opacity: 0.5, offset: 0.65 },
          { transform: `translate(${driftX}px,-300px) scale(2.2)`, opacity: 0 },
        ],
        { duration: T(dur), delay: T(delay), easing: "ease-out", fill: "forwards" }
      ).onfinish = () => el.remove();
    }
  }

  // 🌟 热浪扭曲：一层会扭动的滤镜，慢慢散去
  //    ⚠️ backdrop-filter 手机很卡 → 低配档位直接不做
  function heatHaze(x, y, T) {
    if (Q.tier === "low") return;
    const el = document.createElement("div");
    const w = 420, h = 260;
    el.style.cssText = `position:fixed;left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px;
      pointer-events:none;z-index:9987;backdrop-filter:blur(${qb(3)}px) contrast(1.2);
      -webkit-mask-image:radial-gradient(ellipse at center, #000 0%, transparent 70%);
      mask-image:radial-gradient(ellipse at center, #000 0%, transparent 70%);`;
    fxLayer.appendChild(el);
    el.animate(
      [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: 0.9, transform: "scale(1.0)", offset: 0.2 },
        { opacity: 0.5, transform: "scale(1.25)", offset: 0.6 },
        { opacity: 0, transform: "scale(1.6)" },
      ],
      { duration: T(2600), easing: "ease-out", fill: "forwards" }
    ).onfinish = () => el.remove();
  }

  // 地裂效果
  function crackApart(x, y, T) {
    const w = window.innerWidth, h = window.innerHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    svg.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:9994;overflow:visible;`;
    fxLayer.appendChild(svg);

    // 生成 6 条从撞击点往外爬的裂缝
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + Math.random() * 0.6;
      let d = `M ${x} ${y}`;
      let cx = x, cy = y;
      const steps = 7;
      const maxLen = 200 + Math.random() * 320;
      for (let i = 0; i < steps; i++) {
        const seg = maxLen / steps;
        const a = ang + (Math.random() - 0.5) * 0.9;
        cx += Math.cos(a) * seg;
        cy += Math.sin(a) * seg * 0.55;   // 压扁一点，像地面
        d += ` L ${cx} ${cy}`;
      }
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "#ff3b00");
      p.setAttribute("stroke-width", "4");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("opacity", "0.95");
      p.style.filter = "drop-shadow(0 0 8px #ff6b00)";
      svg.appendChild(p);
      // 裂缝"长出来"的效果
      const L = p.getTotalLength ? p.getTotalLength() : 0;
      if (L) {
        p.style.strokeDasharray = String(L);
        p.style.strokeDashoffset = String(L);
        p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
          { duration: (T ? T(420) : 420), easing: "ease-out", fill: "forwards" });
      }
    }
    svg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
      { duration: (T ? T(1900) : 1900), easing: "ease-out", fill: "forwards" }
    ).onfinish = () => svg.remove();
  }
  // ============================================================
  // 面板状态特效 v3：特效作用在"玩家自己的框"里面
  //   FX.setPanelFx("oppPanel", { 状态名: 层数 })
  //   FX.setPanelFx("oppPanel", null) → 清空
  //   FX.setStatus({ opp: [...], me: [...] }, ids) → 便捷入口
  // ============================================================
  const PANEL_STATUS_CLASS = {
    "中毒": "pe-poison", "焚烧": "pe-burn", "末日": "pe-doom",
    "诅咒": "pe-curse", "震荡": "pe-shock", "断头台": "pe-guillotine",
    "红绿灯": "pe-traffic", "土豆地雷": "pe-mine", "饥荒": "pe-famine",
    "护盾": "pe-shield", "盾": "pe-shield", "反甲": "pe-thorns",
    "治疗阻挡": "pe-noheal",
  };
  const PANEL_STATUS_EDGE = {
    "中毒": "#a55cff", "焚烧": "#ff7a00", "末日": "#ff1e1e", "诅咒": "#ffd700",
    "震荡": "#78b4ff", "断头台": "#d0d0d0", "红绿灯": "#ff5050", "土豆地雷": "#ffb700",
    "饥荒": "#a8763a", "护盾": "#7fd4ff", "盾": "#7fd4ff", "反甲": "#ff5c5c",
    "治疗阻挡": "#aaaaaa",
  };

  // ============================================================
  // 粒子系统：每个状态 = 多套粒子叠加（不是只染个边框）
  //   每一项: cls = CSS 动画类, rate = 每秒生成间隔(毫秒),
  //           texts = 用的字符, ps = 字号范围, dur = 存活时间,
  //           op = 透明度范围, wob = 横向摆动, y/spread = 起始位置
  // ============================================================
  const PARTICLE_DEF = {
    "中毒": [
      { cls: "par-poison", rate: 170, texts: ["●", "◍", "○"], ps: [8, 17], dur: [2600, 4200], wob: 28, op: [0.4, 0.9], spread: [2, 96], y: [88, 104], glow: "#c06bff" },
      { cls: "par-acid",   rate: 420, texts: ["▮", "▯", "|"], ps: [8, 14], dur: [2200, 3400], wob: 4,  op: [0.35, 0.75], spread: [6, 94], y: [-4, 4],   glow: "#9b59ff" },
      { cls: "par-fog",    rate: 700, texts: ["◯", "○"],     ps: [30, 62], dur: [3000, 5000], wob: 20, op: [0.3, 0.7], spread: [4, 92], y: [30, 90],  glow: "#7b3fd4" },
      { cls: "par-pop",    rate: 900, texts: ["✸", "✦"],     ps: [10, 20], dur: [1200, 2200], wob: 0,  op: [0.4, 0.9], spread: [10, 90], y: [20, 80], glow: "#d9a6ff" },
    ],
    "焚烧": [
      { cls: "par-fire",   rate: 80,  texts: ["▲", "●", "▪", "◭"], ps: [6, 15], dur: [1100, 2100], wob: 20, op: [0.55, 1], spread: [2, 96], y: [90, 106], glow: "#ff9b2f" },
      { cls: "par-ember",  rate: 110, texts: ["·", "•", "✧"], ps: [5, 11], dur: [900, 1700], wob: 60, op: [0.6, 1], spread: [4, 96], y: [60, 100], glow: "#ffea8a" },
      { cls: "par-smoke",  rate: 260, texts: ["●", "◍"],     ps: [18, 40], dur: [2200, 3600], wob: 26, op: [0.3, 0.6], spread: [4, 92], y: [70, 100], glow: "#ff6b00" },
      { cls: "par-heat",   rate: 500, texts: ["▬", "▭"],     ps: [20, 44], dur: [1400, 2400], wob: 10, op: [0.2, 0.5], spread: [2, 96], y: [88, 104], glow: "#ff9b2f" },
    ],
    "末日": [
      { cls: "par-doom",    rate: 150, texts: ["▃", "▅", "●", "▮"], ps: [5, 14], dur: [1100, 2400], wob: 14, op: [0.45, 1],    spread: [0, 100], y: [-6, 8],   glow: "#ff3b1f" },
      { cls: "par-ash",     rate: 220, texts: ["•", "·", "▪"],      ps: [4, 10], dur: [1800, 3200], wob: 30, op: [0.3, 0.7],    spread: [0, 100], y: [-4, 10],  glow: "#8a4a2a" },
      { cls: "par-doomfire", rate: 600, texts: ["●", "◍"],          ps: [26, 56], dur: [1600, 2800], wob: 16, op: [0.25, 0.7],   spread: [2, 96],  y: [80, 104], glow: "#ff9500" },
      { cls: "par-arc",     rate: 340, texts: ["⚡", "↯", "⌁"],      ps: [14, 30], dur: [500, 1100],  wob: 40, op: [0.5, 1],     spread: [4, 96],  y: [8, 60],   glow: "#ff3b1f" },
    ],
    "诅咒": [
      { cls: "par-curse", rate: 200, texts: ["♪", "♫", "♬"],  ps: [17, 32], dur: [3000, 5200], wob: 36, op: [0.5, 1],   spread: [2, 96], y: [86, 104], glow: "#ffd94a" },
      { cls: "par-star",  rate: 260, texts: ["✧", "✦", "★"],  ps: [10, 22], dur: [1400, 2600], wob: 18, op: [0.4, 1],   spread: [4, 96], y: [20, 90],  glow: "#fff6c4" },
      { cls: "par-ring",  rate: 900, texts: ["◯"],            ps: [16, 34], dur: [1600, 2600], wob: 0,  op: [0.35, 0.8], spread: [20, 80], y: [25, 75], glow: "#ffd700" },
    ],
    "震荡": [
      { cls: "par-shock",  rate: 70,  texts: ["✦", "✧", "·", "−"], ps: [7, 16], dur: [700, 1500], wob: 100, op: [0.5, 1],  spread: [6, 94], y: [10, 90], glow: "#9ccbff" },
      { cls: "par-line",   rate: 160, texts: ["⎯", "─", "="],      ps: [10, 22], dur: [500, 1000], wob: 70,  op: [0.4, 0.9], spread: [8, 92], y: [15, 85], glow: "#d6ecff" },
      { cls: "par-ripple", rate: 520, texts: ["◯"],                ps: [14, 34], dur: [1100, 1900], wob: 0,  op: [0.3, 0.8], spread: [20, 80], y: [25, 75], glow: "#78b4ff" },
    ],
    "断头台": [
      { cls: "par-guillotine", rate: 320, texts: ["▬", "▭", "▬"], ps: [12, 26], dur: [1300, 2100], wob: 0,  op: [0.4, 0.85], spread: [6, 92],  y: [-8, 4], glow: "#e8e8e8" },
      { cls: "par-slash",      rate: 700, texts: [""],             ps: [40, 90], dur: [700, 1300],  wob: 0,  op: [0.5, 1],    spread: [10, 90], y: [20, 80], glow: "#ff5a5a" },
      { cls: "par-bladespark", rate: 200, texts: ["✧", "·", "✦"],  ps: [5, 12],  dur: [600, 1200],  wob: 80, op: [0.5, 1],    spread: [8, 92],  y: [40, 90], glow: "#fff2b0" },
    ],
    "红绿灯": [
      { cls: "par-traffic",    rate: 150, texts: ["●", "●", "●"], ps: [8, 15], dur: [700, 1300], wob: 0, op: [0.7, 1], spread: [5, 95], y: [-6, 2], glow: "#ff5050" },
      { cls: "par-lamp",       rate: 380, texts: ["●", "◉"],      ps: [12, 22], dur: [900, 1500], wob: 0, op: [0.6, 1], spread: [6, 94], y: [2, 14], glow: "#ffd400" },
      { cls: "par-trafficbar", rate: 700, texts: ["▬"],           ps: [30, 70], dur: [1000, 1800], wob: 0, op: [0.3, 0.7], spread: [10, 90], y: [4, 16], glow: "#ff5050" },
    ],
    "土豆地雷": [
      { cls: "par-mine",   rate: 140, texts: ["▲", "▲", "●"],     ps: [6, 13], dur: [1000, 1900], wob: 16, op: [0.5, 1],   spread: [4, 96],  y: [92, 106], glow: "#ffc226" },
      { cls: "par-ground", rate: 560, texts: ["▬", "▭"],          ps: [24, 50], dur: [1200, 2000], wob: 10, op: [0.25, 0.7], spread: [6, 94], y: [92, 104], glow: "#ffb700" },
      { cls: "par-crack",  rate: 340, texts: ["\\", "/", "—"],    ps: [12, 24], dur: [600, 1200],  wob: 0,  op: [0.4, 1],   spread: [8, 92],  y: [40, 96], glow: "#ffe066" },
    ],
    "饥荒": [
      { cls: "par-famine",   rate: 220, texts: ["▬", "▭", "·"], ps: [6, 15], dur: [2200, 3600], wob: 32, op: [0.4, 0.9],  spread: [2, 96], y: [92, 106], glow: "#d8a35a" },
      { cls: "par-dust",     rate: 300, texts: ["●", "◍", "·"], ps: [10, 26], dur: [1800, 3000], wob: 20, op: [0.25, 0.6], spread: [4, 92], y: [20, 60],  glow: "#8a6a3a" },
      { cls: "par-crackdry", rate: 600, texts: ["╱", "╲", "—"], ps: [12, 26], dur: [800, 1500],  wob: 0,  op: [0.3, 0.8],  spread: [6, 94], y: [30, 90],  glow: "#b08050" },
    ],
    "护盾": [
      { cls: "par-shield",     rate: 90,  texts: ["⬡"],            ps: [13, 32], dur: [2200, 3600], wob: 0, op: [0.4, 1],    spread: [0, 0], y: [0, 0],   glow: "#8fe0ff" },
      { cls: "par-hexglow",    rate: 210, texts: ["✦", "✧", "⬡"],  ps: [8, 18],  dur: [1000, 2000], wob: 0, op: [0.4, 1],    spread: [6, 94], y: [15, 85], glow: "#e6f9ff" },
      { cls: "par-shieldring", rate: 800, texts: ["◯"],            ps: [18, 40], dur: [1400, 2400], wob: 0, op: [0.3, 0.8],  spread: [20, 80], y: [25, 75], glow: "#7fd4ff" },
    ],
    "盾": [
      { cls: "par-shield",     rate: 90,  texts: ["⬡"],            ps: [13, 32], dur: [2200, 3600], wob: 0, op: [0.4, 1],    spread: [0, 0], y: [0, 0],   glow: "#8fe0ff" },
      { cls: "par-hexglow",    rate: 210, texts: ["✦", "✧", "⬡"],  ps: [8, 18],  dur: [1000, 2000], wob: 0, op: [0.4, 1],    spread: [6, 94], y: [15, 85], glow: "#e6f9ff" },
      { cls: "par-shieldring", rate: 800, texts: ["◯"],            ps: [18, 40], dur: [1400, 2400], wob: 0, op: [0.3, 0.8],  spread: [20, 80], y: [25, 75], glow: "#7fd4ff" },
    ],
    "反甲": [
      { cls: "par-thorns", rate: 130, texts: ["▲", "◤", "◥"],   ps: [8, 18], dur: [900, 1700], wob: 0, op: [0.5, 1],   spread: [0, 0],   y: [0, 0],   glow: "#ff6b6b" },
      { cls: "par-spike",  rate: 200, texts: ["▲", "◣", "◢"],   ps: [10, 22], dur: [700, 1400], wob: 0, op: [0.4, 0.9], spread: [0, 0],   y: [0, 0],   glow: "#ff3b3b" },
      { cls: "par-spiker", rate: 700, texts: ["◯"],             ps: [16, 34], dur: [1200, 2000], wob: 0, op: [0.3, 0.8], spread: [20, 80], y: [25, 75], glow: "#ff8a8a" },
    ],
    "治疗阻挡": [
      { cls: "par-noheal", rate: 260, texts: ["×", "✕", "−"], ps: [10, 22], dur: [2400, 4000], wob: 36, op: [0.3, 0.65], spread: [6, 94], y: [20, 80], glow: "#bdbdbd" },
      { cls: "par-bar",    rate: 400, texts: [""],            ps: [30, 70], dur: [1600, 2800], wob: 10, op: [0.2, 0.5],  spread: [8, 92], y: [10, 40], glow: "#9a9a9a" },
    ],
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ============================================================
  // 🔊 音效开关
  //   现在只保留三个（用户认可的那三个）：
  //     ① 闪电的雷声      sfxKeep.thunder
  //     ② 陨石/核弹 飞行声 sfxKeep.fall
  //     ③ 陨石/核弹 砸地声 sfxKeep.slam
  //   其它音效全部关掉 —— 用户说音效他自己后面做
  // ============================================================
  const SFX_KEEP = { thunder: true, fall: true, slam: true, musicbox: true };

  // 每个面板各自记一套定时器，互不影响
  const panelTimers = {};

  function clearPanelTimers(panelId) {
    const list = panelTimers[panelId] || [];
    for (const t of list) clearInterval(t);
    panelTimers[panelId] = [];
  }

  // 生成一个粒子
  function spawnParticle(box, name, def) {
    const d = def;
    const el = document.createElement("i");
    el.className = "p-par " + (d.cls || "");
    if (d.texts && d.texts.length && d.texts[0] !== "") el.textContent = pick(d.texts);
    const size = rnd(d.ps[0], d.ps[1]);
    const dur = rnd(d.dur[0], d.dur[1]);
    const op0 = rnd(d.op[0], d.op[1]);
    const glow = d.glow || "#fff";

    // 起始位置
    let left, top;
    if (name === "护盾" || name === "盾") {
      const ang = Math.random() * Math.PI * 2;          // 沿椭圆轨道
      left = 50 + Math.cos(ang) * 46;
      top = 50 + Math.sin(ang) * 42;
    } else if (name === "反甲") {
      const side = Math.floor(Math.random() * 4);       // 从四条边冒出
      if (side === 0) { left = rnd(4, 96); top = -4; }
      else if (side === 1) { left = rnd(4, 96); top = 104; }
      else if (side === 2) { left = -4; top = rnd(10, 90); }
      else { left = 104; top = rnd(10, 90); }
    } else if (name === "断头台" && d.cls === "par-slash") {
      left = 50; top = rnd(20, 80);
    } else {
      left = rnd(d.spread[0], d.spread[1]);
      top = rnd(d.y[0], d.y[1]);
    }

    el.style.cssText = "left:" + left.toFixed(1) + "%;top:" + top.toFixed(1) + "%;" +
      "font-size:" + size.toFixed(1) + "px;--op:" + op0.toFixed(2) + ";" +
      "--glow:" + glow + ";--wob:" + d.wob + "px;--dur:" + Math.round(dur) + "ms;";

    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, dur + 120);
  }

  // 一个状态要开好几套粒子
  function startParticles(box, name, panelId) {
    const defs = PARTICLE_DEF[name];
    if (!defs) return;
    if (!panelTimers[panelId]) panelTimers[panelId] = [];
    for (const d of defs) {
      // 先铺一批（免得刚开是空的）
      const pre = Math.min(10, Math.max(2, Math.round(1200 / d.rate)));
      for (let i = 0; i < pre; i++) {
        setTimeout(function () { spawnParticle(box, name, d); }, i * (d.rate / pre));
      }
      panelTimers[panelId].push(setInterval(function () { spawnParticle(box, name, d); }, d.rate));
    }
    // 护盾额外加一条扫光
    if (name === "护盾" || name === "盾") {
      const sweep = document.createElement("div");
      sweep.className = "p-sweep";
      box.appendChild(sweep);
    }
  }

  function setPanelFx(panelId, statusMap) {
    const el = document.getElementById(panelId);
    if (!el) return;
    // 先清掉旧的特效层（只清这个面板的）
    el.querySelectorAll(".p-fx").forEach((n) => n.remove());
    el.querySelectorAll(".p-tag").forEach((n) => n.remove());
    clearPanelTimers(panelId);
    if (!statusMap) {
      el.style.removeProperty("--p-edge");
      return;
    }
    const names = Object.keys(statusMap);
    // 以第一个状态的颜色作为"这一框"的边光色
    if (names[0] && PANEL_STATUS_EDGE[names[0]]) {
      el.style.setProperty("--p-edge", PANEL_STATUS_EDGE[names[0]]);
    }
    for (const name of names) {
      const cls = PANEL_STATUS_CLASS[name];
      const box = document.createElement("div");
      box.className = "p-fx " + (cls || "");
      el.appendChild(box);
      // 🔴 关键：生成粒子（而不是只给边框染色）
      startParticles(box, name, panelId);

      // 角落里放一个小标签
      const tag = document.createElement("div");
      tag.className = "p-tag";
      tag.textContent = name;
      tag.style.background = (PANEL_STATUS_EDGE[name] || "#888") + "44";
      tag.style.borderColor = PANEL_STATUS_EDGE[name] || "#888";
      tag.style.boxShadow = "0 0 10px " + (PANEL_STATUS_EDGE[name] || "#888") + "99";
      el.appendChild(tag);
    }
  }

  // 便捷入口：一次设置两边
  function setStatus(info, ids) {
    const id = ids || {};
    setPanelFx(id.opp || "oppPanel", info ? (info.opp || []).reduce((m, n) => { m[n] = (m[n] || 0) + 1; return m; }, {}) : null);
    setPanelFx(id.me || "mePanel", info ? (info.me || []).reduce((m, n) => { m[n] = (m[n] || 0) + 1; return m; }, {}) : null);
  }
  function clearStatusLayer(ids) {
    const id = ids || {};
    setPanelFx(id.opp || "oppPanel", null);
    setPanelFx(id.me || "mePanel", null);
  }

  // ============================================================
  // 卡牌 → 演出 + 音效
  //   playCardFx(卡名, { card, pos })  → 打出时播
  // ============================================================
  function autoFxForCard(card) {
    if (!card) return "hit-light";
    const cost = typeof card.cost === "number" ? card.cost : 4;
    if (card.kind === "heal") return "heal";
    if (card.kind === "block") return "block";
    if (card.kind === "economy" || card.kind === "draw") return "buff";
    if (card.kind === "control" || card.kind === "status") return "debuff";
    if (card.kind === "unit") return "summon";
    if (card.kind === "attack") {
      if (cost >= 10) return "dark";
      if (cost >= 7) return "hit-big";
      if (cost >= 4) return "hit-mid";
      return "hit-light";
    }
    return "hit-light";
  }

  const CARD_FX = {
    "一拳": "punch", "闪电": "lightning", "天崩地裂": "quake", "末日": "doom",
    "核弹": "nuke", "斩杀": "execute", "雪球": "snowball", "苦无": "multi",
    "血刃": "blood", "刀": "slash", "手术刀": "slash", "狙击枪": "snipe",
    "木棍": "hit-light", "石头": "hit-light",
    "土豆地雷": "mine",
    "毒鸡汤": "poison", "腐肉": "poison", "焚烧": "burning",
    "黑洞": "blackhole", "硫酸": "acid", "断头台": "guillotine",
    "苦肉计": "selfharm", "转换": "convert", "幸运儿": "lucky",
    "定时炸弹": "timebomb",
    "蓄力": "charge", "兴奋剂": "charge", "反甲": "thorns",
    "水晶盾": "shield", "盾反": "shield", "飞轮": "block",
    "圣诞树": "block", "名刀": "block",
    "牛奶": "heal", "医疗包": "heal", "回光返照": "heal",
    "八音盒": "musicbox", "末影龙": "summon", "皮卡": "summon",
    "无中生有": "draw", "窥视": "peek",
  };
  const CARD_SFX = {
    "一拳": "punch", "闪电": "thunder", "末日": "doom", "核弹": "doom",
    "天崩地裂": "doom", "斩杀": "punch", "狙击枪": "punch", "苦肉计": "punch",
    "焚烧": "fire", "毒鸡汤": "debuff", "腐肉": "debuff",
    "黑洞": "dark", "硫酸": "dark", "末影龙": "dark", "皮卡": "dark",
    "幸运儿": "buff", "蓄力": "buff", "兴奋剂": "buff", "八音盒": "buff",
    "反甲": "buff", "无中生有": "buff",
    "水晶盾": "block", "盾反": "block", "飞轮": "block",
    "圣诞树": "block", "名刀": "block",
    "牛奶": "heal", "医疗包": "heal", "回光返照": "heal",
    "血刃": "punch", "刀": "punch", "手术刀": "punch", "木棍": "punch",
    "石头": "punch", "雪球": "punch", "苦无": "punch",
  };

  function slashFx(x, y, color) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:0;height:0;pointer-events:none;z-index:9997;";
    fxLayer.appendChild(el);
    const line = document.createElement("div");
    line.style.cssText = "position:absolute;left:-260px;top:-3px;width:520px;height:6px;" +
      "background:linear-gradient(90deg,transparent," + color + " 40%," + color + " 60%,transparent);" +
      "box-shadow:0 0 20px " + color + ",0 0 60px " + color + ";" +
      "transform:rotate(-24deg) scaleX(0);transform-origin:center;";
    el.appendChild(line);
    line.animate(
      [{ transform: "rotate(-24deg) scaleX(0)", opacity: 0 },
       { transform: "rotate(-24deg) scaleX(1)", opacity: 1, offset: 0.25 },
       { transform: "rotate(-24deg) scaleX(1.2)", opacity: 0 }],
      { duration: 420, easing: "ease-out", fill: "forwards" }
    ).onfinish = function () { el.remove(); };
    setTimeout(function () {
      burst(x, y, { count: 18, size: 10, speed: 320, life: 700, colors: [color, "#fff"] });
      shake("mid");
    }, 110);
  }

  function snowFx(x, y) {
    for (let i = 0; i < qc(5); i++) {
      setTimeout(function () {
        burst(x + (Math.random() - 0.5) * 130, y - 60 + Math.random() * 60, {
          count: 12, size: 13, speed: 190, life: 1300, colors: ["#e8f6ff", "#bfe9ff", "#fff"],
        });
      }, i * 90);
    }
    ring(x, y, "#bfe9ff", 12);
    flash("#e8f6ff", 260);
    shake("mid");
  }

  function bloodFx(x, y) {
    for (let i = 0; i < 3; i++) {
      setTimeout(function () {
        burst(x, y, { count: 18, size: 14, speed: 280, life: 1300, colors: ["#c1001a", "#8a0012", "#ff2b2b"] });
      }, i * 80);
    }
    flash("#8a0012", 240);
    shake("mid");
  }

  // ============================================================
  // 毒鸡汤：一碗毒鸡汤 → 被打翻 → 汤洒出来 → 绿毒液炸开（接下面那一段）
  //   第一幕（0.00~1.15 秒）：碗登场
  //     0.00  碗从上方落下来放稳（"咚"一下 + 汤面晃）
  //     0.20  汤面冒气泡 + 冒绿气
  //     0.45  骷髅图案浮在汤面上（暗示这是毒）
  //     0.80  碗开始倾斜
  //     1.00  碗被打翻（飞出去 + 旋转）
  //     1.05  汤洒出来（一道绿色的液流朝目标喷）
  //   第二幕（1.15 秒起）：接到 poisonSplash（绿毒液炸开那一套）
  // ============================================================
  function poisonFx(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const R = 62;
    const BOWL_Y = y - R * 1.5;                       // 碗浮在稍上方（不用挡住目标）

    // ---------- 第一幕：一碗毒鸡汤 ----------
    const bowl = document.createElement("div");
    const BW = R * 3.0, BH = R * 2.1;                 // 碗的整体尺寸
    bowl.style.cssText = "position:fixed;left:" + x + "px;top:" + BOWL_Y + "px;" +
      "width:" + BW + "px;height:" + BH + "px;margin-left:" + (-BW / 2) + "px;margin-top:" + (-BH / 2) + "px;" +
      "pointer-events:none;z-index:9998;transform-origin:50% 78%;will-change:transform;";

    // 碗底投影
    const shadow = document.createElement("div");
    shadow.style.cssText = "position:absolute;left:50%;bottom:" + (-BH * 0.13) + "px;transform:translateX(-50%);" +
      "width:" + (BW * 0.86) + "px;height:" + (BH * 0.14) + "px;border-radius:50%;" +
      "background:radial-gradient(ellipse, rgba(0,0,0,.6) 0%, rgba(0,0,0,0) 74%);filter:blur(3px);";
    bowl.appendChild(shadow);

    // 碗身：宽口、收腰、带圈足
    const cup = document.createElement("div");
    cup.style.cssText = "position:absolute;left:" + (BW * 0.03) + "px;top:" + (BH * 0.20) + "px;" +
      "width:" + (BW * 0.94) + "px;height:" + (BH * 0.66) + "px;" +
      "border-radius:10% 10% 44% 44% / 8% 8% 92% 92%;" +
      "background:" +
      // 青花：两道环纹 + 中间的小花纹
      "radial-gradient(circle at 22% 62%, rgba(48,92,190,.75) 0 3px, transparent 4px)," +
      "radial-gradient(circle at 78% 62%, rgba(48,92,190,.75) 0 3px, transparent 4px)," +
      "radial-gradient(circle at 34% 48%, rgba(48,92,190,.55) 0 2px, transparent 3px)," +
      "radial-gradient(circle at 66% 48%, rgba(48,92,190,.55) 0 2px, transparent 3px)," +
      "repeating-linear-gradient(180deg, rgba(48,92,190,0) 0px, rgba(48,92,190,0) 11px, rgba(48,92,190,.55) 11px, rgba(48,92,190,.55) 14px)," +
      "linear-gradient(102deg, #7d8798 0%, #cdd6e2 14%, #ffffff 34%, #f2f6fb 52%, #d2dae6 70%, #96a1b2 88%, #6a7484 100%);" +
      "box-shadow: inset -16px -12px 30px rgba(50,60,80,.55), inset 12px 8px 24px rgba(255,255,255,.9), 0 10px 26px rgba(0,0,0,.55);" +
      "background-blend-mode:multiply;";
    bowl.appendChild(cup);

    // 圈足（碗底的小圈）
    const foot = document.createElement("div");
    foot.style.cssText = "position:absolute;left:50%;bottom:" + (BH * 0.045) + "px;transform:translateX(-50%);" +
      "width:" + (BW * 0.34) + "px;height:" + (BH * 0.12) + "px;border-radius:0 0 42% 42% / 0 0 100% 100%;" +
      "background:linear-gradient(180deg,#b9c3d1,#7b8595 60%,#5a6474);" +
      "box-shadow:0 3px 8px rgba(0,0,0,.6);";
    bowl.appendChild(foot);

    // 碗口：厚边（外白 + 内影）
    const rim = document.createElement("div");
    rim.style.cssText = "position:absolute;left:0;top:" + (BH * 0.10) + "px;" +
      "width:" + BW + "px;height:" + (BH * 0.30) + "px;border-radius:50%;" +
      "background:linear-gradient(180deg,#ffffff 0%,#eef3f9 34%,#b8c3d2 74%,#8b96a6 100%);" +
      "box-shadow:inset 0 5px 12px rgba(255,255,255,.95), 0 3px 10px rgba(0,0,0,.4);";
    bowl.appendChild(rim);

    // 碗内（汤面）：毒绿的汤
    const soup = document.createElement("div");
    soup.style.cssText = "position:absolute;left:" + (BW * 0.085) + "px;top:" + (BH * 0.155) + "px;" +
      "width:" + (BW * 0.83) + "px;height:" + (BH * 0.195) + "px;border-radius:50%;overflow:hidden;" +
      "background:radial-gradient(ellipse at 44% 32%, #eaffda 0%, #b6ff8a 20%, #63e455 46%, #26a03a 76%, #0f5a24 100%);" +
      "box-shadow:0 0 22px rgba(110,255,90,.9), inset 0 0 20px rgba(12,70,30,.75);";
    bowl.appendChild(soup);

    // ---- 汤里：一只鸡腿（SVG 画，比拼方块像）----
    const NS2 = "http://www.w3.org/2000/svg";
    const chick = document.createElementNS(NS2, "svg");
    const cw = BW * 0.62;
    chick.setAttribute("width", cw);
    chick.setAttribute("height", cw * 0.56);
    chick.setAttribute("viewBox", "0 0 100 56");
    chick.style.cssText = "position:absolute;left:50%;top:56%;transform:translate(-50%,-50%) rotate(-14deg);" +
      "filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));";

    const defs = document.createElementNS(NS2, "defs");
    const grad = document.createElementNS(NS2, "radialGradient");
    grad.setAttribute("id", "fxDrumGrad");
    grad.setAttribute("cx", "42%"); grad.setAttribute("cy", "32%"); grad.setAttribute("r", "78%");
    [
      ["0%", "#fff6dc"], ["22%", "#ffd894"], ["48%", "#e0a24e"], ["72%", "#b06e22"], ["100%", "#6a3e0c"],
    ].forEach(function (s) {
      const st = document.createElementNS(NS2, "stop");
      st.setAttribute("offset", s[0]); st.setAttribute("stop-color", s[1]);
      grad.appendChild(st);
    });
    defs.appendChild(grad);
    chick.appendChild(defs);

    // 肉的部分（大肥的一端）
    const meat = document.createElementNS(NS2, "path");
    meat.setAttribute("d", "M34 8 C52 2 68 6 75 18 C81 28 76 43 60 49 C46 54 33 50 28 42 C24 34 24 18 34 8 Z");
    meat.setAttribute("fill", "url(#fxDrumGrad)");
    meat.setAttribute("stroke", "#7a4a12");
    meat.setAttribute("stroke-width", "1.6");
    chick.appendChild(meat);

    // 肉上的高光（油光）
    const gloss = document.createElementNS(NS2, "ellipse");
    gloss.setAttribute("cx", "46"); gloss.setAttribute("cy", "20");
    gloss.setAttribute("rx", "14"); gloss.setAttribute("ry", "7");
    gloss.setAttribute("transform", "rotate(-18 46 20)");
    gloss.setAttribute("fill", "rgba(255,255,235,.55)");
    chick.appendChild(gloss);

    // 焦褐的小斑（烤过的感觉）
    [[38, 38], [58, 40], [64, 24]].forEach(function (p) {
      const spot = document.createElementNS(NS2, "ellipse");
      spot.setAttribute("cx", p[0]); spot.setAttribute("cy", p[1]);
      spot.setAttribute("rx", "4.5"); spot.setAttribute("ry", "3");
      spot.setAttribute("fill", "rgba(90,45,8,.42)");
      chick.appendChild(spot);
    });

    // 骨头（细的一头 + 圆头）
    const bone = document.createElementNS(NS2, "path");
    bone.setAttribute("d", "M30 30 C22 26 14 23 7 22 C4 21.5 3 24 6 25 C13 27 22 30 28 34 Z");
    bone.setAttribute("fill", "#f4ecd8");
    bone.setAttribute("stroke", "#b8ac94");
    bone.setAttribute("stroke-width", "1.2");
    chick.appendChild(bone);
    const knob = document.createElementNS(NS2, "circle");
    knob.setAttribute("cx", "5"); knob.setAttribute("cy", "23.5");
    knob.setAttribute("r", "4.2");
    knob.setAttribute("fill", "#fbf6e8");
    knob.setAttribute("stroke", "#b0a48c");
    knob.setAttribute("stroke-width", "1.2");
    chick.appendChild(knob);

    soup.appendChild(chick);

    // 汤面油光
    const oil = document.createElement("div");
    oil.style.cssText = "position:absolute;left:" + (BW * 0.18) + "px;top:" + (BH * 0.02) + "px;" +
      "width:" + (BW * 0.22) + "px;height:" + (BH * 0.035) + "px;border-radius:50%;" +
      "background:radial-gradient(ellipse, rgba(255,255,220,.9), rgba(255,255,180,0) 74%);filter:blur(1px);";
    soup.appendChild(oil);

    // 汤面晃动
    soup.animate(
      [{ transform: "scale(1,1)" }, { transform: "scale(1.035,.955)" }, { transform: "scale(.975,1.04)" }, { transform: "scale(1,1)" }],
      { duration: T(900), iterations: 2, easing: "ease-in-out" }
    );

    fxLayer.appendChild(bowl);

    // 碗落下 → 放稳（"咚"一下）
    bowl.animate(
      [
        { transform: "translateY(-" + (R * 5) + "px) scale(.6) rotate(-10deg)", opacity: 0 },
        { transform: "translateY(0) scale(1.1,.88) rotate(0deg)", opacity: 1, offset: 0.42 },
        { transform: "translateY(0) scale(.96,1.06)", offset: 0.56 },
        { transform: "translateY(0) scale(1,1)" },
      ],
      { duration: T(560), easing: "cubic-bezier(.3,1.4,.5,1)", fill: "forwards" }
    ).onfinish = function () {
      shake("mid");
      // 落地扬尘
      burst(x, BOWL_Y + BH * 0.45, { count: 14, size: 10, speed: 160, life: 700,
        colors: ["rgba(220,210,190,.7)", "rgba(160,150,135,.5)", "#fff"] });
    };

    // 冒绿气（汤面上方）
    const steam = setInterval(function () {
      const sx = x + (Math.random() - 0.5) * BW * 0.55;
      const sy = BOWL_Y - BH * 0.02;
      const size = 16 + Math.random() * 22;
      const s = document.createElement("div");
      s.style.cssText = "position:fixed;left:" + sx + "px;top:" + sy + "px;width:" + size + "px;height:" + size + "px;" +
        "border-radius:50%;pointer-events:none;z-index:9997;" +
        "background:radial-gradient(circle, rgba(150,255,120,.55) 0%, rgba(70,200,80,.35) 45%, rgba(0,0,0,0) 80%);" +
        "filter:blur(5px);";
      fxLayer.appendChild(s);
      s.animate(
        [
          { transform: "translate(-50%,-50%) scale(.3)", opacity: 0 },
          { transform: "translate(calc(-50% + " + ((Math.random() - 0.5) * 40) + "px), calc(-50% - " + (40 + Math.random() * 50) + "px)) scale(1.1)", opacity: 0.8, offset: 0.4 },
          { transform: "translate(calc(-50% + " + ((Math.random() - 0.5) * 80) + "px), calc(-50% - " + (110 + Math.random() * 60) + "px)) scale(1.8)", opacity: 0 },
        ],
        { duration: T(1400 + Math.random() * 600), easing: "ease-out", fill: "forwards" }
      ).onfinish = function () { s.remove(); };
    }, T(120));
    setTimeout(function () { clearInterval(steam); }, T(1050));

    // 汤面冒小泡
    const soupBubble = setInterval(function () {
      const bx = x + (Math.random() - 0.5) * BW * 0.6;
      const by = BOWL_Y + (Math.random() - 0.5) * BH * 0.12;
      burst(bx, by, { count: 2, size: 7, speed: 55, life: 700,
        colors: ["#e8ffd8", "#a8ff7a", "#4ade4a"] });
    }, T(150));
    setTimeout(function () { clearInterval(soupBubble); }, T(1050));

    // ---------- 碗被打翻 ----------
    setTimeout(function () {
      // 先微微晃一下（要倒的前兆）
      bowl.animate(
        [{ transform: "translateY(0) rotate(0deg)" },
         { transform: "translateY(-4px) rotate(-6deg)" },
         { transform: "translateY(0) rotate(5deg)" },
         { transform: "translateY(-2px) rotate(-3deg)" }],
        { duration: T(320), easing: "ease-in-out", fill: "forwards" }
      );
    }, T(800));

    setTimeout(function () {
      // 被打翻：朝右下飞出去 + 旋转 + 淡出
      bowl.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          { transform: "translate(" + (BW * 0.3) + "px," + (-BH * 0.5) + "px) rotate(-28deg)", opacity: 1, offset: 0.22 },
          { transform: "translate(" + (BW * 1.5) + "px," + (BH * 1.1) + "px) rotate(-210deg)", opacity: 1, offset: 0.7 },
          { transform: "translate(" + (BW * 2.3) + "px," + (BH * 2.4) + "px) rotate(-380deg)", opacity: 0 },
        ],
        { duration: T(760), easing: "cubic-bezier(.3,.5,.6,1)", fill: "forwards" }
      ).onfinish = function () { bowl.remove(); };
      shake("heavy");
      flash("#a8ff7a", T(140));

      // ---------- 汤洒出来：一道绿色的液流朝目标喷过去 ----------
      const flow = document.createElement("div");
      const dx = x - x, dy = y - BOWL_Y;      // 从碗到目标
      const dist = Math.abs(dy);
      flow.style.cssText = "position:fixed;left:" + x + "px;top:" + BOWL_Y + "px;" +
        "width:" + (R * 0.5) + "px;height:0px;margin-left:" + (-R * 0.25) + "px;" +
        "border-radius:40%;pointer-events:none;z-index:9997;transform-origin:top center;" +
        "background:linear-gradient(180deg, rgba(232,255,216,.95) 0%, #a8ff7a 22%, #4ade4a 58%, #1d8a30 100%);" +
        "box-shadow:0 0 18px rgba(90,255,70,.9), 0 0 44px rgba(40,200,60,.6);";
      fxLayer.appendChild(flow);
      flow.animate(
        [
          { height: "0px", opacity: 0, transform: "scaleX(.4)" },
          { height: (dist * 0.55) + "px", opacity: 1, transform: "scaleX(1.1)", offset: 0.35 },
          { height: (dist + R * 0.6) + "px", opacity: 1, transform: "scaleX(.9)", offset: 0.7 },
          { height: (dist + R * 0.6) + "px", opacity: 0, transform: "scaleX(.5)" },
        ],
        { duration: T(520), easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" }
      ).onfinish = function () { flow.remove(); };

      // 洒出来的液体往下掉的水滴
      for (let i = 0; i < qc(24); i++) {
        setTimeout(function () {
          burst(x + (Math.random() - 0.5) * R * 1.4, BOWL_Y + Math.random() * (dist + R),
            { count: 3, size: 11, speed: 120, life: 900,
              colors: ["#a8ff7a", "#4ade4a", "#e8ffd8", "#1d8a30"] });
        }, i * 18);
      }

      // ---------- 第二幕：接上原来的"毒液炸开"那一段 ----------
      setTimeout(function () { poisonSplash(x, y, sp); }, T(160));
    }, T(1000));
  }

  // ============================================================
  // 八音盒：盒子打开 → 里面的芭蕾小人转起来 → 音符/星光涌出来
  //         → 金色光环一圈圈扩散 → 缠上目标（诅咒）
  //   节奏（未缩放，毫秒）：
  //     0     盒子从上方落下来放稳
  //     200   盒盖弹开（盖子弹起、翻到后面）
  //     320   里面的小人立起来，开始转圈
  //     400+  音符和星光从盒子里涌出来
  //     700   金色光环一圈圈往外扩散（缠上目标）
  //     900   盒子开始发光、发条转快
  //     1900  收尾：盒子合上、淡出
  // ============================================================
  function musicboxFx(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const W = window.innerWidth;
    const BOX_Y = y - 46;                        // 盒子浮在目标稍上方
    const BW = 116, BH = 66;                     // 盒子尺寸

    flash("#fff6c4", T(300));

    // 🎵 音乐盒的曲子（盒子一打开就开始，3.5 秒）
    sfx("musicbox", sp);

    // ---------- 盒子 ----------
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:" + x + "px;top:" + BOX_Y + "px;" +
      "width:" + BW + "px;height:" + BH + "px;margin-left:" + (-BW / 2) + "px;" +
      "margin-top:" + (-BH) + "px;pointer-events:none;z-index:9998;transform-origin:50% 100%;" +
      "will-change:transform;";

    // 盒身（木纹 + 金色包边）
    const body = document.createElement("div");
    body.style.cssText = "position:absolute;left:0;bottom:0;width:" + BW + "px;height:" + (BH * 0.62) + "px;" +
      "border-radius:4px 4px 8px 8px;overflow:hidden;" +
      "background:" +
      "repeating-linear-gradient(92deg, rgba(60,30,10,.22) 0 3px, rgba(255,220,170,.10) 3px 7px)," +
      "linear-gradient(100deg,#3a1e0a 0%,#6a3f18 18%,#a8703a 42%,#c48a4e 52%,#8a5524 70%,#4a2a10 100%);" +
      "box-shadow:inset -8px -6px 16px rgba(20,8,0,.7), inset 6px 4px 12px rgba(255,220,170,.25), 0 8px 20px rgba(0,0,0,.6);";
    box.appendChild(body);

    // 盒身金色包边（上下两道细线）
    [0.06, 0.56].forEach(function (t) {
      const line = document.createElement("div");
      line.style.cssText = "position:absolute;left:2px;width:" + (BW - 4) + "px;height:3px;top:" + (BH * t) + "px;" +
        "background:linear-gradient(90deg,#6a4a10,#ffd166 30%,#fff3c4 50%,#ffd166 70%,#6a4a10);" +
        "border-radius:2px;box-shadow:0 0 6px rgba(255,209,102,.8);";
      box.appendChild(line);
    });

    // 盒内（打开的洞：深色 + 金光）
    const inner = document.createElement("div");
    inner.style.cssText = "position:absolute;left:" + (BW * 0.07) + "px;top:" + (BH * 0.02) + "px;" +
      "width:" + (BW * 0.86) + "px;height:" + (BH * 0.26) + "px;border-radius:40% 40% 8px 8px;" +
      "background:radial-gradient(ellipse at 50% 90%, rgba(255,240,180,.95) 0%, rgba(200,150,40,.7) 34%, " +
      "rgba(70,40,10,.9) 68%, rgba(25,12,4,1) 100%);" +
      "box-shadow:inset 0 6px 14px rgba(0,0,0,.9);opacity:0;";
    box.appendChild(inner);

    // 发条钥匙（右边的小金钮）
    const key = document.createElement("div");
    key.style.cssText = "position:absolute;right:" + (-BW * 0.08) + "px;bottom:" + (BH * 0.28) + "px;" +
      "width:14px;height:14px;border-radius:50%;" +
      "background:radial-gradient(circle at 36% 32%,#fff3c4,#ffd166 40%,#a8761a 78%,#5a3e08);" +
      "box-shadow:0 0 8px rgba(255,209,102,.9);";
    box.appendChild(key);

    // 盒盖（一开始盖着，后来弹开翻到后面）
    const lid = document.createElement("div");
    lid.style.cssText = "position:absolute;left:-3px;top:" + (BH * 0.06) + "px;width:" + (BW + 6) + "px;" +
      "height:" + (BH * 0.30) + "px;border-radius:5px;transform-origin:50% 100%;" +
      "background:" +
      "repeating-linear-gradient(92deg, rgba(60,30,10,.18) 0 3px, rgba(255,220,170,.08) 3px 7px)," +
      "linear-gradient(100deg,#4a2a10 0%,#7a4a1e 18%,#b87c40 42%,#d4985a 52%,#96602a 70%,#5a3414 100%);" +
      "box-shadow:inset -6px -4px 14px rgba(20,8,0,.65), inset 5px 3px 10px rgba(255,220,170,.28), 0 -3px 10px rgba(0,0,0,.5);";
    box.appendChild(lid);

    // 盖子上的小金扣
    const clasp = document.createElement("div");
    clasp.style.cssText = "position:absolute;left:50%;bottom:" + (-3) + "px;transform:translateX(-50%);" +
      "width:16px;height:7px;border-radius:0 0 4px 4px;" +
      "background:linear-gradient(180deg,#ffd166,#a8761a);box-shadow:0 0 6px rgba(255,209,102,.8);";
    lid.appendChild(clasp);

    // 盒底投影
    const sh = document.createElement("div");
    sh.style.cssText = "position:absolute;left:50%;bottom:" + (-BH * 0.16) + "px;transform:translateX(-50%);" +
      "width:" + (BW * 1.05) + "px;height:" + (BH * 0.22) + "px;border-radius:50%;" +
      "background:radial-gradient(ellipse, rgba(0,0,0,.6) 0%, rgba(0,0,0,0) 74%);filter:blur(4px);";
    box.appendChild(sh);

    fxLayer.appendChild(box);

    // 盒子落下 → 放稳
    box.animate(
      [
        { transform: "translateY(-" + (BH * 4) + "px) scale(.7) rotate(-8deg)", opacity: 0 },
        { transform: "translateY(0) scale(1.08,.9) rotate(0deg)", opacity: 1, offset: 0.45 },
        { transform: "translateY(0) scale(.97,1.04)", offset: 0.62 },
        { transform: "translateY(0) scale(1,1)" },
      ],
      { duration: T(420), easing: "cubic-bezier(.3,1.35,.5,1)", fill: "forwards" }
    ).onfinish = function () {
      shake("light");
      burst(x, BOX_Y, { count: 12, size: 9, speed: 140, life: 700,
        colors: ["rgba(220,200,160,.7)", "rgba(160,140,110,.5)", "#fff"] });
    };

    // ---------- 盒盖弹开 ----------
    setTimeout(function () {
      lid.animate(
        [
          { transform: "rotateX(0deg) translateY(0)", opacity: 1 },
          { transform: "rotateX(-40deg) translateY(-10px)", opacity: 1, offset: 0.3 },
          { transform: "rotateX(-118deg) translateY(-16px)", opacity: 0.85, offset: 0.7 },
          { transform: "rotateX(-150deg) translateY(-20px)", opacity: 0 },
        ],
        { duration: T(420), easing: "cubic-bezier(.3,1.3,.5,1)", fill: "forwards" }
      ).onfinish = function () { if (lid.parentNode) lid.remove(); };
      flash("#fff6c4", T(200));
      shake("mid");
      // 盖子弹开喷出的金光
      burst(x, BOX_Y - BH * 0.3, { count: 20, size: 11, speed: 200, life: 900,
        colors: ["#fff3c4", "#ffd166", "#fff"] });
    }, T(200));

    // 盒内亮起来
    setTimeout(function () {
      inner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T(260), fill: "forwards" });
    }, T(240));

    // ---------- 芭蕾小人（立起来 + 转圈）----------
    const dancer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    dancer.setAttribute("width", 34);
    dancer.setAttribute("height", 62);
    dancer.setAttribute("viewBox", "0 0 34 62");
    dancer.style.cssText = "position:absolute;left:50%;bottom:" + (BH * 0.46) + "px;margin-left:-17px;" +
      "opacity:0;transform-origin:50% 100%;filter:drop-shadow(0 0 8px rgba(255,220,140,.9));";
    dancer.innerHTML =
      '<defs><radialGradient id="fxDancerG" cx="40%" cy="30%" r="76%">' +
      '<stop offset="0%" stop-color="#fffdf2"/><stop offset="45%" stop-color="#ffe9a8"/>' +
      '<stop offset="100%" stop-color="#d8a63c"/></radialGradient></defs>' +
      // 头
      '<circle cx="17" cy="8" r="6.2" fill="url(#fxDancerG)" stroke="#a8761a" stroke-width="1"/>' +
      // 身体（裙子）
      '<path d="M17 14 C23 18 27 30 29 40 C22 43 12 43 5 40 C7 30 11 18 17 14 Z" ' +
      'fill="url(#fxDancerG)" stroke="#a8761a" stroke-width="1.1"/>' +
      // 双臂上举
      '<path d="M14 17 C10 10 6 5 3 2" stroke="#e8bc5c" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M20 17 C24 10 28 5 31 2" stroke="#e8bc5c" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      // 腿（站立 + 抬起）
      '<path d="M17 42 L16 56" stroke="#e8bc5c" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M17 42 C22 46 24 50 23 55" stroke="#e8bc5c" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
      // 底座
      '<ellipse cx="17" cy="58" rx="9" ry="3" fill="#c8963c" opacity=".85"/>';
    box.appendChild(dancer);

    setTimeout(function () {
      dancer.animate(
        [{ opacity: 0, transform: "translateY(10px) scaleY(.6)" },
         { opacity: 1, transform: "translateY(0) scaleY(1.06)", offset: 0.3 },
         { opacity: 1, transform: "translateY(0) scaleY(1)" }],
        { duration: T(320), easing: "cubic-bezier(.3,1.2,.5,1)", fill: "forwards" }
      );
      // 转圈（用 scaleX 模拟"转身"）
      dancer.animate(
        [{ transform: "rotateY(0deg)" }, { transform: "rotateY(360deg)" }],
        { duration: T(1400), iterations: 3, easing: "linear" }
      );
      // 底下发光
      const glow = document.createElement("div");
      glow.style.cssText = "position:absolute;left:50%;bottom:" + (BH * 0.44) + "px;transform:translateX(-50%);" +
        "width:" + (BW * 0.5) + "px;height:10px;border-radius:50%;" +
        "background:radial-gradient(ellipse, rgba(255,240,180,.95), rgba(255,200,80,0) 74%);filter:blur(2px);";
      box.appendChild(glow);
      glow.animate([{ opacity: .4 }, { opacity: 1 }, { opacity: .5 }, { opacity: 1 }],
        { duration: T(700), iterations: 4, easing: "ease-in-out" });
    }, T(320));

    // ---------- 音符 + 星光从盒子里涌出来 ----------
    const NOTES = ["♪", "♫", "♬", "♩", "𝄞"];
    const noteTimer = setInterval(function () {
      const nx = x + (Math.random() - 0.5) * BW * 0.8;
      const ny = BOX_Y - BH * 0.5;
      const size = 15 + Math.random() * 22;
      const isNote = Math.random() < 0.62;
      const n = document.createElement("div");
      n.textContent = isNote ? NOTES[Math.floor(Math.random() * NOTES.length)] : "✦";
      n.style.cssText = "position:fixed;left:" + nx + "px;top:" + ny + "px;" +
        "font-size:" + size + "px;line-height:1;pointer-events:none;z-index:9996;" +
        'font-family:"Microsoft YaHei",sans-serif;' +
        "color:" + (isNote ? "#ffe27a" : "#fffdf2") + ";" +
        "text-shadow:0 0 12px #ffd166,0 0 30px rgba(255,190,60,.7),0 0 60px rgba(255,150,20,.5);";
      fxLayer.appendChild(n);
      const drift = (Math.random() - 0.5) * 130;
      const rise = 90 + Math.random() * 130;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 260);
      n.animate(
        [
          { transform: "translate(-50%,-50%) scale(.3) rotate(0deg)", opacity: 0 },
          { transform: "translate(calc(-50% + " + (drift * 0.4) + "px), calc(-50% - " + (rise * 0.35) + "px)) scale(1.05) rotate(" + (spin * 0.35) + "deg)", opacity: 1, offset: 0.3 },
          { transform: "translate(calc(-50% + " + drift + "px), calc(-50% - " + rise + "px)) scale(1) rotate(" + (spin * 0.8) + "deg)", opacity: 0.85, offset: 0.72 },
          { transform: "translate(calc(-50% + " + (drift * 1.3) + "px), calc(-50% - " + (rise * 1.45) + "px)) scale(.6) rotate(" + spin + "deg)", opacity: 0 },
        ],
        { duration: T(1600 + Math.random() * 900), easing: "cubic-bezier(.25,.5,.4,1)", fill: "forwards" }
      ).onfinish = function () { n.remove(); };
    }, T(75));
    setTimeout(function () { clearInterval(noteTimer); }, T(2200));

    // ---------- 金色光环一圈圈往外扩散（缠上目标）----------
    for (let i = 0; i < 6; i++) {
      setTimeout(function () {
        const rr = 26 + i * 22;
        const ring2 = document.createElement("div");
        ring2.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + (rr * 2) + "px;" +
          "height:" + (rr * 2) + "px;margin-left:" + (-rr) + "px;margin-top:" + (-rr) + "px;" +
          "border-radius:50%;pointer-events:none;z-index:9995;" +
          "border:2px solid rgba(255,209,102,.9);" +
          "box-shadow:0 0 16px rgba(255,209,102,.9), inset 0 0 22px rgba(255,180,60,.5);" +
          "transform:scale(.4) rotate(0deg);";
        fxLayer.appendChild(ring2);
        ring2.animate(
          [
            { transform: "scale(.4) rotate(0deg)", opacity: 0 },
            { transform: "scale(1) rotate(60deg)", opacity: 1, offset: 0.3 },
            { transform: "scale(1.08) rotate(160deg)", opacity: .8, offset: 0.7 },
            { transform: "scale(1.25) rotate(240deg)", opacity: 0 },
          ],
          { duration: T(1100), easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
        ).onfinish = function () { ring2.remove(); };
        // 环上撒星光
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          burst(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55, {
            count: 2, size: 9, speed: 70, life: 900,
            colors: ["#fff6c4", "#ffd166", "#fff"],
          });
        }
      }, T(700 + i * 130));
    }

    // ---------- 发条转快 + 盒子发光 ----------
    setTimeout(function () {
      key.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(1080deg)" }],
        { duration: T(1500), easing: "linear" });
      box.animate(
        [{ filter: "drop-shadow(0 0 0 rgba(255,209,102,0))" },
         { filter: "drop-shadow(0 0 18px rgba(255,209,102,.95)) drop-shadow(0 0 46px rgba(255,170,40,.6))", offset: 0.4 },
         { filter: "drop-shadow(0 0 26px rgba(255,225,140,1)) drop-shadow(0 0 70px rgba(255,170,40,.7))", offset: 0.7 },
         { filter: "drop-shadow(0 0 0 rgba(255,209,102,0))" }],
        { duration: T(1800), easing: "ease-in-out", fill: "forwards" }
      );
    }, T(900));

    // ---------- 收尾：合上盒子、淡出 ----------
    setTimeout(function () {
      box.animate(
        [
          { opacity: 1, transform: "translateY(0) scale(1,1) rotate(0deg)" },
          { opacity: 1, transform: "translateY(0) scale(1.06,.94) rotate(0deg)", offset: 0.3 },
          { opacity: 0, transform: "translateY(26px) scale(.7,.6) rotate(-6deg)" },
        ],
        { duration: T(520), easing: "cubic-bezier(.4,.1,.7,.4)", fill: "forwards" }
      ).onfinish = function () { box.remove(); };
      ring(x, y, "rgba(255,209,102,.9)", 34);
    }, T(1900));
  }

  // ============================================================
  // 🎵 八音盒的曲子（3.5 秒，A 小调华尔兹，带一点邪门）
  //   音色：基音 + 两根金属泛音（八音盒的"齿"声）+ 极快的起音 + 长衰减
  //   每个音符的泛音比 4 / 9.2 是八音盒的特征（不是整数倍 → 有金属味）
  // ============================================================
  function musicboxMelody() {
    if (!audioCtx || audioCtx.state !== "running") { unlockAudio(); return; }
    initChain();
    const c = audioCtx;
    const t0 = c.currentTime + 0.05;

    // 音名 → 频率
    const F = {
      A3: 220.00, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, Gs4: 415.30,
      A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, A5: 880.00,
      "C#4": 277.18, E6: 1318.51, A6: 1760.00,
    };
    // 曲谱：[音名, 起始拍（每拍 0.23 秒）, 音量]
    const M = [
      // 第一句（上行，像音乐盒刚上发条）
      ["A4", 0, 1.0], ["C5", 1, 0.9], ["E5", 2, 0.95], ["A5", 3, 1.0],
      ["G4", 4, 0.85], ["B4", 5, 0.8], ["D5", 6, 0.85], ["G5", 7, 0.9],
      // 第二句（下行，带一丝不祥）
      ["F4", 8, 0.85], ["A4", 9, 0.8], ["C5", 10, 0.85], ["E5", 11, 0.9],
      ["D5", 12, 0.8], ["C5", 13, 0.75], ["B4", 14, 0.7], ["A4", 15, 0.85],
      // 收尾（半音 + 高音点缀，邪门感）
      ["Gs4", 16, 0.7], ["B4", 17, 0.7], ["E5", 18, 0.8], ["A5", 19, 0.85],
      ["E6", 20, 0.55], ["A6", 21, 0.5], ["A5", 22, 0.8],
    ];
    const BEAT = 0.23 / (musicboxFx._sp || 1);      // 拍长（跟着动画速度缩放）
    const G = SOUND_BUDGET;

    M.forEach(function (n) {
      const f = F[n[0]];
      if (!f) return;
      const at = t0 + n[1] * BEAT;                  // 绝对时间（tone/noiseHit 内部按 at 排队）
      const vol = n[2];
      // ① 基音（八音盒的主音，衰减 1.6 秒）
      tone({ type: "sine", f0: f, dur: 1.6, gain: 0.30 * vol * G, attack: 0.003, send: 0.55, at: at });
      // ② 金属泛音（不是整数倍 → 有"齿"的金属味）
      tone({ type: "sine", f0: f * 4.0, dur: 0.55, gain: 0.075 * vol * G, attack: 0.002, send: 0.5, at: at });
      tone({ type: "sine", f0: f * 9.2, dur: 0.28, gain: 0.045 * vol * G, attack: 0.001, send: 0.4, at: at });
      // ③ 起音的"叮"（极短的高频噪声，让每个音有清晰的起点）
      noiseHit({ type: "bandpass", f0: f * 6, f1: f * 3, q: 3, dur: 0.05,
        gain: 0.05 * vol * G, attack: 0.001, send: 0.3, at: at });
      // ④ 低八度垫音（低音不空）
      tone({ type: "sine", f0: f / 2, dur: 1.1, gain: 0.10 * vol * G, attack: 0.004, send: 0.5, at: at });
    });

    // 发条转动的"咯咯"声（每两拍一次）
    for (let i = 0; i < 23; i += 2) {
      noiseHit({ type: "bandpass", f0: 2400, f1: 1200, q: 2.5, dur: 0.045,
        gain: 0.055 * G, attack: 0.001, send: 0.2, at: t0 + i * BEAT });
    }
  }

  // ============================================================
  // 召唤：末影龙 / 皮卡
  //   末影龙：空中裂开一道紫色传送门 → 龙头探出来 → 翅膀张开
  //           → 整条龙冲出来 → 紫色末影粒子炸开
  //   皮卡：从天上砸下来一只方块兽（苦力怕风格），落地砸出方块碎屑
  //   节奏（未缩放，毫秒）：
  //     0     空中裂开一道口子（紫光渗出来）
  //     220   裂缝张开成传送门（旋转的紫色漩涡）
  //     420   龙头从里面探出来
  //     700   翅膀张开
  //     950   整条龙冲出来（飞过屏幕）
  //     1200  末影粒子炸开 + 紫光震荡
  // ============================================================
  function summonFx(x, y, cardName, speed, onLand) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    // 单位"落地"时通知外面（这样单位的常驻精灵能跟动画对上）
    const land = function () { try { if (onLand) onLand(); } catch (e) { } };
    const isPika = (cardName === "皮卡");
    const portalY = Math.max(70, y - 90);             // 传送门的位置（空中）
    const MAIN = isPika ? "#c8a24a" : "#a55cff";
    const DARK = isPika ? "#6a4a10" : "#3a1060";

    flash(isPika ? "#4a3a10" : "#2a0040", T(380));
    shake("mid");

    // ---------- ① 空中裂开一道口子 ----------
    const W0 = 8;
    const crack = document.createElement("div");
    crack.style.cssText = "position:fixed;left:" + x + "px;top:" + portalY + "px;" +
      "width:" + W0 + "px;height:4px;margin-left:" + (-W0 / 2) + "px;margin-top:-2px;" +
      "border-radius:4px;pointer-events:none;z-index:9997;" +
      "background:linear-gradient(90deg,transparent," + MAIN + ",transparent);" +
      "box-shadow:0 0 18px " + MAIN + ",0 0 50px " + DARK + ";";
    fxLayer.appendChild(crack);
    crack.animate(
      [
        { width: W0 + "px", height: "4px", opacity: 0 },
        { width: "180px", height: "6px", opacity: 1, offset: 0.5 },
        { width: "300px", height: "10px", opacity: 0 },
      ],
      { duration: T(420), easing: "cubic-bezier(.3,.8,.4,1)", fill: "forwards" }
    ).onfinish = function () { crack.remove(); };

    // ---------- ② 传送门（旋转的紫色漩涡）----------
    const portal = document.createElement("div");
    const PW = Math.max(150, Math.min(280, window.innerWidth * 0.28));
    const PH = PW * 0.72;
    portal.style.cssText = "position:fixed;left:" + x + "px;top:" + portalY + "px;" +
      "width:" + PW + "px;height:" + PH + "px;margin-left:" + (-PW / 2) + "px;margin-top:" + (-PH / 2) + "px;" +
      "border-radius:50%;pointer-events:none;z-index:9995;overflow:hidden;" +
      "background:radial-gradient(ellipse at 50% 50%, #000 0%, " + DARK + " 34%, " + MAIN + " 62%, rgba(255,255,255,.85) 78%, transparent 88%);" +
      "box-shadow:0 0 40px " + MAIN + ", 0 0 100px " + DARK + ", inset 0 0 40px #000;" +
      "transform:scaleX(0) scaleY(.2) rotate(0deg);";
    fxLayer.appendChild(portal);
    portal.animate(
      [
        { transform: "scaleX(0) scaleY(.2) rotate(0deg)", opacity: 0 },
        { transform: "scaleX(.7) scaleY(.85) rotate(60deg)", opacity: 1, offset: 0.45 },
        { transform: "scaleX(1) scaleY(1) rotate(140deg)", opacity: 1, offset: 0.72 },
        { transform: "scaleX(1.1) scaleY(1.05) rotate(200deg)", opacity: 0.9, offset: 0.9 },
        { transform: "scaleX(.4) scaleY(.3) rotate(260deg)", opacity: 0 },
      ],
      { duration: T(1600), easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards", delay: T(160) }
    ).onfinish = function () { portal.remove(); };

    // 传送门里旋转的能量纹（两层反向转）
    [1, -1].forEach(function (dir, i) {
      const swirl = document.createElement("div");
      const sw = PW * (i === 0 ? 0.9 : 0.6);
      swirl.style.cssText = "position:fixed;left:" + x + "px;top:" + portalY + "px;" +
        "width:" + sw + "px;height:" + (sw * 0.72) + "px;" +
        "margin-left:" + (-sw / 2) + "px;margin-top:" + (-sw * 0.36) + "px;" +
        "border-radius:50%;pointer-events:none;z-index:9996;" +
        "background:conic-gradient(from 0deg, transparent 0deg, " + (i ? "#fff" : MAIN) + " 60deg, transparent 120deg, " +
        MAIN + " 200deg, transparent 260deg, #fff 320deg, transparent 360deg);" +
        "filter:blur(3px);opacity:0;";
      fxLayer.appendChild(swirl);
      swirl.animate(
        [
          { transform: "rotate(0deg) scale(.5)", opacity: 0 },
          { transform: "rotate(" + (dir * 180) + "deg) scale(1)", opacity: 0.95, offset: 0.35 },
          { transform: "rotate(" + (dir * 480) + "deg) scale(1.06)", opacity: 0.85, offset: 0.75 },
          { transform: "rotate(" + (dir * 720) + "deg) scale(.4)", opacity: 0 },
        ],
        { duration: T(1700), easing: "linear", fill: "forwards", delay: T(220 + i * 90) }
      ).onfinish = function () { swirl.remove(); };
    });

    // 传送门附近的碎光
    for (let i = 0; i < qc(26); i++) {
      setTimeout(function () {
        const a = Math.random() * Math.PI * 2;
        burst(x + Math.cos(a) * PW * 0.5, portalY + Math.sin(a) * PH * 0.5, {
          count: 3, size: 9, speed: 130, life: 1100,
          colors: [MAIN, DARK, "#fff", "#e0c8ff"],
        });
      }, T(260 + i * 34));
    }

    if (isPika) {
      // ---------- 皮卡：方块兽从传送门里砸下来 ----------
      const beast = document.createElement("div");
      const BS = Math.max(90, Math.min(170, window.innerWidth * 0.16));
      beast.style.cssText = "position:fixed;left:" + x + "px;top:" + portalY + "px;" +
        "width:" + BS + "px;height:" + (BS * 1.5) + "px;margin-left:" + (-BS / 2) + "px;" +
        "margin-top:" + (-BS * 0.75) + "px;pointer-events:none;z-index:9998;transform-origin:50% 100%;";
      // 方块身体（苦力怕配色：土黄 + 深色斑块）
      const body = document.createElement("div");
      body.style.cssText = "position:absolute;left:0;top:" + (BS * 0.34) + "px;width:" + BS + "px;height:" + (BS * 1.16) + "px;" +
        "background:linear-gradient(100deg,#6a5424 0%,#a88c3c 26%,#d8b85a 48%,#b89840 66%,#7a6228 100%);" +
        "box-shadow:inset -6px 0 14px rgba(40,30,0,.7), inset 5px 0 10px rgba(255,240,180,.3), 0 8px 22px rgba(0,0,0,.6);";
      beast.appendChild(body);
      // 脸上的深色斑（苦力怕那种）
      [[0.18, 0.42], [0.62, 0.42], [0.40, 0.66], [0.24, 0.82], [0.66, 0.82]].forEach(function (p) {
        const blk = document.createElement("div");
        blk.style.cssText = "position:absolute;left:" + (BS * p[0]) + "px;top:" + (BS * p[1]) + "px;" +
          "width:" + (BS * 0.18) + "px;height:" + (BS * 0.18) + "px;background:#1a1408;opacity:.85;";
        beast.appendChild(blk);
      });
      // 头（方块）
      const head = document.createElement("div");
      head.style.cssText = "position:absolute;left:" + (BS * 0.14) + "px;top:0;width:" + (BS * 0.72) + "px;" +
        "height:" + (BS * 0.42) + "px;background:linear-gradient(100deg,#7a6228,#c8a84a 44%,#e8cf78 54%,#8a7030 100%);" +
        "box-shadow:inset -4px 0 10px rgba(40,30,0,.6);";
      beast.appendChild(head);
      // 两只发光的眼
      [0.26, 0.62].forEach(function (t) {
        const eye = document.createElement("div");
        eye.style.cssText = "position:absolute;left:" + (BS * t) + "px;top:" + (BS * 0.14) + "px;" +
          "width:" + (BS * 0.12) + "px;height:" + (BS * 0.12) + "px;border-radius:2px;" +
          "background:#ff2d2d;box-shadow:0 0 10px #ff2d2d,0 0 22px #ff6b35;";
        beast.appendChild(eye);
      });
      fxLayer.appendChild(beast);
      beast.animate(
        [
          { transform: "translateY(-260px) scale(.4) rotate(-8deg)", opacity: 0 },
          { transform: "translateY(-60px) scale(.9) rotate(0deg)", opacity: 1, offset: 0.45 },
          { transform: "translateY(0) scale(1.16,.86) rotate(0deg)", opacity: 1, offset: 0.82 },
          { transform: "translateY(0) scale(.96,1.06)", opacity: 1, offset: 0.92 },
          { transform: "translateY(0) scale(1,1)" },
        ],
        { duration: T(760), easing: "cubic-bezier(.4,.1,.7,.5)", fill: "forwards", delay: T(700) }
      ).onfinish = function () {
        shake("quake");
        flash("#c8a24a", T(200));
        // 落地砸出方块碎屑
        for (let i = 0; i < 28; i++) {
          burst(x + (Math.random() - 0.5) * BS * 1.6, y + 10 + Math.random() * 30, {
            count: 3, size: 12, speed: 260, life: 1100,
            colors: ["#c8a84a", "#8a7030", "#4a3a10", "#e8cf78"],
          });
        }
        setTimeout(function () {
          beast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T(700), fill: "forwards" })
            .onfinish = function () { beast.remove(); };
        }, T(900));
      };
      setTimeout(function () { ring(x, y, "#c8a24a", 28); land(); }, T(1460));
      return;
    }

    // ---------- 末影龙：龙头探出来 → 翅膀张开 → 整条龙冲出来 ----------
    const NS3 = "http://www.w3.org/2000/svg";
    const dragon = document.createElementNS(NS3, "svg");
    const DW = Math.max(240, Math.min(460, window.innerWidth * 0.42));
    const DH = DW * 0.62;
    dragon.setAttribute("width", DW);
    dragon.setAttribute("height", DH);
    dragon.setAttribute("viewBox", "0 0 200 124");
    dragon.style.cssText = "position:fixed;left:" + x + "px;top:" + portalY + "px;" +
      "margin-left:" + (-DW / 2) + "px;margin-top:" + (-DH / 2) + "px;" +
      "pointer-events:none;z-index:9998;opacity:0;transform-origin:50% 50%;" +
      "filter:drop-shadow(0 0 20px #a55cff) drop-shadow(0 0 60px #6a1ab0);";
    dragon.innerHTML =
      '<defs>' +
      '<linearGradient id="fxDragBody" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#4a2a6a"/><stop offset="45%" stop-color="#2a1440"/>' +
      '<stop offset="100%" stop-color="#100820"/></linearGradient>' +
      '<linearGradient id="fxDragWing" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#3a1e5a"/><stop offset="60%" stop-color="#1a0c2e"/>' +
      '<stop offset="100%" stop-color="#0a0418"/></linearGradient>' +
      '</defs>' +
      // 尾巴
      '<path d="M150 74 C168 78 184 84 196 92 C186 90 172 88 160 86 Z" fill="#2a1440" stroke="#8a4ad4" stroke-width="1"/>' +
      // 后翼
      '<path d="M112 60 C130 30 158 12 186 8 C170 34 148 56 122 70 Z" fill="url(#fxDragWing)" stroke="#8a4ad4" stroke-width="1.1"/>' +
      // 身体
      '<ellipse cx="96" cy="72" rx="54" ry="17" fill="url(#fxDragBody)" stroke="#8a4ad4" stroke-width="1.3"/>' +
      // 前翼（大）
      '<path d="M84 62 C60 26 30 8 2 6 C20 34 44 56 74 72 Z" fill="url(#fxDragWing)" stroke="#a55cff" stroke-width="1.3"/>' +
      // 长脖子
      '<path d="M50 70 C38 58 30 44 26 28 C34 40 44 54 56 66 Z" fill="url(#fxDragBody)" stroke="#8a4ad4" stroke-width="1.2"/>' +
      // 龙角（两根往后翘）
      '<path d="M22 22 C14 12 10 4 10 -2 C18 6 24 14 28 22 Z" fill="#c8a8f0" stroke="#7a3ad0" stroke-width="0.9"/>' +
      '<path d="M30 20 C26 10 24 2 24 -4 C30 6 34 14 36 22 Z" fill="#c8a8f0" stroke="#7a3ad0" stroke-width="0.9"/>' +
      // 头
      '<path d="M8 30 C18 20 34 20 42 28 C46 34 42 42 32 44 C20 46 10 40 8 30 Z" fill="url(#fxDragBody)" stroke="#a55cff" stroke-width="1.2"/>' +
      // 发光紫眼
      '<ellipse cx="22" cy="30" rx="4.2" ry="3" fill="#e0a8ff"/>' +
      '<ellipse cx="22" cy="30" rx="2" ry="1.4" fill="#fff"/>' +
      // 嘴（微张，带紫光）
      '<path d="M8 36 C14 40 22 41 30 39" stroke="#c8a8f0" stroke-width="1.4" fill="none"/>' +
      '<path d="M9 37 C14 41 22 42 30 40" stroke="#e0a8ff" stroke-width="1" fill="none" opacity=".8"/>' +
      // 背上的尖刺
      '<path d="M70 56 l6 -8 l4 8 Z M88 54 l6 -9 l4 9 Z M106 56 l6 -8 l4 8 Z" fill="#c8a8f0"/>';
    fxLayer.appendChild(dragon);

    // 龙从传送门里钻出来：先只露头 → 翅膀张开 → 飞出来
    dragon.animate(
      [
        { transform: "translateX(0) scale(.34) rotate(-8deg)", opacity: 0, clipPath: "inset(0 0 78% 0)" },
        { transform: "translateX(0) scale(.42) rotate(-4deg)", opacity: 1, clipPath: "inset(0 0 56% 0)", offset: 0.28 },
        { transform: "translateX(0) scale(.72) rotate(2deg)", opacity: 1, clipPath: "inset(0 0 16% 0)", offset: 0.55 },
        { transform: "translateX(-6%) scale(1) rotate(6deg)", opacity: 1, clipPath: "inset(0 0 0% 0)", offset: 0.8 },
        { transform: "translateX(-16%) scale(1.12) rotate(10deg)", opacity: 0, clipPath: "inset(0 0 0% 0)" },
      ],
      { duration: T(1500), easing: "cubic-bezier(.2,.85,.3,1)", fill: "forwards", delay: T(380) }
    ).onfinish = function () { dragon.remove(); };

    // 龙身边飘的末影粒子（紫色小方块，Minecraft 末影人那种）
    const enderTimer = setInterval(function () {
      const ex = x + (Math.random() - 0.5) * DW * 0.9;
      const ey = portalY + (Math.random() - 0.5) * DH * 0.9;
      const size = 4 + Math.random() * 7;
      const p = document.createElement("div");
      p.style.cssText = "position:fixed;left:" + ex + "px;top:" + ey + "px;" +
        "width:" + size + "px;height:" + size + "px;pointer-events:none;z-index:9999;" +
        "background:" + (Math.random() < 0.5 ? "#c8a8f0" : "#a55cff") + ";" +
        "box-shadow:0 0 8px #a55cff,0 0 18px #6a1ab0;";
      fxLayer.appendChild(p);
      p.animate(
        [
          { transform: "translate(-50%,-50%) scale(.4) rotate(0deg)", opacity: 0 },
          { transform: "translate(-50%,-50%) scale(1) rotate(90deg)", opacity: 1, offset: 0.25 },
          { transform: "translate(calc(-50% + " + ((Math.random() - 0.5) * 70) + "px), calc(-50% + " + ((Math.random() - 0.5) * 70) + "px)) scale(.7) rotate(200deg)", opacity: 0.5, offset: 0.7 },
          { transform: "translate(calc(-50% + " + ((Math.random() - 0.5) * 120) + "px), calc(-50% + " + ((Math.random() - 0.5) * 120) + "px)) scale(.1) rotate(300deg)", opacity: 0 },
        ],
        { duration: T(1400 + Math.random() * 900), easing: "ease-out", fill: "forwards" }
      ).onfinish = function () { p.remove(); };
    }, T(55));
    setTimeout(function () { clearInterval(enderTimer); }, T(2200));

    // 龙冲出来时的紫色冲击波
    setTimeout(function () {
      flash("#a55cff", T(240));
      shake("heavy");
      ring(x, portalY, "#a55cff", 40);
      burst(x, portalY, { count: 44, size: 15, speed: 480, life: 1500,
        colors: ["#c8a8f0", "#a55cff", "#6a1ab0", "#fff"] });
      // 紫色能量波荡开（三圈）
      for (let i = 0; i < 3; i++) {
        setTimeout(function () { ring(x, y, "rgba(165,92,255,.85)", 22 + i * 14); }, i * 110);
      }
      land();                       // 龙冲出来的那一刻 → 单位可以出场了
    }, T(950));
  }

  // ============================================================
  // 单位精灵（常驻场上）
  //   召唤时：从传送门冲出来 → 落到框边上站住（一直留着）
  //   每回合：血量和攻击数字会更新
  //   被打死：做个碎裂动画再消失
  //   syncUnits(双方单位列表) 会根据状态自动增删更新
  // ============================================================
  const unitSprites = {};        // key → { el, hp, atk, owner, name }

  // 画一只单位的外观（返回一个 div，不带数字）
  function buildUnitArt(name) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;height:100%;";

    if (name === "皮卡") {
      // 方块兽（苦力怕风格）
      const S = 100;   // 内部按 100 单位画，外面用 scale 缩
      const art = document.createElement("div");
      art.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
        "width:" + S + "px;height:" + (S * 1.4) + "px;";
      const head = document.createElement("div");
      head.style.cssText = "position:absolute;left:14%;top:0;width:72%;height:38%;" +
        "background:linear-gradient(100deg,#7a6228,#c8a84a 44%,#e8cf78 54%,#8a7030 100%);" +
        "box-shadow:inset -3px 0 8px rgba(40,30,0,.6);";
      art.appendChild(head);
      const body = document.createElement("div");
      body.style.cssText = "position:absolute;left:0;top:36%;width:100%;height:64%;" +
        "background:linear-gradient(100deg,#6a5424 0%,#a88c3c 26%,#d8b85a 48%,#b89840 66%,#7a6228 100%);" +
        "box-shadow:inset -5px 0 12px rgba(40,30,0,.7), inset 4px 0 9px rgba(255,240,180,.3);";
      art.appendChild(body);
      [[14, 44], [58, 44], [36, 68], [20, 84], [62, 84]].forEach(function (p) {
        const b = document.createElement("div");
        b.style.cssText = "position:absolute;left:" + p[0] + "%;top:" + p[1] + "%;width:16%;height:13%;background:#1a1408;opacity:.85;";
        art.appendChild(b);
      });
      [24, 60].forEach(function (t) {
        const e = document.createElement("div");
        e.style.cssText = "position:absolute;left:" + t + "%;top:12%;width:12%;height:9%;" +
          "background:#ff2d2d;box-shadow:0 0 8px #ff2d2d,0 0 18px #ff6b35;";
        art.appendChild(e);
      });
      wrap.appendChild(art);
      return wrap;
    }

    // 末影龙（SVG）
    const NS4 = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS4, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", "0 0 200 124");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.cssText = "filter:drop-shadow(0 0 8px #a55cff) drop-shadow(0 0 20px rgba(106,26,176,.8));";
    svg.innerHTML =
      '<defs>' +
      '<linearGradient id="fxDgB" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#4a2a6a"/><stop offset="45%" stop-color="#2a1440"/>' +
      '<stop offset="100%" stop-color="#100820"/></linearGradient>' +
      '<linearGradient id="fxDgW" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#3a1e5a"/><stop offset="60%" stop-color="#1a0c2e"/>' +
      '<stop offset="100%" stop-color="#0a0418"/></linearGradient>' +
      '</defs>' +
      '<path d="M150 74 C168 78 184 84 196 92 C186 90 172 88 160 86 Z" fill="#2a1440" stroke="#8a4ad4" stroke-width="1"/>' +
      '<path d="M112 60 C130 30 158 12 186 8 C170 34 148 56 122 70 Z" fill="url(#fxDgW)" stroke="#8a4ad4" stroke-width="1.1"/>' +
      '<ellipse cx="96" cy="72" rx="54" ry="17" fill="url(#fxDgB)" stroke="#8a4ad4" stroke-width="1.3"/>' +
      '<path d="M84 62 C60 26 30 8 2 6 C20 34 44 56 74 72 Z" fill="url(#fxDgW)" stroke="#a55cff" stroke-width="1.3"/>' +
      '<path d="M50 70 C38 58 30 44 26 28 C34 40 44 54 56 66 Z" fill="url(#fxDgB)" stroke="#8a4ad4" stroke-width="1.2"/>' +
      '<path d="M22 22 C14 12 10 4 10 -2 C18 6 24 14 28 22 Z" fill="#c8a8f0" stroke="#7a3ad0" stroke-width="0.9"/>' +
      '<path d="M30 20 C26 10 24 2 24 -4 C30 6 34 14 36 22 Z" fill="#c8a8f0" stroke="#7a3ad0" stroke-width="0.9"/>' +
      '<path d="M8 30 C18 20 34 20 42 28 C46 34 42 42 32 44 C20 46 10 40 8 30 Z" fill="url(#fxDgB)" stroke="#a55cff" stroke-width="1.2"/>' +
      '<ellipse cx="22" cy="30" rx="4.2" ry="3" fill="#e0a8ff"/><ellipse cx="22" cy="30" rx="2" ry="1.4" fill="#fff"/>' +
      '<path d="M8 36 C14 40 22 41 30 39" stroke="#c8a8f0" stroke-width="1.4" fill="none"/>' +
      '<path d="M70 56 l6 -8 l4 8 Z M88 54 l6 -9 l4 9 Z M106 56 l6 -8 l4 8 Z" fill="#c8a8f0"/>';
    wrap.appendChild(svg);
    return wrap;
  }

  // 造一个单位精灵（带边框、名字、血量、攻击）
  function makeUnitSprite(name, hp, atk) {
    const holder = document.createElement("div");
    holder.className = "fx-unit";
    holder.style.cssText = "position:fixed;width:78px;height:100px;pointer-events:none;z-index:9994;" +
      "transform-origin:50% 100%;will-change:transform;";
    // 底：圆角面板（亮紫色，比"特效"更实，一眼能看出是常驻的）
    const plate = document.createElement("div");
    plate.style.cssText = "position:absolute;inset:0;border-radius:11px;" +
      "background:linear-gradient(180deg, rgba(58,30,96,.97), rgba(22,12,40,.98));" +
      "border:2.5px solid #c8a8f0;" +
      "box-shadow:0 0 0 1px rgba(20,8,40,.9), 0 6px 16px rgba(0,0,0,.65), " +
      "0 0 18px rgba(165,92,255,.85), inset 0 0 20px rgba(110,40,190,.6);";
    holder.appendChild(plate);
    // 顶部一条亮边（更像"卡牌"）
    const topbar = document.createElement("div");
    topbar.style.cssText = "position:absolute;left:6px;right:6px;top:4px;height:3px;border-radius:2px;" +
      "background:linear-gradient(90deg,transparent,#e0c8ff 30%,#fff 50%,#e0c8ff 70%,transparent);" +
      "box-shadow:0 0 8px rgba(200,168,240,.9);";
    holder.appendChild(topbar);
    // 图案区
    const artBox = document.createElement("div");
    artBox.style.cssText = "position:absolute;left:5px;top:5px;right:5px;height:56px;overflow:hidden;";
    const art = buildUnitArt(name);
    // 把 100 单位的画缩到 64x56 里
    art.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.64);" +
      "width:100px;height:120px;";
    artBox.appendChild(art);
    holder.appendChild(artBox);
    // 名字
    const nm = document.createElement("div");
    nm.textContent = name;
    nm.style.cssText = "position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:11px;" +
      "color:#e8dcff;font-weight:bold;text-shadow:0 1px 3px #000;";
    holder.appendChild(nm);
    // 血 + 攻
    const stats = document.createElement("div");
    stats.style.cssText = "position:absolute;left:3px;right:3px;bottom:3px;display:flex;justify-content:space-between;" +
      "font-size:11px;font-weight:bold;";
    stats.innerHTML = "<span style='color:#ff8a8a;text-shadow:0 1px 3px #000'>❤" + hp + "</span>" +
      "<span style='color:#ffd166;text-shadow:0 1px 3px #000'>⚔" + atk + "</span>";
    holder.appendChild(stats);
    holder._stats = stats;
    return holder;
  }

  // 定位：**整个站在对应面板的上方**（不压在框上，否则会被框挡住）
  //   空间不够时自动缩小并减少重叠
  function layoutUnits(owner) {
    const panelId = owner === "me" ? "mePanel" : "oppPanel";
    const panel = document.getElementById(panelId);
    if (!panel) return null;
    const r = panel.getBoundingClientRect();

    // 上面有多少空间可用
    const avail = r.top - 10;
    // 单位卡高度：默认 100，空间不够就缩（最小 64）
    let UH = 100;
    if (avail < UH + 8) UH = Math.max(64, avail - 8);
    const scale = UH / 100;

    // 底边贴着框上边缘（留 8px），上面放不下就顶到屏幕顶
    let y = Math.max(4, r.top - UH - 8);
    let x = r.left + 10;
    x = Math.max(6, Math.min(x, window.innerWidth - 92 * scale));
    return { x: x, y: y, scale: scale, uh: UH, gap: 80 * scale, panel: panel };
  }

  // 同步：让场上的单位跟状态一致
  function syncUnits(state) {
    if (!state) return;
    ["me", "opp"].forEach(function (owner) {
      const list = state[owner] || [];
      const pos = layoutUnits(owner);
      if (!pos) return;
      const seen = {};
      list.forEach(function (u, i) {
        const key = owner + "|" + (u.name || "?") + "|" + i;
        seen[key] = true;
        let sp = unitSprites[key];
        if (!sp) {
          sp = makeUnitSprite(u.name, u.hp, u.atk);
          unitSprites[key] = sp;
          fxLayer.appendChild(sp);
          // 入场动画：从上方落下来
          const tx = pos.x + i * pos.gap, ty = pos.y;
          sp.style.left = tx + "px";
          sp.style.top = ty + "px";
          sp.style.transformOrigin = "50% 100%";
          sp.animate(
            [
              { transform: "scale(" + pos.scale + ") translateY(-140px)", opacity: 0 },
              { transform: "scale(" + (pos.scale * 1.16) + "," + (pos.scale * 0.86) + ") translateY(0)", opacity: 1, offset: 0.65 },
              { transform: "scale(" + (pos.scale * 0.96) + "," + (pos.scale * 1.06) + ") translateY(0)", offset: 0.82 },
              { transform: "scale(" + pos.scale + ") translateY(0)" },
            ],
            { duration: 520, easing: "cubic-bezier(.3,.9,.4,1)", fill: "forwards" }
          );
          // 紫色光晕脉动（常驻）
          sp.animate(
            [
              { filter: "drop-shadow(0 0 0 rgba(165,92,255,0))" },
              { filter: "drop-shadow(0 0 12px rgba(165,92,255,.85))", offset: 0.5 },
              { filter: "drop-shadow(0 0 0 rgba(165,92,255,0))" },
            ],
            { duration: 2200, iterations: Infinity, easing: "ease-in-out" }
          );
        }
        // 更新位置和大小
        sp.style.left = (pos.x + i * pos.gap) + "px";
        sp.style.top = pos.y + "px";
        sp.style.width = (78 * pos.scale) + "px";
        sp.style.height = pos.uh + "px";
        // 更新血量和攻击
        sp._stats.innerHTML = "<span style='color:#ff8a8a;text-shadow:0 1px 3px #000'>❤" + u.hp + "</span>" +
          "<span style='color:#ffd166;text-shadow:0 1px 3px #000'>⚔" + u.atk + "</span>";
        sp._hp = u.hp;
      });
      // 已经不在列表里的 → 播死亡动画再移除
      Object.keys(unitSprites).forEach(function (key) {
        if (key.indexOf(owner + "|") !== 0) return;
        if (seen[key]) return;
        const sp = unitSprites[key];
        delete unitSprites[key];
        sp.animate(
          [
            { transform: "translateY(0) scale(1,1)", opacity: 1, filter: "brightness(1)" },
            { transform: "translateY(0) scale(1.16,.8)", opacity: 1, filter: "brightness(3) saturate(0)", offset: 0.25 },
            { transform: "translateY(0) scale(.86,1.16)", opacity: .9, filter: "brightness(1)", offset: 0.5 },
            { transform: "translateY(10px) scale(.7,.5) rotate(-8deg)", opacity: 0, filter: "brightness(.4)" },
          ],
          { duration: 620, easing: "cubic-bezier(.3,.8,.4,1)", fill: "forwards" }
        ).onfinish = function () { sp.remove(); };
        // 碎裂粒子
        burst(sp.style.left ? parseFloat(sp.style.left) + 37 : window.innerWidth / 2,
          (sp.style.top ? parseFloat(sp.style.top) : 0) + 50, {
            count: 22, size: 11, speed: 280, life: 1100,
            colors: ["#c8a8f0", "#a55cff", "#6a1ab0", "#3a1060", "#fff"],
          });
        shake("mid");
      });
    });
  }

  // 清空所有单位（重开一局时用）
  function clearUnits() {
    Object.keys(unitSprites).forEach(function (k) {
      try { unitSprites[k].remove(); } catch (e) { }
      delete unitSprites[k];
    });
  }

  // ---------- 毒液炸开（被 poisonFx 调用）----------
  function poisonSplash(x, y, sp) {
    if (sp === undefined) sp = 1;
    const T = (ms) => ms / sp;
    const W = window.innerWidth, H = window.innerHeight;
    const R = 62;                                   // 药效范围（视觉半径）

    // ---------- ① 砸中：绿光闪 + 绿环 ----------
    flash("#8cff6b", T(240));
    ring(x, y, "rgba(140,255,110,.95)", 14);
    setTimeout(function () { ring(x, y, "rgba(90,220,60,.7)", 22); }, T(90));
    setTimeout(function () { shake("mid"); }, T(40));

    // ---------- ② 毒液四溅（大滴的绿液，带黏性拖尾）----------
    for (let i = 0; i < qc(36); i++) {
      setTimeout(function () {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
        const dist = 40 + Math.random() * (R * 1.5);
        const size = 9 + Math.random() * 16;
        const drop = document.createElement("div");
        const tx = Math.cos(ang) * dist;
        const ty = Math.sin(ang) * dist + 26;        // 受重力往下掉一点
        drop.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;" +
          "width:" + size + "px;height:" + (size * 1.25) + "px;pointer-events:none;z-index:9995;" +
          "border-radius:50% 50% 46% 46%;" +
          "background:radial-gradient(circle at 36% 30%, #e8ffd8 0%, #8cff6b 28%, #3ddc50 58%, #1a7a28 100%);" +
          "box-shadow:0 0 14px rgba(90,255,70,.85), 0 0 34px rgba(40,200,60,.5);will-change:transform;";
        fxLayer.appendChild(drop);
        drop.animate(
          [
            { transform: "translate(-50%,-50%) scale(.4)", opacity: 0 },
            { transform: "translate(calc(-50% + " + (tx * 0.55) + "px), calc(-50% + " + (ty * 0.5 - 16) + "px)) scale(1.15)", opacity: 1, offset: 0.4 },
            { transform: "translate(calc(-50% + " + tx + "px), calc(-50% + " + ty + "px)) scale(.9)", opacity: 0.95, offset: 0.75 },
            { transform: "translate(calc(-50% + " + (tx * 1.1) + "px), calc(-50% + " + (ty + 60) + "px)) scale(.5)", opacity: 0 },
          ],
          { duration: T(680 + Math.random() * 340), easing: "cubic-bezier(.3,.6,.5,1)", fill: "forwards" }
        ).onfinish = function () {
          // 落地留一小滩
          burst(parseFloat(drop.style.left) + tx, parseFloat(drop.style.top) + ty + 40, {
            count: 3, size: 11, speed: 60, life: 1400,
            colors: ["#8cff6b", "#3ddc50", "#c9ffd2"],
          });
          drop.remove();
        };
        // 小液滴
        burst(x + tx * 0.4, y + ty * 0.4 - 10, {
          count: 3, size: 8, speed: 180, life: 800,
          colors: ["#8cff6b", "#3ddc50", "#e8ffd8"],
        });
      }, T(60 + i * 14));
    }

    // ---------- ③ 顶上往下滴（黏黏的毒液丝）----------
    for (let i = 0; i < qc(12); i++) {
      setTimeout(function () {
        const dx = x + (Math.random() - 0.5) * R * 1.8;
        const top = y - R * (0.8 + Math.random() * 0.8);
        const len = 16 + Math.random() * 34;
        const strand = document.createElement("div");
        strand.style.cssText = "position:fixed;left:" + dx + "px;top:" + top + "px;" +
          "width:3px;height:" + len + "px;border-radius:2px;pointer-events:none;z-index:9994;" +
          "background:linear-gradient(180deg, rgba(140,255,110,0), #8cff6b 40%, #1a7a28 100%);" +
          "box-shadow:0 0 8px rgba(90,255,70,.7);transform-origin:top center;transform:scaleY(0);";
        fxLayer.appendChild(strand);
        strand.animate(
          [
            { transform: "scaleY(0)", opacity: 0 },
            { transform: "scaleY(1)", opacity: 1, offset: 0.35 },
            { transform: "scaleY(1.25)", opacity: 0.9, offset: 0.7 },
            { transform: "scaleY(1.1) translateY(18px)", opacity: 0 },
          ],
          { duration: T(900 + Math.random() * 400), easing: "cubic-bezier(.4,.6,.4,1)", fill: "forwards" }
        ).onfinish = function () { strand.remove(); };
      }, T(140 + i * 55));
    }

    // ---------- ④ 毒雾团扩散 ----------
    for (let i = 0; i < qc(5); i++) {
      setTimeout(function () {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * R * 0.8;
        const gx = x + Math.cos(ang) * dist;
        const gy = y + Math.sin(ang) * dist;
        const size = R * (1.1 + Math.random() * 0.9);
        const fog = document.createElement("div");
        fog.style.cssText = "position:fixed;left:" + (gx - size / 2) + "px;top:" + (gy - size / 2) + "px;" +
          "width:" + size + "px;height:" + size + "px;border-radius:50%;pointer-events:none;z-index:9993;" +
          "background:radial-gradient(circle, rgba(150,90,230,.55) 0%, rgba(110,50,200,.42) 38%, " +
          "rgba(60,20,120,.22) 62%, rgba(0,0,0,0) 82%);filter:blur(" + qb(9) + "px);transform:scale(.25);";
        fxLayer.appendChild(fog);
        fog.animate(
          [
            { transform: "scale(.25)", opacity: 0 },
            { transform: "scale(1)", opacity: 1, offset: 0.4 },
            { transform: "scale(1.5)", opacity: 0.75, offset: 0.72 },
            { transform: "scale(2.1)", opacity: 0 },
          ],
          { duration: T(1700 + Math.random() * 700), easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
        ).onfinish = function () { fog.remove(); };
      }, T(260 + i * 70));
    }

    // ---------- ⑤ ☠ 骷髅浮现（腐蚀标记）----------
    setTimeout(function () {
      const skull = document.createElement("div");
      skull.textContent = "☠";
      skull.style.cssText = "position:fixed;left:" + x + "px;top:" + (y - R * 0.1) + "px;" +
        "transform:translate(-50%,-50%) scale(.3);font-size:" + (R * 1.5) + "px;line-height:1;" +
        'color:#e8ffd8;font-family:Impact,"Microsoft YaHei",sans-serif;pointer-events:none;z-index:9996;' +
        "text-shadow:0 0 20px #8cff6b,0 0 56px #3ddc50,0 0 110px #1a7a28;";
      fxLayer.appendChild(skull);
      skull.animate(
        [
          { transform: "translate(-50%,-50%) scale(.3) rotate(-12deg)", opacity: 0, filter: "blur(14px)" },
          { transform: "translate(-50%,-50%) scale(1.12) rotate(4deg)", opacity: 1, filter: "blur(0px)", offset: 0.22 },
          { transform: "translate(-50%,-50%) scale(1) rotate(0deg)", opacity: 1, offset: 0.6 },
          { transform: "translate(-50%,-50%) scale(1.6) rotate(6deg)", opacity: 0, filter: "blur(16px)" },
        ],
        { duration: T(1300), easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" }
      ).onfinish = function () { skull.remove(); };
      flash("#3ddc50", T(160));
      shake("mid");
    }, T(400));

    // ---------- ⑥ 持续冒毒泡（上浮 → 破裂）----------
    const bubbler = setInterval(function () {
      const bx = x + (Math.random() - 0.5) * R * 2.2;
      const by = y + (Math.random() - 0.3) * R * 1.2;
      const size = 7 + Math.random() * 15;
      const b = document.createElement("div");
      b.style.cssText = "position:fixed;left:" + bx + "px;top:" + by + "px;" +
        "width:" + size + "px;height:" + size + "px;border-radius:50%;pointer-events:none;z-index:9994;" +
        "background:radial-gradient(circle at 34% 30%, rgba(240,255,225,.95) 0%, rgba(140,255,110,.85) 35%, " +
        "rgba(60,200,70,.7) 70%, rgba(20,80,30,.5) 100%);" +
        "box-shadow:0 0 12px rgba(120,255,90,.8);";
      fxLayer.appendChild(b);
      const drift = (Math.random() - 0.5) * 50;
      const rise = 60 + Math.random() * 90;
      b.animate(
        [
          { transform: "translate(-50%,-50%) scale(.3)", opacity: 0 },
          { transform: "translate(calc(-50% + " + (drift * 0.4) + "px), calc(-50% - " + (rise * 0.4) + "px)) scale(1)", opacity: 0.95, offset: 0.35 },
          { transform: "translate(calc(-50% + " + drift + "px), calc(-50% - " + rise + "px)) scale(1.15)", opacity: 0.9, offset: 0.75 },
          { transform: "translate(calc(-50% + " + (drift * 1.2) + "px), calc(-50% - " + (rise * 1.25) + "px)) scale(1.7)", opacity: 0 },
        ],
        { duration: T(1100 + Math.random() * 600), easing: "cubic-bezier(.3,.5,.4,1)", fill: "forwards" }
      ).onfinish = function () {
        // 破裂
        burst(bx + drift, by - rise, { count: 3, size: 8, speed: 90, life: 500,
          colors: ["#8cff6b", "#c9ffd2", "#3ddc50"] });
        b.remove();
      };
    }, T(105));
    setTimeout(function () { clearInterval(bubbler); }, T(2600));

    // ---------- ⑦ 底下积一小滩毒液 ----------
    setTimeout(function () {
      const pool = document.createElement("div");
      const pw = R * 2.1, ph = R * 0.5;
      pool.style.cssText = "position:fixed;left:" + (x - pw / 2) + "px;top:" + (y + R * 0.55) + "px;" +
        "width:" + pw + "px;height:" + ph + "px;border-radius:50%;pointer-events:none;z-index:9992;" +
        "background:radial-gradient(ellipse, rgba(140,255,110,.85) 0%, rgba(60,200,70,.7) 45%, " +
        "rgba(20,90,35,.5) 72%, rgba(0,0,0,0) 88%);filter:blur(" + qb(3) + "px);transform:scale(.3);";
      fxLayer.appendChild(pool);
      pool.animate(
        [
          { transform: "scale(.3)", opacity: 0 },
          { transform: "scale(1.05)", opacity: 1, offset: 0.28 },
          { transform: "scale(1)", opacity: 0.95, offset: 0.7 },
          { transform: "scale(1.15)", opacity: 0 },
        ],
        { duration: T(2000), easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" }
      ).onfinish = function () { pool.remove(); };
    }, T(320));
  }

  function burningFx(x, y) {
    for (let i = 0; i < 24; i++) {
      setTimeout(function () {
        burst(x + (Math.random() - 0.5) * 230, y + (Math.random() - 0.5) * 90, {
          count: 5, size: 14, speed: 190, life: 1500, colors: ["#ffd166", "#ff6b35", "#ff2d00"],
        });
      }, i * 45);
    }
    flash("#ff8c42", 320);
    shake("mid");
  }

  // ============================================================
  // 天崩地裂：整片大地开裂 → 地块塌陷 → 岩石从天上砸落
  //   和核弹区分开：核弹是"从一点炸开"，这个是"大地本身塌下去"
  //   节奏（未缩放，毫秒）：
  //     0     地面闷震（整个画面往下顿）
  //     60    细裂纹从爆点向外爬（分叉、蔓延）
  //     520   裂纹变粗变亮（岩浆色）
  //     700   地块裂成 5 块，各自倾斜、往下沉
  //     900+  岩石从天上砸落（14 块）
  //     1000  裂缝往上冒尘埃 / 地火
  //     1700  收尾
  // ============================================================
  function quakeFx(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const W = window.innerWidth, H = window.innerHeight;
    const groundY = Math.min(y, H - 60);

    // ---------- ① 地面闷震 ----------
    shake("quake");
    setTimeout(function () { shake("heavy"); }, T(180));

    // ---------- ② 裂纹：从爆点向外爬（分叉、蔓延）----------
    //   用 SVG 画线，靠 stroke-dashoffset 从 0 到 1 让线"长出来"
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:9994;overflow:visible;";
    fxLayer.appendChild(svg);

    // 生成一条"抖动的裂痕"路径：从 (x0,y0) 朝某方向走
    function crackPath(x0, y0, ang, len, seg) {
      let d = "M " + x0.toFixed(1) + " " + y0.toFixed(1);
      let cx = x0, cy = y0, a = ang;
      for (let i = 0; i < seg; i++) {
        const step = len / seg;
        a += (Math.random() - 0.5) * 0.55;
        cx += Math.cos(a) * step;
        cy += Math.sin(a) * step;
        // 用二次曲线让裂纹更自然（带折角）
        const mx = cx + (Math.random() - 0.5) * step * 0.6;
        const my = cy + (Math.random() - 0.5) * step * 0.6;
        d += " Q " + mx.toFixed(1) + " " + my.toFixed(1) + " " + cx.toFixed(1) + " " + cy.toFixed(1);
      }
      return { d: d, ex: cx, ey: cy, ang: a };
    }

    const mainCracks = [];
    const N_MAIN = 8;
    for (let i = 0; i < N_MAIN; i++) {
      const ang = (i / N_MAIN) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const len = Math.max(W, H) * (0.34 + Math.random() * 0.32);
      const c = crackPath(x, groundY, ang, len, 9);
      mainCracks.push(c);

      const line = document.createElementNS(NS, "path");
      line.setAttribute("d", c.d);
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "#1a1410");
      line.setAttribute("stroke-width", "2.5");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("opacity", "0.9");
      svg.appendChild(line);

      // 用 dashoffset 让裂纹"爬出来"
      let L = 2000;
      try { L = line.getTotalLength(); } catch (e) { }
      line.setAttribute("stroke-dasharray", L);
      line.setAttribute("stroke-dashoffset", L);
      line.animate(
        [{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
        { duration: T(460), easing: "ease-out", fill: "forwards", delay: T(60 + i * 42) }
      );

      // 分叉（每条主裂纹长 2~3 根小叉）
      const forks = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < forks; k++) {
        const t = 0.45 + Math.random() * 0.45;
        const fx0 = x + (c.ex - x) * t, fy0 = groundY + (c.ey - groundY) * t;
        const fc = crackPath(fx0, fy0, c.ang + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7),
          len * (0.16 + Math.random() * 0.22), 5);
        const fl = document.createElementNS(NS, "path");
        fl.setAttribute("d", fc.d);
        fl.setAttribute("fill", "none");
        fl.setAttribute("stroke", "#1a1410");
        fl.setAttribute("stroke-width", "1.6");
        fl.setAttribute("opacity", "0.8");
        svg.appendChild(fl);
        let FL = 800;
        try { FL = fl.getTotalLength(); } catch (e) { }
        fl.setAttribute("stroke-dasharray", FL);
        fl.setAttribute("stroke-dashoffset", FL);
        fl.animate([{ strokeDashoffset: FL }, { strokeDashoffset: 0 }],
          { duration: T(380), easing: "ease-out", fill: "forwards", delay: T(200 + Math.random() * 420) });
      }

      // 裂纹边上的碎屑
      setTimeout(function () {
        for (let m = 0; m < 6; m++) {
          burst(x + (c.ex - x) * Math.random(), groundY + (c.ey - groundY) * Math.random(), {
            count: 3, size: 10, speed: 130, life: 1100,
            colors: ["#8a6a4a", "#5a4030", "#c8a878"],
          });
        }
      }, T(140 + i * 50));
    }

    // ---------- ③ 裂纹变粗变亮（岩浆色透出来）----------
    setTimeout(function () {
      const hot = [];
      for (const c of mainCracks) {
        const line = document.createElementNS(NS, "path");
        line.setAttribute("d", c.d);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "#ff7a1a");
        line.setAttribute("stroke-width", "3.5");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("opacity", "0");
        line.style.filter = "drop-shadow(0 0 10px #ff6b00) drop-shadow(0 0 26px #ff2d00)";
        svg.appendChild(line);
        hot.push(line);
        line.animate(
          [{ opacity: 0, strokeWidth: 3.5 },
           { opacity: 0.95, strokeWidth: 5.5, offset: 0.25 },
           { opacity: 0.9, strokeWidth: 5, offset: 0.7 },
           { opacity: 0, strokeWidth: 3 }],
          { duration: T(1500), easing: "ease-in-out", fill: "forwards" }
        );
      }
      flash("#ff9a3c", T(260));
      shake("quake");
      // 缝里往上冒光
      for (let i = 0; i < qc(30); i++) {
        setTimeout(function () {
          const a = Math.random() * Math.PI * 2, d = Math.random() * Math.max(W, H) * 0.32;
          burst(x + Math.cos(a) * d, groundY + Math.sin(a) * d * 0.6, {
            count: 4, size: 13, speed: 110, life: 1500,
            colors: ["#ffd166", "#ff7a1a", "#ff2d00", "#8a4a2a"],
          });
        }, i * 30);
      }
      setTimeout(function () { hot.forEach(function (n) { if (n.parentNode) n.remove(); }); }, T(1600));
    }, T(520));

    // ---------- ④ 裂纹持续"呼吸" + 缝里不断冒火星和灰 ----------
    //   （不做"屏幕碎成几块" —— 用户说只要裂纹）
    setTimeout(function () {
      // 裂纹周期性亮一下（像岩浆在底下流动）
      for (let p = 0; p < 4; p++) {
        setTimeout(function () {
          for (const c of mainCracks) {
            const line = document.createElementNS(NS, "path");
            line.setAttribute("d", c.d);
            line.setAttribute("fill", "none");
            line.setAttribute("stroke", p % 2 === 0 ? "#ffb03a" : "#ff5a10");
            line.setAttribute("stroke-width", "4.5");
            line.setAttribute("stroke-linecap", "round");
            line.setAttribute("opacity", "0");
            line.style.filter = "drop-shadow(0 0 12px #ff7a1a) drop-shadow(0 0 32px #ff2d00)";
            svg.appendChild(line);
            line.animate(
              [{ opacity: 0 }, { opacity: 0.85, offset: 0.35 }, { opacity: 0.75, offset: 0.7 }, { opacity: 0 }],
              { duration: T(760), easing: "ease-in-out", fill: "forwards" }
            ).onfinish = function () { line.remove(); };
          }
          if (p % 2 === 0) shake("mid");
          // 缝里往外喷一把火星
          for (let k = 0; k < 14; k++) {
            const c = mainCracks[Math.floor(Math.random() * mainCracks.length)];
            const t = Math.random();
            burst(x + (c.ex - x) * t, groundY + (c.ey - groundY) * t, {
              count: 3, size: 12, speed: 140, life: 1200,
              colors: ["#ffd166", "#ff7a1a", "#ff2d00", "#8a4a2a"],
            });
          }
        }, T(700 + p * 620));
      }

      // 持续的余烬 + 灰尘（一直到收尾）
      const ember = setInterval(function () {
        const c = mainCracks[Math.floor(Math.random() * mainCracks.length)];
        const t = Math.random();
        const ex = x + (c.ex - x) * t, ey = groundY + (c.ey - groundY) * t;
        burst(ex, ey, { count: 2, size: 10, speed: 110, life: 1400,
          colors: ["#ffd166", "#ff7a1a", "#8a4a2a"] });
        if (Math.random() < 0.35) {
          burst(ex + (Math.random() - 0.5) * 60, ey, { count: 2, size: 24, speed: 45, life: 2200,
            colors: ["rgba(150,120,95,.4)", "rgba(110,90,70,.3)"] });
        }
      }, T(110));
      setTimeout(function () { clearInterval(ember); }, T(3000));
    }, T(600));

    // ---------- ⑤ 岩石从天上砸落 ----------
    for (let i = 0; i < 14; i++) {
      setTimeout(function () {
        const rx = Math.random() * W;
        const size = 22 + Math.random() * 46;
        const rock = document.createElement("div");
        rock.style.cssText = "position:fixed;left:" + rx + "px;top:-" + (size * 2) + "px;" +
          "width:" + size + "px;height:" + (size * 0.78) + "px;pointer-events:none;z-index:9995;" +
          "background:linear-gradient(135deg,#5a4a3a,#8a7560 40%,#3a2f26 100%);" +
          "clip-path:polygon(18% 0%, 82% 8%, 100% 46%, 86% 100%, 26% 92%, 0% 54%);" +
          "box-shadow:0 0 14px rgba(0,0,0,.6);will-change:transform;";
        fxLayer.appendChild(rock);
        const landY = groundY - 40 + Math.random() * (H - groundY) * 0.5;
        const spin = (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 400);
        rock.animate(
          [
            { transform: "translate(-50%,0) rotate(0deg) scale(.8)", opacity: 0 },
            { transform: "translate(-50%,0) rotate(" + (spin * 0.3) + "deg) scale(1)", opacity: 1, offset: 0.12 },
            { transform: "translate(-50%," + (landY + size * 2) + "px) rotate(" + spin + "deg) scale(1.15)", opacity: 1 },
          ],
          { duration: T(380 + Math.random() * 260), easing: "cubic-bezier(.5,0,.9,.5)", fill: "forwards" }
        ).onfinish = function () {
          // 砸到地面 → 碎开
          rock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T(90), fill: "forwards" })
            .onfinish = function () { rock.remove(); };
          burst(rx, landY + size * 2, {
            count: 14, size: 13, speed: 300, life: 1100,
            colors: ["#8a7560", "#5a4a3a", "#c8b090", "#fff"],
          });
          ring(rx, landY + size * 2, "rgba(200,180,150,.7)", 6);
          // 砸地扬尘
          for (let k = 0; k < 5; k++) {
            burst(rx + (Math.random() - 0.5) * 60, landY + size * 2, {
              count: 3, size: 24, speed: 70, life: 1600,
              colors: ["rgba(160,140,120,.5)", "rgba(120,105,90,.4)"],
            });
          }
          shake("mid");
        };
      }, T(900 + i * 130));
    }

    // ---------- ⑥ 裂缝里的地火 + 热浪 ----------
    setTimeout(function () {
      groundFire(x, groundY, T, 1);
      setTimeout(function () { smokePlume(x, groundY, T); }, T(300));
      setTimeout(function () { heatHaze(x, groundY, T); }, T(500));
    }, T(1000));

    // ---------- ⑦ 第一波冲击环 ----------
    setTimeout(function () { ring(x, groundY, "rgba(255,190,120,.95)", 30); }, T(40));
    setTimeout(function () { ring(x, groundY, "rgba(200,150,90,.7)", 46); }, T(150));

    // 收尾清理 svg
    setTimeout(function () { if (svg.parentNode) svg.remove(); }, T(3400));
  }

  // ============================================================
  // 核弹：一颗超大核弹从天上掉下来 → 砸地 → 蘑菇云
  //   第一幕（0.0~1.1 秒）：核弹坠落（占大半屏幕、带火焰拖尾、旋转）
  //   第二幕（1.1 秒起）：砸地 → 白闪 → 蘑菇云升起 → 冲击波横扫
  // ============================================================
  function nukeFx(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const W = window.innerWidth, H = window.innerHeight;
    const groundY = Math.min(y, H - 60);

    // ---------- 第一幕：核弹坠落 ----------
    //   形状用"版本 D · 导弹（正视）"：尖弹头 + 金属圆柱 + 黄黑危险条纹 + 尾翼
    const BOMB = Math.max(240, Math.min(W * 0.30, 400));    // 核弹宽度（占屏幕约 1/3）
    const FALL = 1100;                                       // 坠落时长（毫秒，未缩放）
    const bw = BOMB;                                         // 弹体整体宽高比 1 : 1.25
    const bh = BOMB * 1.25;

    const bomb = document.createElement("div");
    bomb.style.cssText = "position:fixed;left:" + x + "px;top:-" + (bh * 0.85) + "px;" +
      "width:" + bw + "px;height:" + bh + "px;pointer-events:none;z-index:9996;" +
      "transform:translate(-50%,0);will-change:transform;" +
      "filter:drop-shadow(0 0 30px rgba(255,180,60,.85)) drop-shadow(0 0 90px rgba(255,90,0,.6));";

    const METAL = "linear-gradient(100deg,#1e2028 0%,#4a505c 20%,#aeb6c2 46%,#e4e8ee 52%,#7a8290 64%,#22242c 100%)";
    const half = bw / 2;

    // ① 尾翼（后面那片，先画，会被弹体盖住一部分）
    const finB = document.createElement("div");
    finB.style.cssText = "position:absolute;left:50%;top:57%;transform:translateX(-50%);" +
      "width:" + (bw * 0.30) + "px;height:" + (bh * 0.30) + "px;" +
      "background:linear-gradient(100deg,#0e1014,#3a414c 60%,#0e1014);border-radius:2px;";
    bomb.appendChild(finB);

    // ② 弹头（尖锥）
    const nose = document.createElement("div");
    nose.style.cssText = "position:absolute;left:50%;top:0;transform:translateX(-50%);" +
      "width:" + (bw * 0.40) + "px;height:" + (bh * 0.30) + "px;" +
      "clip-path:polygon(50% 0%, 92% 66%, 100% 100%, 0% 100%, 8% 66%);" +
      "background:" + METAL + ";";
    bomb.appendChild(nose);

    // ③ 弹体（金属圆柱）
    const body = document.createElement("div");
    body.style.cssText = "position:absolute;left:50%;top:" + (bh * 0.24) + "px;transform:translateX(-50%);" +
      "width:" + (bw * 0.40) + "px;height:" + (bh * 0.46) + "px;" +
      "background:linear-gradient(100deg,#1e2028 0%,#464c58 18%,#a6aeba 46%,#e0e4ea 52%,#78808e 62%,#20222a 100%);" +
      "box-shadow:inset -8px 0 16px rgba(0,0,0,.6);";
    bomb.appendChild(body);

    // ④ 黄黑危险条纹
    const stripe = document.createElement("div");
    stripe.style.cssText = "position:absolute;left:50%;top:" + (bh * 0.40) + "px;transform:translateX(-50%);" +
      "width:" + (bw * 0.40) + "px;height:" + (bh * 0.17) + "px;" +
      "background:repeating-linear-gradient(45deg,#e0a81c 0px,#e0a81c 9px,#1a1c22 9px,#1a1c22 18px);" +
      "opacity:.92;";
    bomb.appendChild(stripe);

    // ⑤ 左右尾翼
    [-1, 1].forEach(function (side) {
      const fin = document.createElement("div");
      fin.style.cssText = "position:absolute;top:" + (bh * 0.60) + "px;" +
        (side < 0 ? "left:" + (half - bw * 0.54) + "px;" : "right:" + (half - bw * 0.54) + "px;") +
        "width:" + (bw * 0.28) + "px;height:" + (bh * 0.30) + "px;" +
        "background:linear-gradient(100deg,#181a20,#5a6270 55%,#181a20);" +
        "clip-path:polygon(" + (side < 0 ? "100% 0%, 100% 100%, 0% 100%" : "0% 0%, 0% 100%, 100% 100%") + ");";
      bomb.appendChild(fin);
    });

    // ⑥ 弹头尖端的引信火花（闪烁）
    const fuse = document.createElement("div");
    fuse.style.cssText = "position:absolute;left:50%;top:" + (-bw * 0.10) + "px;transform:translateX(-50%);" +
      "width:" + (bw * 0.12) + "px;height:" + (bw * 0.12) + "px;border-radius:50%;" +
      "background:radial-gradient(circle,#fff 0%,#ffe07a 35%,#ff8c1a 68%,rgba(255,60,0,0) 100%);" +
      "box-shadow:0 0 22px #ffd166,0 0 60px #ff6b35,0 0 110px #ff2d00;";
    bomb.appendChild(fuse);
    fuse.animate(
      [{ opacity: 0.4, transform: "translateX(-50%) scale(.7)" },
       { opacity: 1, transform: "translateX(-50%) scale(1.3)", offset: 0.5 },
       { opacity: 0.55, transform: "translateX(-50%) scale(.85)" }],
      { duration: 200, iterations: Math.ceil(FALL / 200), easing: "ease-in-out", fill: "forwards" }
    );

    fxLayer.appendChild(bomb);

    // 坠落时：从右上角斜着砸下来 + 越来越大 + 旋转
    bomb.animate(
      [
        { transform: "translate(-50%, 0) translate(-42vw, -10vh) scale(.45) rotate(-32deg)", opacity: 0 },
        { transform: "translate(-50%, 0) translate(-30vw, 8vh) scale(.7) rotate(-18deg)", opacity: 1, offset: 0.16 },
        { transform: "translate(-50%, 0) translate(-12vw, 42vh) scale(1.1) rotate(4deg)", opacity: 1, offset: 0.62 },
        { transform: "translate(-50%, 0) translate(0, " + (groundY + bh * 0.5) + "px) scale(1.36) rotate(14deg)", opacity: 1 },
      ],
      { duration: FALL, easing: "cubic-bezier(.55,0,.9,.4)", fill: "forwards" }
    );

    // 火焰拖尾 + 音效
    sfxFall(FALL);
    let n = 0;
    const trail = setInterval(function () {
      const r = bomb.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      burst(cx, cy, { count: 6, size: 22, speed: 130, life: 900,
        colors: ["#fff", "#ffd166", "#ff6b35", "#ff2d00", "#8a2b00"] });
      if (++n % 2 === 0) {
        burst(cx + (Math.random() - 0.5) * 60, cy + (Math.random() - 0.5) * 60, {
          count: 4, size: 34, speed: 70, life: 1400,
          colors: ["rgba(90,90,90,.55)", "rgba(140,140,140,.45)", "rgba(255,140,60,.35)"],
        });
      }
      if (n > 40) clearInterval(trail);
    }, T(28));

    // 越接近地面，屏幕越暗、越紧张
    const dark = document.createElement("div");
    dark.style.cssText = "position:fixed;inset:0;background:#000;pointer-events:none;z-index:9990;opacity:0;";
    fxLayer.appendChild(dark);
    dark.animate([{ opacity: 0 }, { opacity: 0.42 }],
      { duration: FALL, easing: "cubic-bezier(.4,0,.9,.5)", fill: "forwards" }).onfinish = function () { dark.remove(); };

    // 坠落中轻微震屏（空气被撕开）
    setTimeout(function () { shake("light"); }, T(FALL * 0.45));
    setTimeout(function () { shake("mid"); }, T(FALL * 0.78));

    // ---------- 第二幕：砸地 → 爆炸 ----------
    setTimeout(function () {
      clearInterval(trail);
      if (bomb.parentNode) bomb.remove();

      sfxSlam();
      flash("#fffbe0", T(500));
      setTimeout(function () { flash("#fff", T(700)); }, T(90));
      setTimeout(function () { flash("#ff8c42", T(900)); }, T(200));
      shake("quake");
      setTimeout(function () { shake("quake"); }, T(220));
      ring(x, groundY, "#fff", 34);
      setTimeout(function () { ring(x, groundY, "#ffd166", 24); }, T(80));

      // 深橙色天空压上来
      const sky = document.createElement("div");
      sky.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9987;" +
        "background:radial-gradient(ellipse at 50% " + Math.round(groundY / H * 100) + "%, " +
        "rgba(255,180,60,.75) 0%, rgba(255,90,0,.55) 25%, rgba(120,20,0,.45) 55%, rgba(0,0,0,.7) 100%);";
      fxLayer.appendChild(sky);
      sky.animate([{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
        { duration: T(4200), easing: "ease-in-out", fill: "forwards" }).onfinish = () => sky.remove();

      // ---------- 蘑菇云 ----------
      const CAP_H = Math.max(150, Math.min(300, H * 0.38));   // 伞盖直径
      const STEM_H = Math.max(120, Math.min(260, H * 0.3));   // 蘑菇总高

      const stage = document.createElement("div");
      stage.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:9993;";
      fxLayer.appendChild(stage);

      // 柱子
      const stem = document.createElement("div");
      const stemW = CAP_H * 0.30;
      stem.style.cssText = "position:absolute;left:" + (x - stemW / 2) + "px;top:" + (groundY - STEM_H) + "px;" +
        "width:" + stemW + "px;height:" + STEM_H + "px;transform-origin:50% 100%;transform:scaleY(0) scaleX(0.5);" +
        "background:linear-gradient(0deg, rgba(255,245,220,.95) 0%, rgba(255,196,80,.95) 22%, " +
        "rgba(255,120,20,.9) 55%, rgba(120,40,0,.85) 100%);" +
        "border-radius:" + (stemW * 0.4) + "px " + (stemW * 0.4) + "px " + (stemW * 0.2) + "px " + (stemW * 0.2) + "px;" +
        "filter:blur(" + qb(3) + "px) drop-shadow(0 0 40px rgba(255,140,0,.85));";
      stage.appendChild(stem);
      stem.animate(
        [{ transform: "scaleY(0) scaleX(.5)", opacity: 0, filter: "blur(10px)" },
         { transform: "scaleY(1) scaleX(1)", opacity: 1, filter: "blur(3px)", offset: 0.55 },
         { transform: "scaleY(1.04) scaleX(1.02)", opacity: 1, offset: 0.8 },
         { transform: "scaleY(1.1) scaleX(1.06)", opacity: 0, filter: "blur(14px)" }],
        { duration: T(3400), easing: "cubic-bezier(.2,.8,.25,1)", fill: "forwards", delay: T(130) }
      ).onfinish = () => stage.remove();

      // 伞盖
      const capH = CAP_H, capW = CAP_H * 1.35;
      const cap = document.createElement("div");
      cap.style.cssText = "position:absolute;left:" + (x - capW / 2) + "px;top:" + (groundY - STEM_H - capH * 0.42) + "px;" +
        "width:" + capW + "px;height:" + capH + "px;transform-origin:50% 75%;transform:scale(0);" +
        "border-radius:50% 50% 46% 46%;" +
        "background:radial-gradient(circle at 50% 62%, rgba(255,255,245,.98) 0%, rgba(255,225,140,.97) 18%, " +
        "rgba(255,150,30,.95) 40%, rgba(230,70,10,.9) 62%, rgba(90,25,0,.75) 84%, rgba(40,10,0,0) 100%);" +
        "filter:blur(" + qb(4) + "px) drop-shadow(0 0 60px rgba(255,140,0,.9)) drop-shadow(0 -20px 80px rgba(255,90,0,.6));";
      stage.appendChild(cap);
      cap.animate(
        [{ transform: "scale(0)", opacity: 0 },
         { transform: "scale(.45)", opacity: 1, offset: 0.16 },
         { transform: "scale(1.06)", opacity: 1, offset: 0.34 },
         { transform: "scale(1.0)", opacity: 1, offset: 0.62 },
         { transform: "scale(1.22)", opacity: 0, filter: "blur(18px)" }],
        { duration: T(3400), easing: "cubic-bezier(.15,.9,.25,1)", fill: "forwards", delay: T(360) }
      );

      // 伞盖边缘的滚滚烟团
      for (let i = 0; i < qc(30); i++) {
        const ang = (i / 30) * Math.PI * 2 + Math.random() * 0.3;
        const rad = 0.42 + Math.random() * 0.2;
        const cx = Math.cos(ang) * capW * rad;
        const cy = Math.sin(ang) * capH * rad * 0.82;
        const size = capH * (0.22 + Math.random() * 0.18);
        const p = document.createElement("div");
        p.style.cssText = "position:absolute;left:" + (x + cx - size / 2) + "px;" +
          "top:" + (groundY - STEM_H - capH * 0.42 + capH / 2 + cy - size / 2) + "px;" +
          "width:" + size + "px;height:" + size + "px;border-radius:50%;opacity:0;" +
          "transform:scale(.2);will-change:transform;";
        const hue = Math.random() < 0.42 ? "255,245,225" : (Math.random() < 0.5 ? "255,205,110" : "255,120,30");
        p.style.background = "radial-gradient(circle at 40% 40%, rgba(" + hue + ",.95) 0%, rgba(" + hue + ",.55) 45%, rgba(80,25,0,.35) 78%, rgba(40,10,0,0) 100%)";
        p.style.filter = "blur(" + qb(2 + Math.random() * 5) + "px)";
        stage.appendChild(p);
        const dx = (Math.random() - 0.5) * capW * 0.5;
        const dy = -capH * (0.15 + Math.random() * 0.45);
        p.animate(
          [{ transform: "scale(.2) translate(0,0)", opacity: 0 },
           { transform: "scale(1) translate(0,0)", opacity: 0.95, offset: 0.3 },
           { transform: "scale(" + (1.3 + Math.random() * 0.7).toFixed(2) + ") translate(" + dx.toFixed(0) + "px," + dy.toFixed(0) + "px)", opacity: 0.5, offset: 0.75 },
           { transform: "scale(" + (2 + Math.random()).toFixed(2) + ") translate(" + (dx * 1.8).toFixed(0) + "px," + (dy * 1.6).toFixed(0) + "px)", opacity: 0 }],
          { duration: T(2400 + Math.random() * 1200), easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards", delay: T(380 + Math.random() * 260) }
        );
      }

      // 冲击波
      const shockCss = "position:fixed;left:" + x + "px;top:" + groundY + "px;width:20px;height:20px;" +
        "margin-left:-10px;margin-top:-10px;border-radius:50%;pointer-events:none;" +
        "border:6px solid rgba(255,240,200,.95);box-shadow:0 0 30px #fff,0 0 80px #ffb703,0 0 160px #ff6b35;";
      const shock = document.createElement("div");
      shock.style.cssText = shockCss + "z-index:9992;";
      fxLayer.appendChild(shock);
      const maxD = Math.max(W, H) * 1.5;
      shock.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(" + (maxD / 20) + ")", opacity: 0 }],
        { duration: T(1100), easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" }).onfinish = () => shock.remove();
      setTimeout(function () {
        const s2 = document.createElement("div");
        s2.style.cssText = shockCss + "z-index:9991;border-width:3px;";
        fxLayer.appendChild(s2);
        s2.animate([{ transform: "scale(1)", opacity: .6 }, { transform: "scale(" + (maxD / 20) + ")", opacity: 0 }],
          { duration: T(1500), easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" }).onfinish = () => s2.remove();
      }, T(140));

      setTimeout(function () { shake("quake"); }, T(60));
      setTimeout(function () { shake("heavy"); }, T(320));

      // 地面火 / 烟 / 热浪
      groundFire(x, groundY, T, 1);
      smokePlume(x, groundY, T);
      heatHaze(x, groundY, T);

      // 碎屑往外飞
      for (let i = 0; i < qc(40); i++) {
        setTimeout(function () {
          burst(x + (Math.random() - 0.5) * W * 0.9, groundY - Math.random() * 60, {
            count: 4, size: 12, speed: 340, life: 1600,
            colors: ["#fff", "#ffd166", "#ff6b35", "#ff2d00", "#8a4a2a"],
          });
        }, T(120 + i * 28));
      }

      // 余烬飘落
      for (let i = 0; i < qc(34); i++) {
        setTimeout(function () {
          burst(Math.random() * W, -20, {
            count: 2, size: 9, speed: 40, life: 3000,
            colors: ["rgba(255,220,150,.85)", "rgba(255,140,60,.75)", "rgba(200,200,200,.5)"],
          });
        }, T(700 + i * 70));
      }

      // 远处小爆
      for (let i = 0; i < qc(7); i++) {
        setTimeout(function () {
          const ox = x + (Math.random() - 0.5) * W * 0.85;
          const oy = groundY - Math.random() * 70;
          flash("rgba(255,200,120,.28)", T(200));
          burst(ox, oy, { count: 16, size: 12, speed: 300, life: 1100, colors: ["#fff", "#ffd166", "#ff6b35"] });
          ring(ox, oy, "rgba(255,220,150,.8)", 8);
          shake("mid");
        }, T(900 + i * 300));
      }
    }, T(FALL));
  }

  // ============================================================
  // 斩杀：平时出牌 —— 就写一个"斩"字，不做花哨动画
  //   （"切成两半"是角色死亡时的事，见 splitPanel）
  // ============================================================
  function executeFx(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const big = document.createElement("div");
    big.textContent = "斩";
    big.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;" +
      "transform:translate(-50%,-50%) scale(3.2);" +
      'font-size:150px;font-weight:900;color:#fff;font-family:Impact,"Microsoft YaHei",sans-serif;' +
      "text-shadow:0 0 28px #ff2d2d,0 0 80px #ff0000,0 6px 0 #120000;" +
      "pointer-events:none;z-index:10000;";
    fxLayer.appendChild(big);
    big.animate(
      [{ transform: "translate(-50%,-50%) scale(3.2)", opacity: 0 },
       { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.18 },
       { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.7 },
       { transform: "translate(-50%,-50%) scale(1.35)", opacity: 0 }],
      { duration: T(1100), easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" }
    ).onfinish = function () { big.remove(); };
    sfx("slash");
    shake("heavy");
    flash("#fff", T(110));
  }

  // ============================================================
  // 黑洞：空间被弯折 → 事件视界（纯黑）+ 光子环 → 吸积盘旋转
  //       → 周围的东西被拉成长条吸进去 → 塌缩消失
  //   节奏（未缩放，毫秒）：
  //     0     画面变暗（周围的光被吃掉）
  //     60    中心出现一个点，猛地张开成黑洞（奇点 → 视界）
  //     200   光子环亮起（一圈极窄的亮环，绕在视界外）
  //     240   吸积盘出现，开始旋转（两层，反向转）
  //     300   周围 46 个东西被"拉成长条"螺旋吸进去
  //     900   空间弯曲：背景被扭曲（径向拉伸）
  //     1700  黑洞塌缩（先缩小、再瞬间消失）+ 一圈反冲环
  // ============================================================
  function blackholeFx(x, y, speed) {
    const sp = speed || 1;
    const T = (ms) => ms / sp;
    const W = window.innerWidth, H = window.innerHeight;
    const R = Math.max(70, Math.min(150, Math.min(W, H) * 0.16));   // 事件视界半径

    // ---------- ① 画面变暗（光被吃掉）----------
    const dim = document.createElement("div");
    dim.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9985;" +
      "background:radial-gradient(circle at " + x + "px " + y + "px, rgba(0,0,0,0) 0%, " +
      "rgba(10,0,20,.55) 35%, rgba(0,0,0,.85) 100%);";
    fxLayer.appendChild(dim);
    dim.animate([{ opacity: 0 }, { opacity: 1, offset: 0.22 }, { opacity: 1, offset: 0.78 }, { opacity: 0 }],
      { duration: T(2400), easing: "ease-in-out", fill: "forwards" }).onfinish = () => dim.remove();

    // 空间弯折：整个画面用 CSS 滤镜扭曲一下（像被引力拉扯）
    //    ⚠️ 低配档位跳过（backdrop-filter 手机极卡）
    const lens = document.createElement("div");
    if (Q.tier !== "low") {
    lens.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9986;" +
      "backdrop-filter:blur(" + qb(2) + "px) saturate(1.4);" +
      "-webkit-mask-image:radial-gradient(circle at " + x + "px " + y + "px, #000 0%, #000 22%, " +
      "rgba(0,0,0,.55) 40%, transparent 62%);" +
      "mask-image:radial-gradient(circle at " + x + "px " + y + "px, #000 0%, #000 22%, " +
      "rgba(0,0,0,.55) 40%, transparent 62%);";
    fxLayer.appendChild(lens);
    lens.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
      { duration: T(2200), easing: "ease-in-out", fill: "forwards" }).onfinish = () => lens.remove();
    }   // ← 低配档位跳到这里

    // ---------- ② 黑洞本体（视界 + 光子环 + 吸积盘）----------
    const stage = document.createElement("div");
    stage.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:0;height:0;" +
      "pointer-events:none;z-index:9996;";
    fxLayer.appendChild(stage);

    const size = R * 2;

    // ②-1 引力光晕（最外面一层暗紫）
    const halo = document.createElement("div");
    halo.style.cssText = "position:absolute;left:" + (-size * 1.6) + "px;top:" + (-size * 1.6) + "px;" +
      "width:" + (size * 3.2) + "px;height:" + (size * 3.2) + "px;border-radius:50%;" +
      "background:radial-gradient(circle, rgba(150,70,255,.42) 0%, rgba(90,20,190,.28) 30%, " +
      "rgba(30,0,70,.16) 52%, rgba(0,0,0,0) 72%);filter:blur(" + qb(12) + "px);";
    stage.appendChild(halo);

    // ②-2 吸积盘 —— 两层斜置的椭圆，反向旋转
    const diskOuter = document.createElement("div");
    diskOuter.style.cssText = "position:absolute;left:" + (-size * 1.5) + "px;top:" + (-size * 0.5) + "px;" +
      "width:" + (size * 3) + "px;height:" + size + "px;border-radius:50%;" +
      "background:conic-gradient(from 0deg, rgba(255,220,150,0) 0deg, rgba(255,190,90,.85) 40deg, " +
      "rgba(255,90,20,.9) 90deg, rgba(150,30,220,.85) 150deg, rgba(60,0,140,.7) 210deg, " +
      "rgba(255,140,40,.85) 280deg, rgba(255,220,150,0) 360deg);" +
      "filter:blur(" + qb(7) + "px) brightness(1.25);transform:rotate(-18deg);";
    stage.appendChild(diskOuter);
    diskOuter.animate([{ transform: "rotate(-18deg)" }, { transform: "rotate(342deg)" }],
      { duration: T(1500), iterations: 3, easing: "linear" });

    const diskInner = document.createElement("div");
    diskInner.style.cssText = "position:absolute;left:" + (-size * 1.05) + "px;top:" + (-size * 0.34) + "px;" +
      "width:" + (size * 2.1) + "px;height:" + (size * 0.68) + "px;border-radius:50%;" +
      "background:conic-gradient(from 90deg, rgba(255,255,220,0) 0deg, rgba(255,240,190,.9) 50deg, " +
      "rgba(255,150,60,.85) 120deg, rgba(200,80,255,.8) 200deg, rgba(255,200,120,.9) 290deg, " +
      "rgba(255,255,220,0) 360deg);" +
      "filter:blur(" + qb(4) + "px) brightness(1.4);transform:rotate(14deg);";
    stage.appendChild(diskInner);
    diskInner.animate([{ transform: "rotate(14deg)" }, { transform: "rotate(-346deg)" }],
      { duration: T(1000), iterations: 4, easing: "linear" });

    // ②-3 光子环（极窄的亮环，贴着视界）
    const photon = document.createElement("div");
    photon.style.cssText = "position:absolute;left:" + (-size * 0.62) + "px;top:" + (-size * 0.62) + "px;" +
      "width:" + (size * 1.24) + "px;height:" + (size * 1.24) + "px;border-radius:50%;" +
      "border:" + Math.max(2, R * 0.05) + "px solid rgba(255,250,230,.95);" +
      "box-shadow:0 0 18px #fff, 0 0 44px #ffd166, 0 0 90px #ff8c1a, inset 0 0 30px rgba(255,200,120,.7);";
    stage.appendChild(photon);

    // ②-4 事件视界（纯黑圆 + 内侧一点点紫，看起来"深不见底"）
    const horizon = document.createElement("div");
    horizon.style.cssText = "position:absolute;left:" + (-size * 0.5) + "px;top:" + (-size * 0.5) + "px;" +
      "width:" + size + "px;height:" + size + "px;border-radius:50%;background:#000;" +
      "box-shadow:inset 0 0 " + (R * 0.5) + "px rgba(90,20,160,.9), 0 0 " + (R * 0.3) + "px rgba(0,0,0,1);";
    stage.appendChild(horizon);

    // 整个黑洞：从奇点猛地张开 → 稳定 → 塌缩
    stage.animate(
      [{ transform: "scale(0)", opacity: 0, filter: "blur(16px)" },
       { transform: "scale(1.18)", opacity: 1, filter: "blur(0px)", offset: 0.14 },
       { transform: "scale(1)", opacity: 1, offset: 0.3 },
       { transform: "scale(1.04)", opacity: 1, offset: 0.72 },
       { transform: "scale(.06)", opacity: 0, filter: "blur(10px)" }],
      { duration: T(1900), easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" }
    ).onfinish = () => stage.remove();

    // 张开与塌缩的两次冲击
    shake("heavy");
    flash("#1a0030", T(400));
    setTimeout(function () { ring(x, y, "rgba(180,110,255,.9)", 26); }, T(60));

    // ---------- ③ 周围的东西被"拉成长条"螺旋吸进去 ----------
    for (let i = 0; i < qc(46); i++) {
      setTimeout(function () {
        const ang0 = Math.random() * Math.PI * 2;
        const dist = R * (3.2 + Math.random() * 3.4);
        const px = x + Math.cos(ang0) * dist;
        const py = y + Math.sin(ang0) * dist;
        const len = 14 + Math.random() * 46;
        const w = 2 + Math.random() * 4;

        const p = document.createElement("div");
        p.style.cssText = "position:fixed;left:" + px + "px;top:" + py + "px;" +
          "width:" + len + "px;height:" + w + "px;border-radius:" + w + "px;" +
          "pointer-events:none;z-index:9995;transform-origin:left center;" +
          "background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,235,190,.95) 45%, " +
          "rgba(255,150,60,.9) 78%, rgba(180,80,255,.8) 100%);" +
          "box-shadow:0 0 10px rgba(255,180,80,.8), 0 0 24px rgba(150,60,255,.6);";
        // 让它朝着黑洞的方向
        const aim = Math.atan2(y - py, x - px) * 180 / Math.PI;
        p.style.transform = "translate(-50%,-50%) rotate(" + aim + "deg)";
        fxLayer.appendChild(p);

        // 一边被拉长、一边加速、一边旋转着被吸进去
        const spin = 90 + Math.random() * 240;          // 附加旋转（螺旋感）
        const dur = 700 + Math.random() * 700;
        p.animate(
          [
            { transform: "translate(-50%,-50%) rotate(" + aim + "deg) scaleX(.6)", opacity: 0 },
            { transform: "translate(-50%,-50%) rotate(" + aim + "deg) scaleX(1)", opacity: 1, offset: 0.22 },
            {
              transform: "translate(calc(-50% + " + ((x - px) * 0.55) + "px), calc(-50% + " + ((y - py) * 0.55) + "px)) " +
                "rotate(" + (aim + spin * 0.5) + "deg) scaleX(2.2) scaleY(.55)", opacity: 0.95, offset: 0.62
            },
            {
              transform: "translate(calc(-50% + " + (x - px) + "px), calc(-50% + " + (y - py) + "px)) " +
                "rotate(" + (aim + spin) + "deg) scaleX(0.05) scaleY(.2)", opacity: 0
            },
          ],
          { duration: dur / sp, easing: "cubic-bezier(.45,0,.85,.5)", fill: "forwards" }
        ).onfinish = function () { p.remove(); };
      }, T(300 + i * 26));
    }

    // ---------- ④ 被吸进去的星点（小光点，绕着转进去）----------
    for (let i = 0; i < qc(34); i++) {
      setTimeout(function () {
        const ang0 = Math.random() * Math.PI * 2;
        const dist = R * (2.4 + Math.random() * 3);
        const px = x + Math.cos(ang0) * dist;
        const py = y + Math.sin(ang0) * dist;
        const d = document.createElement("div");
        d.style.cssText = "position:fixed;left:" + px + "px;top:" + py + "px;width:6px;height:6px;" +
          "border-radius:50%;pointer-events:none;z-index:9995;background:#fff9e6;" +
          "box-shadow:0 0 10px #ffd166,0 0 22px #ff8c1a;";
        fxLayer.appendChild(d);
        // 用两段位移模拟"绕圈"
        const midAng = ang0 + 1.5, endAng = ang0 + 3.2;
        const rd = dist * 0.42, rd2 = dist * 0.06;
        d.animate(
          [
            { transform: "translate(-50%,-50%) scale(1)", opacity: 0 },
            { transform: "translate(-50%,-50%) scale(1.5)", opacity: 1, offset: 0.2 },
            {
              transform: "translate(calc(-50% + " + (Math.cos(midAng) * rd - Math.cos(ang0) * dist) + "px), " +
                "calc(-50% + " + (Math.sin(midAng) * rd - Math.sin(ang0) * dist) + "px)) scale(1.1)", opacity: 1, offset: 0.6
            },
            {
              transform: "translate(calc(-50% + " + (Math.cos(endAng) * rd2 - Math.cos(ang0) * dist) + "px), " +
                "calc(-50% + " + (Math.sin(endAng) * rd2 - Math.sin(ang0) * dist) + "px)) scale(.1)", opacity: 0
            },
          ],
          { duration: (900 + Math.random() * 700) / sp, easing: "cubic-bezier(.4,0,.8,.6)", fill: "forwards" }
        ).onfinish = function () { d.remove(); };
      }, T(320 + i * 34));
    }

    // ---------- ⑤ 塌缩：黑洞吸掉之后，反冲一圈冲击波 ----------
    setTimeout(function () {
      flash("#e8d4ff", T(260));
      ring(x, y, "rgba(200,150,255,.95)", 34);
      shake("quake");
      for (let i = 0; i < qc(24); i++) {
        burst(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60, {
          count: 4, size: 11, speed: 420, life: 1100,
          colors: ["#fff", "#e0c8ff", "#a55cff", "#5a1ab0"],
        });
      }
    }, T(1720));
  }

  function acidFx(x, y) {
    flash("#8cff6b", 260);
    for (let i = 0; i < 22; i++) {
      setTimeout(function () {
        burst(x + (Math.random() - 0.5) * 280, y + (Math.random() - 0.5) * 150, {
          count: 5, size: 13, speed: 210, life: 1300, colors: ["#8cff6b", "#3ddc50", "#c9ffd2"],
        });
      }, i * 50);
    }
    ring(x, y, "#8cff6b", 14);
    shake("mid");
  }

  function guillotineFx(x, y) {
    const blade = document.createElement("div");
    blade.textContent = "🔪";
    blade.style.cssText = "position:fixed;left:" + x + "px;top:-140px;font-size:90px;pointer-events:none;" +
      "z-index:9998;transform:translateX(-50%);filter:drop-shadow(0 0 18px #fff) drop-shadow(0 0 40px #c0c0c0);";
    fxLayer.appendChild(blade);
    blade.animate(
      [{ transform: "translateX(-50%) translateY(0)", opacity: 0 },
       { transform: "translateX(-50%) translateY(60px)", opacity: 1, offset: 0.15 },
       { transform: "translateX(-50%) translateY(" + (y + 140) + "px)", opacity: 1, offset: 0.85 },
       { transform: "translateX(-50%) translateY(" + (y + 190) + "px)", opacity: 0 }],
      { duration: 700, easing: "cubic-bezier(.6,0,.9,.4)", fill: "forwards" }
    ).onfinish = function () { blade.remove(); };
    setTimeout(function () {
      flash("#fff", 200);
      slashFx(x, y, "#e8e8e8");
      shake("heavy");
      burst(x, y, { count: 32, size: 14, speed: 440, life: 1300, colors: ["#fff", "#c0c0c0", "#ff5a5a"] });
    }, 620);
  }

  function snipeFx(x, y) {
    const line = document.createElement("div");
    line.style.cssText = "position:fixed;left:" + x + "px;top:0;width:2px;height:" + y + "px;" +
      "background:linear-gradient(180deg,transparent,rgba(255,60,60,.9));" +
      "box-shadow:0 0 10px #ff3b3b;pointer-events:none;z-index:9996;";
    fxLayer.appendChild(line);
    line.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
      { duration: 800, fill: "forwards" }).onfinish = function () { line.remove(); };
    setTimeout(function () {
      flash("#fff", 140);
      ring(x, y, "#ff3b3b", 12);
      burst(x, y, { count: 26, size: 12, speed: 400, life: 1000, colors: ["#ff3b3b", "#fff", "#8a0012"] });
      shake("heavy");
      sfx("punch");
    }, 700);
  }

  // ============================================================
  //  💣 定时炸弹
  //    三种时刻：
  //      ① 下雷（放到对方牌库顶）：炸弹掉下来"咚"一声贴在牌库上
  //      ② 倒计时（对方抽到了）：计时器跳字，引信越烧越快
  //      ③ 爆炸（选择丢掉 / 硬吃）：信号弹 → 白闪 → 火球 → 冲击环 → 碎片
  //    ⚠️ 每次被打回来，计时器的红色会更亮、"更危险"（轮次越深越吓人）
  // ============================================================
  function makeBomb(count) {
    const wrap = document.createElement("div");
    const danger = Math.min(3, count || 1);              // 第几轮（1~3+）
    const alarmCol = danger >= 3 ? "#ff2020" : (danger >= 2 ? "#ff5a3c" : "#ff8a3c");

    // 炸弹本体（用一个圆球 + 高光 + 计时器拼出来，不用 emoji，可控）
    const bomb = document.createElement("div");
    bomb.style.cssText =
      "position:relative;width:150px;height:150px;pointer-events:none;";

    // 球体
    const ball = document.createElement("div");
    ball.style.cssText =
      "position:absolute;left:0;top:14px;width:150px;height:150px;border-radius:50%;" +
      "background:radial-gradient(circle at 34% 30%, #6a6a78 0%, #33333e 26%, #1a1a22 55%, #0a0a10 100%);" +
      "box-shadow:inset -14px -18px 34px rgba(0,0,0,.85), inset 10px 12px 26px rgba(255,255,255,.14)," +
      "0 0 30px rgba(0,0,0,.9), 0 0 60px rgba(255,60,40," + (0.10 * danger) + ");";
    bomb.appendChild(ball);

    // 镜面高光（小椭圆）
    const spec = document.createElement("div");
    spec.style.cssText =
      "position:absolute;left:34px;top:38px;width:34px;height:22px;border-radius:50%;" +
      "background:radial-gradient(ellipse, rgba(255,255,255,.85) 0%, rgba(255,255,255,0) 70%);" +
      "transform:rotate(-28deg);filter:blur(1px);";
    bomb.appendChild(spec);

    // 引信帽（金属）
    const cap = document.createElement("div");
    cap.style.cssText =
      "position:absolute;left:64px;top:0;width:24px;height:22px;border-radius:4px 4px 2px 2px;" +
      "background:linear-gradient(180deg,#d8d8e2,#7a7a88 40%,#3a3a46 100%);" +
      "box-shadow:0 1px 3px rgba(0,0,0,.8);";
    bomb.appendChild(cap);

    // 引信（弯曲的线）
    const fuse = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    fuse.setAttribute("width", "58"); fuse.setAttribute("height", "46");
    fuse.style.cssText = "position:absolute;left:78px;top:-30px;overflow:visible;";
    const fp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    fp.setAttribute("d", "M4 44 C 10 18, 26 6, 46 10");
    fp.setAttribute("fill", "none");
    fp.setAttribute("stroke", "#8a7a5a");
    fp.setAttribute("stroke-width", "4");
    fp.setAttribute("stroke-linecap", "round");
    fuse.appendChild(fp);
    bomb.appendChild(fuse);

    // 火花（引信头上的亮点）
    const spark = document.createElement("div");
    spark.style.cssText =
      "position:absolute;left:120px;top:-30px;width:16px;height:16px;border-radius:50%;" +
      "background:radial-gradient(circle,#fff 0%,#ffd166 35%," + alarmCol + " 65%,rgba(255,80,0,0) 100%);" +
      "box-shadow:0 0 18px " + alarmCol + ", 0 0 36px rgba(255,120,0,.7);";
    bomb.appendChild(spark);

    // 计时器（黑底 + 红色数码）
    const timer = document.createElement("div");
    timer.style.cssText =
      "position:absolute;left:31px;top:52px;width:88px;height:44px;border-radius:6px;" +
      "background:linear-gradient(180deg,#15151c,#08080c);border:2px solid #3a3a46;" +
      "box-shadow:inset 0 0 14px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.8);" +
      "display:flex;align-items:center;justify-content:center;overflow:hidden;";
    const num = document.createElement("span");
    num.textContent = "10";
    num.style.cssText =
      "font-family:'Courier New',monospace;font-weight:bold;font-size:26px;letter-spacing:2px;" +
      "color:" + alarmCol + ";text-shadow:0 0 8px " + alarmCol + ",0 0 18px " + alarmCol + ";";
    timer.appendChild(num);
    bomb.appendChild(timer);

    // 玻璃反光扫过计时器（让它不像贴纸）
    const glass = document.createElement("div");
    glass.style.cssText =
      "position:absolute;left:31px;top:52px;width:88px;height:44px;border-radius:6px;overflow:hidden;";
    const gl2 = document.createElement("div");
    gl2.style.cssText = "position:absolute;left:-40px;top:0;width:26px;height:44px;" +
      "background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);" +
      "transform:skewX(-18deg);";
    glass.appendChild(gl2);
    bomb.appendChild(glass);

    wrap.appendChild(bomb);
    return { wrap, bomb, ball, spark, num, timer, gl2, alarmCol, danger };
  }

  // 小粒子（用于火花和碎片）
  function bombSpark(x, y, col, n, spd) {
    const c = qc(n);
    for (let i = 0; i < c; i++) {
      const s = document.createElement("div");
      const sz = 2 + Math.random() * 3;
      s.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + sz + "px;height:" + sz +
        "px;border-radius:50%;background:" + col + ";pointer-events:none;z-index:9999;" +
        "box-shadow:0 0 8px " + col + ";";
      fxLayer.appendChild(s);
      const a = Math.random() * Math.PI * 2, d = spd * (0.35 + Math.random() * 0.75);
      const ox = Math.cos(a) * d, oy = Math.sin(a) * d - spd * 0.3;
      s.animate([
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: "translate(" + ox * 0.6 + "px," + oy * 0.6 + "px) scale(.9)", opacity: 1, offset: 0.55 },
        { transform: "translate(" + ox + "px," + (oy + spd * 0.9) + "px) scale(.2)", opacity: 0 },
      ], { duration: bT(520 + Math.random() * 420), easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" })
        .onfinish = function () { s.remove(); };
    }
  }

  // ============================================================
  //  💣 定时炸弹 · 新实现
  //    思路改了：炸弹**不是一次性动画**，而是一个【挂在对手面板上的徽章】，
  //    像单位一样常驻（计时器一直跳、引信一直冒火星、越往后越危险）。
  //    这样天然不会重叠 —— 它就是一个"东西"，不是在播动画。
  //
  //    爆炸是独立的一次性大演出，来了就炸（不做去重，避免"没动画"）
  // ============================================================
  let bombBadge = null;          // { wrap, ball, spark, num, ring, danger, tremble }
  let bombTick = null;           // 计时器 interval
  let bombPos = { x: 0, y: 0 };  // 当前挂的位置（滚动/缩放时重算）
  let bombOnResize = null;
  // ⚠️ 这两个函数不在"某个动画函数"里，拿不到那边的局部 T()
  //    所以自己算一份（速度倍速缩放）
  const bSp = () => (typeof FX_SPEED === "function" ? FX_SPEED() : 1);
  const bT = (ms) => Math.max(1, ms / bSp());

  // 造一个炸弹徽章（比之前大一点、更精致）
  function makeBombBadge(danger, who) {
    const lvl = Math.min(3, Math.max(1, danger || 1));
    const alarm = lvl >= 3 ? "#ff1f1f" : (lvl >= 2 ? "#ff5a3c" : "#ff9a3c");
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:9997;" +
      "transform:translate(-50%,-50%);will-change:transform;";

    // 危险光晕（越危险越亮）
    const halo = document.createElement("div");
    const hs = 210 + lvl * 26;
    halo.style.cssText = "position:absolute;left:" + (-hs / 2) + "px;top:" + (-hs / 2) + "px;width:" + hs +
      "px;height:" + hs + "px;border-radius:50%;pointer-events:none;" +
      "background:radial-gradient(circle, rgba(255," + (90 - lvl * 20) + ",40," + (0.10 + lvl * 0.05) + ") 0%, " +
      "rgba(255,60,0," + (0.05 + lvl * 0.03) + ") 45%, rgba(0,0,0,0) 72%);";
    wrap.appendChild(halo);

    // 外壳（定时炸弹那种圆壳 + 顶部引信帽）
    const body = document.createElement("div");
    const SZ = 128;
    body.style.cssText = "position:absolute;left:" + (-SZ / 2) + "px;top:" + (-SZ / 2) + "px;width:" + SZ +
      "px;height:" + SZ + "px;border-radius:50%;" +
      "background:radial-gradient(circle at 32% 26%, #8a8a9a 0%, #4a4a58 20%, #26262e 52%, #0c0c12 100%);" +
      "box-shadow:inset -12px -16px 30px rgba(0,0,0,.9), inset 8px 10px 22px rgba(255,255,255,.16)," +
      "0 0 22px rgba(0,0,0,.9), 0 0 " + (20 + lvl * 12) + "px rgba(255," + (90 - lvl * 20) + ",40,.35);";
    wrap.appendChild(body);

    // 镜面高光
    const spec = document.createElement("div");
    spec.style.cssText = "position:absolute;left:" + (-SZ / 2 + 24) + "px;top:" + (-SZ / 2 + 26) +
      "px;width:34px;height:22px;border-radius:50%;transform:rotate(-30deg);filter:blur(1.2px);" +
      "background:radial-gradient(ellipse, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 72%);";
    wrap.appendChild(spec);

    // 引信帽
    const cap = document.createElement("div");
    cap.style.cssText = "position:absolute;left:-11px;top:" + (-SZ / 2 - 16) + "px;width:22px;height:20px;" +
      "border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,#e0e0ea,#8a8a98 42%,#3a3a46 100%);" +
      "box-shadow:0 1px 3px rgba(0,0,0,.85);";
    wrap.appendChild(cap);

    // 引信（弯线）
    const fuse = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    fuse.setAttribute("width", "56"); fuse.setAttribute("height", "44");
    fuse.style.cssText = "position:absolute;left:8px;top:" + (-SZ / 2 - 54) + "px;overflow:visible;";
    const fp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    fp.setAttribute("d", "M4 42 C 8 16, 24 4, 44 8");
    fp.setAttribute("fill", "none");
    fp.setAttribute("stroke", "#9a8a68");
    fp.setAttribute("stroke-width", "4");
    fp.setAttribute("stroke-linecap", "round");
    fuse.appendChild(fp);
    wrap.appendChild(fuse);

    // 引信头的火花（会一直跳）
    const spark = document.createElement("div");
    spark.style.cssText = "position:absolute;left:46px;top:" + (-SZ / 2 - 58) + "px;width:18px;height:18px;" +
      "border-radius:50%;pointer-events:none;" +
      "background:radial-gradient(circle,#fff 0%,#ffe066 32%," + alarm + " 62%,rgba(255,80,0,0) 100%);" +
      "box-shadow:0 0 16px " + alarm + ",0 0 34px rgba(255,120,0,.75);";
    wrap.appendChild(spark);

    // 计时器（黑底 + 红字 + 玻璃反光）
    const TW = 86, TH = 42;
    const timer = document.createElement("div");
    timer.style.cssText = "position:absolute;left:" + (-TW / 2) + "px;top:" + (-TH / 2 + 4) + "px;width:" + TW +
      "px;height:" + TH + "px;border-radius:7px;overflow:hidden;display:flex;align-items:center;" +
      "justify-content:center;border:2px solid #44444f;" +
      "background:linear-gradient(180deg,#16161e,#07070b);" +
      "box-shadow:inset 0 0 14px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.85);";
    const num = document.createElement("span");
    num.textContent = "10";
    num.style.cssText = "font-family:'Courier New',monospace;font-weight:bold;font-size:26px;" +
      "letter-spacing:2px;line-height:1;color:" + alarm + ";text-shadow:0 0 8px " + alarm + ",0 0 18px " + alarm + ";";
    timer.appendChild(num);
    const gl = document.createElement("div");
    gl.style.cssText = "position:absolute;left:-30px;top:0;width:24px;height:" + TH + "px;pointer-events:none;" +
      "background:linear-gradient(90deg,transparent,rgba(255,255,255,.24),transparent);transform:skewX(-18deg);";
    timer.appendChild(gl);
    wrap.appendChild(timer);

    // 危险度标签（第 N 轮）
    const tag = document.createElement("div");
    tag.textContent = "💣 第 " + lvl + " 轮";
    tag.style.cssText = "position:absolute;left:" + (-TW / 2) + "px;top:" + (TH / 2 + 12) + "px;width:" + TW +
      "px;text-align:center;font-size:12px;font-weight:bold;letter-spacing:1px;color:" + alarm +
      ";text-shadow:0 0 8px rgba(0,0,0,.9);";
    wrap.appendChild(tag);

    // 脉冲圈（越危险转得越快）
    const ring = document.createElement("div");
    const RS = SZ + 26;
    ring.style.cssText = "position:absolute;left:" + (-RS / 2) + "px;top:" + (-RS / 2) + "px;width:" + RS +
      "px;height:" + RS + "px;border-radius:50%;pointer-events:none;border:2px solid " + alarm +
      ";opacity:.45;box-shadow:0 0 18px " + alarm + ";";
    wrap.appendChild(ring);

    fxLayer.appendChild(wrap);
    return { wrap: wrap, ball: body, spark: spark, num: num, ring: ring, alarm: alarm, danger: lvl };
  }

  // 摆位置（挂在对应玩家的面板上边缘外面一点）
  function placeBombBadge() {
    if (!bombBadge) return;
    const el = document.getElementById(bombBadge.panelId || "oppPanel") || document.getElementById("oppPanel");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width * 0.5;
    const y = Math.max(70, r.top - 60);
    bombPos = { x: x, y: y };
    bombBadge.wrap.style.left = x + "px";
    bombBadge.wrap.style.top = y + "px";
  }

  // 显示/更新炸弹徽章（对手牌库顶有炸弹时调用）
  //   panelId: "oppPanel" / "mePanel"    danger: 第几轮（1~3）
  function syncBomb(info) {
    // info: { who: "opp"|"me"|null, danger: n }   传 null 表示"没有炸弹了"
    if (!info || !info.who) {
      if (bombBadge) {
        const b = bombBadge;
        bombBadge = null;
        if (bombTick) { clearInterval(bombTick); bombTick = null; }
        if (bombOnResize) {
          window.removeEventListener("scroll", bombOnResize, true);
          window.removeEventListener("resize", bombOnResize);
          bombOnResize = null;
        }
        try {
          b.wrap.animate([{ opacity: 1, transform: "translate(-50%,-50%) scale(1)" },
            { opacity: 0, transform: "translate(-50%,-50%) scale(.6)" }],
            { duration: 260, fill: "forwards" })
            .onfinish = function () { b.wrap.remove(); };
        } catch (e) { try { b.wrap.remove(); } catch (e2) { } }
      }
      return;
    }
    const panelId = info.who === "me" ? "mePanel" : "oppPanel";
    const danger = Math.min(3, Math.max(1, info.danger || 1));

    // 已经挂着同一个东西 → 只更新危险度（不重建，避免闪烁）
    if (bombBadge && bombBadge.panelId === panelId && bombBadge.danger === danger) {
      placeBombBadge();
      return;
    }
    // 换位置或换危险度 → 重建
    if (bombBadge) syncBomb(null);

    const b = makeBombBadge(danger, info.who);
    b.panelId = panelId;
    bombBadge = b;
    placeBombBadge();

    // 入场：从上方掉下来"咚"一下（短、只 420ms，不会和别的东西叠）
    b.wrap.animate([
      { opacity: 0, transform: "translate(-50%," + (-260) + "px) rotate(-16deg) scale(.7)" },
      { opacity: 1, transform: "translate(-50%,-50%) translateY(10px) rotate(3deg) scale(1.06)", offset: .72 },
      { opacity: 1, transform: "translate(-50%,-50%) translateY(0) rotate(0deg) scale(1)" },
    ], { duration: bT(420), easing: "cubic-bezier(.4,1.5,.5,1)", fill: "forwards" })
      .onfinish = function () { try { b.wrap.style.transform = "translate(-50%,-50%)"; } catch (e) { } };

    // 落地：震一下 + 一圈灰
    setTimeout(function () {
      if (!bombBadge || bombBadge !== b) return;
      ring(bombPos.x, bombPos.y + 44, "#ffb060", 10);
      bombSpark(bombPos.x, bombPos.y + 52, "#ffcf8a", 12, 90);
      shake("light");
      b.ring.animate([{ transform: "scale(1)", opacity: .5 }, { transform: "scale(1.5)", opacity: 0 }],
        { duration: bT(420), fill: "forwards" });
    }, bT(400));

    // 常驻跳动：计时器跳字 + 引信冒火星 + 抖动
    let n = 0, cnt = 10;
    bombTick = setInterval(function () {
      if (!bombBadge || bombBadge !== b) return;
      n++;
      // 火星
      const sx = bombPos.x + 44 + (Math.random() - .5) * 16;
      const sy = bombPos.y - 58 + (Math.random() - .5) * 12;
      bombSpark(sx, sy, Math.random() < .5 ? "#ffe066" : b.alarm, Math.max(1, Math.round(3 * Q.particle)), 44);
      // 计时器跳字（越危险跳得越快）
      if (n % (b.danger >= 3 ? 1 : (b.danger >= 2 ? 2 : 3)) === 0) {
        cnt = cnt <= 1 ? 9 : cnt - 1;
        try { b.num.textContent = (cnt < 10 ? "0" : "") + cnt; } catch (e) { }
        b.num.animate([{ opacity: 1, transform: "scale(1)" },
          { opacity: .45, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1)" }],
          { duration: bT(150) });
      }
      // 整颗炸弹轻微抖动（危险度越高抖得越明显）
      const amp = b.danger * .8;
      b.wrap.animate([
        { transform: "translate(-50%,-50%) rotate(0deg)" },
        { transform: "translate(-50%,-50%) rotate(" + (amp) + "deg)" },
        { transform: "translate(-50%,-50%) rotate(" + (-amp) + "deg)" },
        { transform: "translate(-50%,-50%) rotate(0deg)" },
      ], { duration: bT(180 + (4 - b.danger) * 60), easing: "ease-in-out" });
      // 光晕呼吸
      b.ring.animate([{ opacity: .30 + Math.sin(n * .9) * .22 }, { opacity: .62 }], { duration: bT(300) });
      // 隔一会儿来一圈扩散环
      if (n % 5 === 0) {
        b.ring.animate([{ transform: "scale(1)", opacity: .5 }, { transform: "scale(1.45)", opacity: 0 }],
          { duration: bT(560), fill: "forwards" });
      }
    }, bT(190));
  }

  // 滚动/窗口变化时跟着面板走
  bombOnResize = function () { placeBombBadge(); };
  window.addEventListener("scroll", bombOnResize, true);
  window.addEventListener("resize", bombOnResize);

  // ② 爆炸：白闪 → 火球 → 冲击环 → 火光柱 → 碎片 → 黑烟 → 焦痕
  //   ⚠️ 不做去重：爆炸来了就必须看到动画
  function timebombBlast(x, y, count) {
    

    const danger = Math.min(3, count || 1);
    const R = 130 + danger * 26;

    // 极短的白闪（爆炸的"第一瞬"）
    flash("#fff", bT(90));
    setTimeout(function () { flash("#ffb060", bT(130)); }, bT(70));

    // 火球（多层叠加）
    const ball = document.createElement("div");
    ball.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + R + "px;height:" + R +
      "px;margin-left:" + (-R / 2) + "px;margin-top:" + (-R / 2) + "px;border-radius:50%;pointer-events:none;" +
      "z-index:9998;background:radial-gradient(circle,#fff 0%,#fff3b0 18%,#ffb03c 40%,#ff5a10 62%,rgba(180,30,0,.65) 82%,rgba(0,0,0,0) 100%);" +
      "filter:blur(" + qb(2) + "px);";
    fxLayer.appendChild(ball);
    ball.animate([
      { transform: "scale(.05)", opacity: 1 },
      { transform: "scale(.55)", opacity: 1, offset: 0.14 },
      { transform: "scale(1.15)", opacity: 0.95, offset: 0.42 },
      { transform: "scale(1.5)", opacity: 0.5, offset: 0.7 },
      { transform: "scale(1.9)", opacity: 0 },
    ], { duration: bT(620), easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" })
      .onfinish = function () { ball.remove(); };

    // 冲击环（两圈，错开）
    setTimeout(function () {
      ring(x, y, "#fff", 18);
      shake("heavy");
    }, bT(30));
    setTimeout(function () {
      ring(x, y, "#ff9a3c", 30);
      ring(x, y, "#ffd166", 44);
    }, bT(140));

    // 火光柱（向上的橙光）
    const beam = document.createElement("div");
    const bw = 60 + danger * 14, bh = 280 + danger * 40;
    beam.style.cssText = "position:fixed;left:" + (x - bw / 2) + "px;top:" + (y - bh) + "px;width:" + bw +
      "px;height:" + bh + "px;pointer-events:none;z-index:9996;" +
      "background:linear-gradient(0deg, rgba(255,180,60,.85), rgba(255,90,0,.35) 45%, rgba(255,60,0,0));" +
      "filter:blur(" + qb(6) + "px);";
    fxLayer.appendChild(beam);
    beam.animate([{ opacity: 0, transform: "scaleY(.2)" },
      { opacity: .95, transform: "scaleY(1)", offset: .3 },
      { opacity: 0, transform: "scaleY(1.25)" }],
      { duration: bT(760), easing: "ease-out", fill: "forwards" })
      .onfinish = function () { beam.remove(); };

    // 碎片 + 火花
    bombSpark(x, y, "#fff3b0", 26, 260);
    bombSpark(x, y, "#ff8a3c", 22, 330);
    bombSpark(x, y, "#ffe9c0", 16, 400);
    burst(x, y, { count: 34, size: 13, speed: 470, life: 1500, colors: ["#fff", "#ffd166", "#ff6b35", "#8a3a10"] });

    // 金属外壳碎片（几块飞出去的）
    const shards = qc(9);
    for (let i = 0; i < shards; i++) {
      const s = document.createElement("div");
      const sz = 4 + Math.random() * 7;
      s.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + sz + "px;height:" + (sz * .7) +
        "px;background:linear-gradient(140deg,#7a7a88,#22222a);pointer-events:none;z-index:9998;" +
        "border-radius:1px;box-shadow:0 0 4px rgba(0,0,0,.9);";
      fxLayer.appendChild(s);
      const a = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const d = 160 + Math.random() * 280;
      const ox = Math.cos(a) * d, oy = Math.sin(a) * d;
      s.animate([
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: "translate(" + ox + "px," + oy + "px) rotate(" + (Math.random() * 720 - 360) + "deg)", opacity: 1, offset: .55 },
        { transform: "translate(" + (ox * 1.25) + "px," + (oy + 260) + "px) rotate(" + (Math.random() * 900 - 450) + "deg)", opacity: 0 },
      ], { duration: bT(1200 + Math.random() * 400), easing: "cubic-bezier(.2,.6,.5,1)", fill: "forwards" })
        .onfinish = function () { s.remove(); };
    }

    // 黑烟（慢、往上飘、扩散）
    const puffs = qc(14);
    for (let i = 0; i < puffs; i++) {
      setTimeout(function () {
        const p = document.createElement("div");
        const ps = 60 + Math.random() * 110;
        const px = x + (Math.random() - 0.5) * 200;
        const py = y + (Math.random() - 0.5) * 70;
        p.style.cssText = "position:fixed;left:" + px + "px;top:" + py + "px;width:" + ps + "px;height:" + ps +
          "px;margin-left:" + (-ps / 2) + "px;margin-top:" + (-ps / 2) + "px;border-radius:50%;pointer-events:none;" +
          "z-index:9995;background:radial-gradient(circle, rgba(60,56,52,.85) 0%, rgba(30,28,26,.55) 45%, rgba(0,0,0,0) 78%);" +
          "filter:blur(" + qb(7) + "px);";
        fxLayer.appendChild(p);
        p.animate([
          { transform: "scale(.35) translateY(0)", opacity: 0 },
          { transform: "scale(1) translateY(-40px)", opacity: .9, offset: .3 },
          { transform: "scale(1.6) translateY(-150px)", opacity: .45, offset: .65 },
          { transform: "scale(2.1) translateY(-260px)", opacity: 0 },
        ], { duration: bT(2000 + Math.random() * 900), easing: "ease-out", fill: "forwards" })
          .onfinish = function () { p.remove(); };
      }, bT(120 + i * 55));
    }

    // 地面焦痕（在目标位置留一下）
    const scorch = document.createElement("div");
    scorch.style.cssText = "position:fixed;left:" + x + "px;top:" + (y + 8) + "px;width:" + (R * 1.5) +
      "px;height:" + (R * .42) + "px;margin-left:" + (-R * .75) + "px;margin-top:" + (-R * .21) +
      "px;border-radius:50%;pointer-events:none;z-index:9994;" +
      "background:radial-gradient(ellipse, rgba(20,10,4,.72) 0%, rgba(30,14,6,.35) 45%, rgba(0,0,0,0) 75%);" +
      "filter:blur(" + qb(5) + "px);";
    fxLayer.appendChild(scorch);
    scorch.animate([{ opacity: 0 }, { opacity: .9, offset: .25 }, { opacity: .85, offset: .7 }, { opacity: 0 }],
      { duration: bT(2600), fill: "forwards" }).onfinish = function () { scorch.remove(); };
  }

  // ============================================================
  //  🥔 土豆地雷
  //    和定时炸弹同一套思路：徽章常驻在被埋那一方的面板上
  //      · 一颗带泥的土豆 + 顶上的金属引信 + 一闪一闪的红灯 + 露出的引线
  //      · 泥土慢慢往下掉（土屑粒子）
  //      · 红灯按节奏闪（提示"下回合你出牌就炸"）
  //    踩爆时：小范围爆炸 + 泥块四溅 + 冲击环 + 地上一圈坑
  // ============================================================
  let mineBadge = null;
  let mineTick = null;
  let mineOnResize = null;

  function makeMineBadge() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:9996;" +
      "transform:translate(-50%,-50%);";

    // 一小堆土（底座）
    const dirt = document.createElement("div");
    const DW = 150, DH = 46;
    dirt.style.cssText = "position:absolute;left:" + (-DW / 2) + "px;top:" + (18) + "px;width:" + DW +
      "px;height:" + DH + "px;border-radius:50%;" +
      "background:radial-gradient(ellipse at 45% 35%, #5a4630 0%, #3a2c1c 45%, #241a10 100%);" +
      "box-shadow:0 6px 14px rgba(0,0,0,.75), inset 0 -4px 10px rgba(0,0,0,.6);";
    wrap.appendChild(dirt);
    // 土堆上的小石子（让它不像一个纯椭圆）
    for (let i = 0; i < 7; i++) {
      const st = document.createElement("div");
      const ss = 3 + Math.random() * 5;
      st.style.cssText = "position:absolute;left:" + (Math.random() * DW - DW / 2) + "px;top:" +
        (14 + Math.random() * 18) + "px;width:" + ss + "px;height:" + (ss * .8) + "px;border-radius:40%;" +
        "background:rgba(120,100,74,.85);";
      wrap.appendChild(st);
    }

    // 土豆本体（不规则的椭圆 + 斑点）
    const potato = document.createElement("div");
    const PW = 76, PH = 58;
    potato.style.cssText = "position:absolute;left:" + (-PW / 2) + "px;top:" + (-PH / 2 + 6) + "px;width:" + PW +
      "px;height:" + PH + "px;border-radius:48% 52% 46% 54% / 55% 48% 52% 45%;" +
      "background:radial-gradient(ellipse at 34% 28%, #d9b57a 0%, #b58b52 26%, #8a6438 55%, #4e3620 100%);" +
      "box-shadow:inset -6px -8px 16px rgba(0,0,0,.55), inset 4px 5px 12px rgba(255,236,190,.28)," +
      "0 4px 12px rgba(0,0,0,.7);";
    wrap.appendChild(potato);
    // 土豆的"眼"（小凹点）
    const eyes = [[-18, -8], [10, -14], [-6, 8], [20, 6], [-24, 10], [16, -2]];
    for (const [ex, ey] of eyes) {
      const e = document.createElement("div");
      const es = 5 + Math.random() * 4;
      e.style.cssText = "position:absolute;left:" + (-PW / 2 + PW / 2 + ex) + "px;top:" + (-PH / 2 + 6 + PH / 2 + ey) +
        "px;width:" + es + "px;height:" + (es * .7) + "px;border-radius:50%;" +
        "background:rgba(60,40,22,.75);box-shadow:inset 1px 1px 2px rgba(0,0,0,.7);";
      wrap.appendChild(e);
    }

    // 金属引信（顶上那个盖子）
    const fuse = document.createElement("div");
    fuse.style.cssText = "position:absolute;left:-13px;top:" + (-PH / 2 - 8) + "px;width:26px;height:22px;" +
      "border-radius:5px 5px 3px 3px;background:linear-gradient(180deg,#e6e6ee,#9a9aa8 44%,#4a4a56 100%);" +
      "box-shadow:0 2px 5px rgba(0,0,0,.8), inset 0 1px 2px rgba(255,255,255,.5);";
    wrap.appendChild(fuse);

    // 引线（从盖子斜着伸出来）
    const wire = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wire.setAttribute("width", "62"); wire.setAttribute("height", "50");
    wire.style.cssText = "position:absolute;left:8px;top:" + (-PH / 2 - 46) + "px;overflow:visible;";
    const wp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    wp.setAttribute("d", "M6 44 C 14 22, 34 10, 56 16");
    wp.setAttribute("fill", "none");
    wp.setAttribute("stroke", "#c8a05a");
    wp.setAttribute("stroke-width", "3.5");
    wp.setAttribute("stroke-linecap", "round");
    wire.appendChild(wp);
    wrap.appendChild(wire);

    // 红灯（会闪）
    const led = document.createElement("div");
    led.style.cssText = "position:absolute;left:-6px;top:" + (-PH / 2 - 14) + "px;width:13px;height:13px;" +
      "border-radius:50%;background:radial-gradient(circle,#fff 0%,#ff8a8a 30%,#ff2020 62%,#8a0000 100%);" +
      "box-shadow:0 0 12px #ff2020,0 0 26px rgba(255,40,40,.7);";
    wrap.appendChild(led);

    // 危险提示字
    const tag = document.createElement("div");
    tag.textContent = "🥔 踩到就炸";
    tag.style.cssText = "position:absolute;left:-52px;top:" + (DH + 24) + "px;width:104px;text-align:center;" +
      "font-size:12px;font-weight:bold;color:#ffb060;text-shadow:0 0 8px rgba(0,0,0,.95),0 0 14px rgba(255,120,0,.6);";
    wrap.appendChild(tag);

    fxLayer.appendChild(wrap);
    return { wrap: wrap, potato: potato, led: led, dirt: dirt };
  }

  function placeMineBadge() {
    if (!mineBadge) return;
    const el = document.getElementById(mineBadge.panelId || "oppPanel") || document.getElementById("oppPanel");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width * 0.5;
    const y = Math.max(70, r.top - 52);
    mineBadge.pos = { x: x, y: y };
    mineBadge.wrap.style.left = x + "px";
    mineBadge.wrap.style.top = y + "px";
  }

  // 显示/更新地雷徽章（被埋那一方）
  function syncMine(info) {
    if (!info || !info.who) {
      if (mineBadge) {
        const b = mineBadge;
        mineBadge = null;
        if (mineTick) { clearInterval(mineTick); mineTick = null; }
        if (mineOnResize) {
          window.removeEventListener("scroll", mineOnResize, true);
          window.removeEventListener("resize", mineOnResize);
          mineOnResize = null;
        }
        try {
          b.wrap.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%,-50%) scale(.8)" }],
            { duration: 240, fill: "forwards" }).onfinish = function () { b.wrap.remove(); };
        } catch (e) { try { b.wrap.remove(); } catch (e2) { } }
      }
      return;
    }
    const panelId = info.who === "me" ? "mePanel" : "oppPanel";
    if (mineBadge && mineBadge.panelId === panelId) { placeMineBadge(); return; }
    if (mineBadge) syncMine(null);

    const b = makeMineBadge();
    b.panelId = panelId;
    b.pos = { x: 0, y: 0 };
    mineBadge = b;
    placeMineBadge();

    // 埋进去的入场：从下面"钻"出来 + 土扬起
    b.wrap.animate([
      { opacity: 0, transform: "translate(-50%,-50%) translateY(28px) scale(.7)" },
      { opacity: 1, transform: "translate(-50%,-50%) translateY(-6px) scale(1.08)", offset: .68 },
      { opacity: 1, transform: "translate(-50%,-50%) translateY(0) scale(1)" },
    ], { duration: bT(460), easing: "cubic-bezier(.3,1.5,.5,1)", fill: "forwards" })
      .onfinish = function () { try { b.wrap.style.transform = "translate(-50%,-50%)"; } catch (e) { } };

    // 入场时扬一把土
    setTimeout(function () {
      if (!mineBadge || mineBadge !== b) return;
      mineDirtBurst(b.pos.x, b.pos.y + 26, 14, 130);
      shake("light");
      ring(b.pos.x, b.pos.y + 30, "#8a6a3a", 10);
    }, bT(400));

    // 常驻：红灯闪 + 土屑掉 + 轻微抖动
    let n = 0;
    mineTick = setInterval(function () {
      if (!mineBadge || mineBadge !== b) return;
      n++;
      // 红灯两下快闪，停一下（像真雷的指示灯）
      const phase = n % 6;
      if (phase < 2) {
        b.led.animate([{ opacity: 1, transform: "scale(1.25)" }, { opacity: .25, transform: "scale(.85)" }],
          { duration: bT(150) });
      }
      // 土屑往下掉
      if (n % 3 === 0) mineDirtBurst(b.pos.x, b.pos.y + 22, 2, 40, true);
      // 土豆轻微"呼吸"（像里面有东西在动）
      b.potato.animate([
        { transform: "scale(1) rotate(0deg)" },
        { transform: "scale(1.04) rotate(-1.5deg)", offset: .5 },
        { transform: "scale(1) rotate(0deg)" },
      ], { duration: bT(900), easing: "ease-in-out" });
    }, bT(230));
  }

  // 泥土粒子（往上扬 or 往下掉）
  function mineDirtBurst(x, y, n, spd, falling) {
    const c = qc(n);
    for (let i = 0; i < c; i++) {
      const s = document.createElement("div");
      const sz = 2 + Math.random() * 4;
      s.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + sz + "px;height:" +
        (sz * .85) + "px;border-radius:35%;background:" +
        (Math.random() < .5 ? "#6a5236" : "#4a3822") + ";pointer-events:none;z-index:9997;";
      fxLayer.appendChild(s);
      const a = falling ? (Math.PI / 2 + (Math.random() - .5) * .8) : (-Math.PI / 2 + (Math.random() - .5) * 2.2);
      const d = spd * (.4 + Math.random() * .8) * (falling ? .5 : 1);
      const ox = Math.cos(a) * d, oy = Math.sin(a) * d;
      s.animate([
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: "translate(" + ox + "px," + oy + "px) rotate(" + (Math.random() * 240 - 120) + "deg)", opacity: 1, offset: .6 },
        { transform: "translate(" + (ox * 1.1) + "px," + (oy + (falling ? 60 : 90)) + "px) rotate(" + (Math.random() * 360) + "deg)", opacity: 0 },
      ], { duration: bT(falling ? 700 : 900 + Math.random() * 400), easing: "cubic-bezier(.3,.6,.5,1)", fill: "forwards" })
        .onfinish = function () { s.remove(); };
    }
  }

  mineOnResize = function () { placeMineBadge(); };
  window.addEventListener("scroll", mineOnResize, true);
  window.addEventListener("resize", mineOnResize);

  // 踩爆：小范围爆炸 + 泥块四溅 + 冲击环 + 地上一圈坑
  function mineBlast(x, y) {
    // 白闪 + 橙闪（比定时炸弹短、小）
    flash("#fff", bT(70));
    setTimeout(function () { flash("#ffb060", bT(100)); }, bT(50));

    // 火球（小）
    const R = 110;
    const ball = document.createElement("div");
    ball.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + R + "px;height:" + R +
      "px;margin-left:" + (-R / 2) + "px;margin-top:" + (-R / 2) + "px;border-radius:50%;pointer-events:none;" +
      "z-index:9998;background:radial-gradient(circle,#fff 0%,#fff0b0 20%,#ffa63c 44%,#ff5a10 66%,rgba(160,60,0,.5) 84%,rgba(0,0,0,0) 100%);" +
      "filter:blur(" + qb(2) + "px);";
    fxLayer.appendChild(ball);
    ball.animate([
      { transform: "scale(.08)", opacity: 1 },
      { transform: "scale(.6)", opacity: 1, offset: .16 },
      { transform: "scale(1.2)", opacity: .95, offset: .45 },
      { transform: "scale(1.7)", opacity: 0 },
    ], { duration: bT(460), easing: "cubic-bezier(.1,.85,.3,1)", fill: "forwards" })
      .onfinish = function () { ball.remove(); };

    // 冲击环
    setTimeout(function () { ring(x, y, "#fff", 14); shake("mid"); }, bT(20));
    setTimeout(function () { ring(x, y + 10, "#c8a05a", 26); }, bT(110));

    // 泥块四溅（往上 + 往外，然后落下）
    mineDirtBurst(x, y + 10, 26, 240);
    // 火花
    bombSpark(x, y, "#ffe066", 14, 200);
    bombSpark(x, y, "#ff8a3c", 12, 260);
    burst(x, y, { count: 20, size: 10, speed: 330, life: 1100, colors: ["#fff", "#ffd166", "#8a6a3a", "#5a4630"] });

    // 地上一圈坑（焦痕 + 坑）
    const pit = document.createElement("div");
    const PW = 150, PH = 46;
    pit.style.cssText = "position:fixed;left:" + x + "px;top:" + (y + 14) + "px;width:" + PW + "px;height:" + PH +
      "px;margin-left:" + (-PW / 2) + "px;margin-top:" + (-PH / 2) + "px;border-radius:50%;pointer-events:none;" +
      "z-index:9995;background:radial-gradient(ellipse, rgba(14,8,4,.85) 0%, rgba(40,26,14,.6) 40%, rgba(90,70,48,.35) 62%, rgba(0,0,0,0) 82%);" +
      "filter:blur(" + qb(3) + "px);";
    fxLayer.appendChild(pit);
    pit.animate([{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "scale(1)", offset: .2 },
      { opacity: .8, offset: .65 }, { opacity: 0 }],
      { duration: bT(2400), fill: "forwards" }).onfinish = function () { pit.remove(); };
  }

  // 🥔 demo 页用：点一下轮换"埋雷 / 踩爆"
  let _mineStep = -1;

  function simpleFx(name, opts) {
    opts = opts || {};
    const x = opts.x !== undefined ? opts.x : (window.innerWidth / 2);
    const y = opts.y !== undefined ? opts.y : (window.innerHeight * 0.35);

    // 🔴 大演出直接转发给各自的函数（它们会自己播"关键时刻"的声音）
    switch (name) {
      case "punch": punch(x, y, opts.speed || 1); return;
      case "lightning": lightning(x, y, opts.speed || 1); return;
      case "doom": doom(x, y, opts.speed || 1); return;
      case "meteor": meteorFx(x, y); return;
      case "summon": summonFx(x, y, opts.name || (opts.card ? opts.card.name : ""), opts.speed || 1, opts.onLand); return;
      // 💣 定时炸弹（新实现）
      //    timebomb-badge：把炸弹徽章挂到对方面板上（常驻，会一直跳字）
      //    timebomb-blast：爆炸
      case "timebomb-badge": syncBomb({ who: "opp", danger: opts.count || 1 }); return;
      // 🥔 土豆地雷
      case "mine-badge": syncMine({ who: "opp" }); return;
      case "mine-blast": syncMine(null); mineBlast(x, y); return;
      // 🥔 demo 页用：点一下轮换"埋雷 / 踩爆"
      case "mine": {
        _mineStep = (_mineStep + 1) % 2;
        if (_mineStep === 0) { syncMine({ who: "opp" }); return; }
        syncMine(null);
        mineBlast(x, y); return;
      }
      case "timebomb-blast": timebombBlast(x, y, opts.count || 1); return;
      // 💣 demo 页用：点一下轮换"挂徽章 / 爆一下"
  let _tbStep = -1;
      case "timebomb": {
        _tbStep = (_tbStep + 1) % 2;
        if (_tbStep === 0) { syncBomb({ who: "opp", danger: opts.count || 1 }); return; }
        syncBomb(null);
        timebombBlast(x, y, opts.count || 2); return;
      }
    }

    switch (name) {
      case "hit-light":
        burst(x, y, { count: 14, size: 9, speed: 240, life: 750, colors: ["#fff", "#ffd166"] });
        shake("light"); return;
      case "hit-mid":
        flash("#fff", 200);
        burst(x, y, { count: 22, size: 12, speed: 340, life: 950, colors: ["#fff", "#ffd166", "#ff8c42"] });
        ring(x, y, "#ffd166", 10);
        shake("mid"); return;
      case "hit-big":
        flash("#fff", 300);
        burst(x, y, { count: 34, size: 16, speed: 480, life: 1300, colors: ["#fff", "#ffd166", "#ff6b35", "#ff2d00"] });
        ring(x, y, "#fff", 16);
        shake("heavy"); return;
      case "block":
        flash("#cfe8ff", 220);
        burst(x, y, { count: 18, size: 10, speed: 250, life: 950, colors: ["#cfe8ff", "#7fd4ff", "#fff"], square: true });
        ring(x, y, "#7fd4ff", 9);
        shake("light"); return;
      case "heal":
        for (let i = 0; i < 3; i++) {
          setTimeout(function () {
            burst(x + (Math.random() - 0.5) * 100, y + (Math.random() - 0.5) * 70, {
              count: 11, size: 11, speed: 140, life: 1400, colors: ["#8cff9e", "#c9ffd2", "#fff"],
            });
          }, i * 110);
        }
        ring(x, y, "#8cff9e", 11); return;
      case "buff":
        for (let i = 0; i < 20; i++) {
          setTimeout(function () {
            burst(x + (Math.random() - 0.5) * 240, y + (Math.random() - 0.5) * 140, {
              count: 4, size: 9, speed: 100, life: 1300, colors: ["#ffe27a", "#fff6c4", "#ffd700"],
            });
          }, i * 45);
        }
        ring(x, y, "#ffd700", 12); return;
      case "debuff":
        flash("#7b3fd4", 260);
        burst(x, y, { count: 26, size: 13, speed: 320, life: 1400, colors: ["#a55cff", "#7b3fd4", "#3a1060"] });
        shake("mid"); return;
      case "dark":
        flash("#2a0020", 400);
        setTimeout(function () { flash("#000", 500); }, 120);
        burst(x, y, { count: 36, size: 17, speed: 400, life: 1600, colors: ["#7b2fd4", "#3a0060", "#000", "#ff2d00"] });
        shake("heavy"); return;
      case "slash": slashFx(x, y, "#ffffff"); return;
      case "snowball": snowFx(x, y); return;
      case "blood": bloodFx(x, y); return;
      case "poison": poisonFx(x, y, opts.speed || 1); return;
      case "burning": burningFx(x, y); return;
      case "quake": quakeFx(x, y, opts.speed || 1); return;
      case "nuke": nukeFx(x, y, opts.speed || 1); return;
      case "execute": executeFx(x, y, opts.speed || 1); return;
      case "blackhole": blackholeFx(x, y, opts.speed || 1); return;
      case "acid": acidFx(x, y); return;
      case "guillotine": guillotineFx(x, y); return;
      case "snipe": snipeFx(x, y); return;
      case "selfharm":
        flash("#ff2b2b", 300);
        burst(x, y, { count: 28, size: 13, speed: 340, life: 1300, colors: ["#ff2b2b", "#8a0000", "#fff"] });
        shake("heavy"); return;
      case "convert":
        ring(x, y, "#7fd", 10);
        burst(x, y, { count: 22, size: 11, speed: 280, life: 1200, colors: ["#7fd", "#fff", "#2d6cdf"] }); return;
      case "lucky":
        flash("#fff6c4", 260);
        for (let i = 0; i < qc(26); i++) {
          setTimeout(function () {
            burst(x + (Math.random() - 0.5) * 280, y + (Math.random() - 0.5) * 180, {
              count: 4, size: 10, speed: 130, life: 1500, colors: ["#ffe27a", "#fff6c4", "#fff"],
            });
          }, i * 40);
        }
        ring(x, y, "#ffd700", 14); return;
      case "charge":
        for (let i = 0; i < 4; i++) setTimeout(function () { ring(x, y, "#ffd166", 6 + i * 3); }, i * 120);
        shake("light"); return;
      case "thorns":
        ring(x, y, "#ff6b6b", 12);
        burst(x, y, { count: 28, size: 12, speed: 360, life: 1200, colors: ["#ff6b6b", "#ff3b3b", "#fff"], square: true });
        shake("mid"); return;
      case "shield":
        flash("#cfe8ff", 200);
        for (let i = 0; i < 3; i++) setTimeout(function () { ring(x, y, "#7fd4ff", 8 + i * 5); }, i * 140);
        burst(x, y, { count: 22, size: 10, speed: 210, life: 1200, colors: ["#cfe8ff", "#7fd4ff", "#fff"] }); return;
      case "musicbox": musicboxFx(x, y, opts.speed || 1); return;
      case "summon": summonFx(x, y, opts.name || (opts.card ? opts.card.name : ""), opts.speed || 1, opts.onLand); return;
      case "draw":
        for (let i = 0; i < 16; i++) {
          setTimeout(function () {
            burst(x + (Math.random() - 0.5) * 220, y - 50 + Math.random() * 90, {
              count: 3, size: 9, speed: 140, life: 1000, colors: ["#7fd", "#cfe8ff", "#fff"],
            });
          }, i * 45);
        }
        ring(x, y, "#7fd", 9); return;
      case "peek":
        flash("#cfe8ff", 180);
        ring(x, y, "#7fd4ff", 7); return;
      case "multi":
        for (let i = 0; i < 3; i++) {
          setTimeout(function () {
            flash("#fff", 130);
            burst(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 70, {
              count: 13, size: 10, speed: 280, life: 750, colors: ["#fff", "#ffd166", "#ff6b35"],
            });
            shake("mid");
          }, i * 170);
        }
        return;
      default:
        flash("#fff", 180);
        burst(x, y, { count: 16, size: 10, speed: 240, life: 850, colors: ["#fff", "#ffd166"] });
    }
  }

  // 播放一张牌的演出（画面；声音由各演出在"关键时刻"自己播）
  function playCardFx(cardName, opts) {
    opts = opts || {};
    const card = opts.card || null;
    const kind = CARD_FX[cardName] || autoFxForCard(card);
    const sound = CARD_SFX[cardName] ||
      (card && card.kind === "attack" ? "punch" : "") ||
      (card && card.kind === "heal" ? "heal" : "") ||
      (card && card.kind === "block" ? "block" : "") ||
      "buff";
    const pos = opts.pos || {};
    const x = pos.x !== undefined ? pos.x : window.innerWidth / 2;
    const y = pos.y !== undefined ? pos.y : window.innerHeight * 0.34;
    // 同时返回"该配什么声音"，让调用方可以自己决定什么时候播
    return { kind: kind, sound: sound, x: x, y: y, name: cardName, card: card };
  }

  // 播一个演出，并在"关键时刻"播声音（不同演出时机不同）
  function castFx(cardName, opts) {
    const info = playCardFx(cardName, opts);
    // 有独立时机音效的演出 → 让它们自己播
    const selfSound = {
      punch: 1, lightning: 1, doom: 1, snipe: 1,
    };
    if (!selfSound[info.kind] && info.sound) sfx(info.sound);
    simpleFx(info.kind, { x: info.x, y: info.y, card: info.card, name: info.name, onLand: opts.onLand, speed: opts.speed });
    return info;
  }

  // 陨石落地：飞行 + 砸地，声音和画面严格对齐
  //   speed 可以调（默认 1）；飞行时长固定 900 毫秒（会按 speed 缩放）
  function meteorFx(x, y, speed) {
    const sp = speed || 1;
    const FLY = 900;                    // 飞行时长（毫秒，未缩放）
    const T = (ms) => ms / sp;
    // 🎵 飞行声：时长和画面同步（都按 sp 缩放）
    sfxFall(FLY / sp);
    // 画面：陨石本体从左上角烧下来
    const meteor = document.createElement("div");
    meteor.textContent = "☄️";
    meteor.style.cssText = "position:fixed;left:0;top:0;font-size:110px;pointer-events:none;z-index:9997;" +
      "filter:drop-shadow(0 0 30px #ff8c00) drop-shadow(0 0 80px #ff2d00);";
    fxLayer.appendChild(meteor);
    const sx = -150, sy = -150;
    meteor.animate(
      [
        { transform: "translate(" + sx + "px," + sy + "px) scale(.5) rotate(-20deg)", opacity: 0 },
        { transform: "translate(" + (sx + 70) + "px," + (sy + 50) + "px) scale(.9) rotate(-10deg)", opacity: 1, offset: 0.12 },
        { transform: "translate(" + (x - 40) + "px," + (y - 40) + "px) scale(1.25) rotate(10deg)", opacity: 1, offset: 0.92 },
        { transform: "translate(" + x + "px," + y + "px) scale(1.6) rotate(20deg)", opacity: 1 },
      ],
      { duration: FLY, easing: "cubic-bezier(.5,0,.85,.35)", fill: "forwards" }
    );
    let n = 0;
    const tm = setInterval(function () {
      const r = meteor.getBoundingClientRect();
      burst(r.left + 55, r.top + 55, { count: 5, size: 14, speed: 150, life: 800,
        colors: ["#ffd166", "#ff6b35", "#ff2d00", "#8a2b00"] });
      if (++n > 20) clearInterval(tm);
    }, 46);

    // 💥 砸地（画面 + 声音严格同时）
    setTimeout(function () {
      clearInterval(tm);
      if (meteor.parentNode) meteor.remove();
      sfxSlam();                       // 🔊 砸地的声音（就在这一瞬间）
      flash("#fff5e0", 420);
      setTimeout(function () { flash("#ff2b00", 700); }, 120);
      ring(x, y, "#fff", 40);
      setTimeout(function () { ring(x, y, "#ffd166", 30); }, 80);
      setTimeout(function () { ring(x, y, "rgba(255,60,0,.75)", 55); }, 170);
      setTimeout(function () { ring(x, y, "rgba(120,0,0,.6)", 72); }, 280);
      burst(x, y, { count: 50, size: 18, speed: 620, life: 1400, colors: ["#fff", "#ffd166", "#ff6b35", "#ff2d00"] });
      setTimeout(function () {
        burst(x, y, { count: 34, size: 24, speed: 420, life: 1800, colors: ["#ff8c42", "#8a2b00", "#3a1000"], square: true });
      }, 90);
      setTimeout(function () {
        burst(x, y, { count: 40, size: 34, speed: 260, life: 2200,
          colors: ["rgba(80,20,0,.7)", "rgba(140,60,20,.6)", "rgba(40,10,0,.7)"] });
      }, 200);
      shake("quake");
      setTimeout(function () { shake("quake"); }, 260);
      setTimeout(function () { shake("heavy"); }, 620);
      crackApart(x, y, T);
      groundFire(x, y, T, 1);
      smokePlume(x, y, T);
      heatHaze(x, y, T);
      for (let i = 0; i < 7; i++) {
        setTimeout(function () {
          const ox = x + (Math.random() - 0.5) * 260;
          const oy = y + (Math.random() - 0.5) * 120 + 40;
          burst(ox, oy, { count: 10, size: 9, speed: 220, life: 700, colors: ["#ffd166", "#ff6b35", "#ff2d00"] });
          ring(ox, oy, "rgba(255,140,0,.7)", 5);
          if (i % 3 === 0) shake("light");
        }, 700 + i * 220);
      }
    }, FLY);        // ⚠️ 用 FLY（跟动画时长同一个值），不再写死 900
  }

  // ============================================================
  // 角色死亡：把他的那个"框"切成两半
  //   做法：克隆两份自己，上半用 clip-path 只露上面、下半只露下面，
  //         然后把两块分别往上/往下滑开，切口喷血
  //   panelId：要切哪个框（"oppPanel" / "mePanel"）
  // ============================================================
  function splitPanel(panelId, opts) {
    opts = opts || {};
    const sp = opts.speed || 1;
    const T = (ms) => ms / sp;
    const el = document.getElementById(panelId);
    if (!el || !el.parentNode) return false;

    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    const page = el.parentNode || document.body;
    const cutY = r.top + r.height / 2;              // 切在框的正中间
    const oldVis = el.style.visibility;             // 记下原来的显示状态，收尾要还回去

    // 兜底：万一中途出错，也要把原框放回来（不然框会永久消失）
    let restored = false;
    function restoreEl() {
      if (restored) return;
      restored = true;
      try { el.style.visibility = oldVis; } catch (e) { }
    }

    // ---------- ① 白色刀光从框上扫过 ----------
    const seam = document.createElement("div");
    seam.style.cssText = "position:fixed;left:" + (r.left - 30) + "px;top:" + (cutY - 2) + "px;" +
      "width:" + (r.width + 60) + "px;height:4px;pointer-events:none;z-index:10001;" +
      "transform:scaleX(0);transform-origin:left center;" +
      "background:linear-gradient(90deg,transparent,#fff 10%,#fff 90%,transparent);" +
      "box-shadow:0 0 10px #fff,0 0 36px #ff2d2d,0 0 80px #ff0000;";
    fxLayer.appendChild(seam);
    seam.animate(
      [{ transform: "scaleX(0)", opacity: 0 },
       { transform: "scaleX(1)", opacity: 1, offset: 0.4 },
       { transform: "scaleX(1.02)", opacity: 1, offset: 0.7 },
       { transform: "scaleX(1.02)", opacity: 0 }],
      { duration: T(340), easing: "cubic-bezier(.1,.9,.2,1)", fill: "forwards" }
    ).onfinish = function () { seam.remove(); };
    sfx("slash");
    shake("heavy");
    flash("#fff", T(120));

    // ---------- ② 切开：上下两块滑开 ----------
    let wrapRef = null;
    setTimeout(function () {
      try {
        const rect = el.getBoundingClientRect();       // 重新量
        const wrap = document.createElement("div");
        wrapRef = wrap;
        wrap.style.cssText = "position:fixed;left:" + rect.left + "px;top:" + rect.top + "px;" +
          "width:" + rect.width + "px;height:" + rect.height + "px;pointer-events:none;z-index:9990;";

        const common = "position:absolute;left:0;top:0;width:" + rect.width + "px;height:" + rect.height + "px;" +
          "margin:0;pointer-events:none;will-change:transform;";
        const top = el.cloneNode(true);
        const bot = el.cloneNode(true);
        top.style.cssText = common + "clip-path:inset(0 0 50% 0);";     // 只露上半
        bot.style.cssText = common + "clip-path:inset(50% 0 0 0);";     // 只露下半

        // ⚠️ 关键：先把原框藏起来，否则"原框还在显示"，看起来就像没切开
        el.style.visibility = "hidden";

        wrap.appendChild(top);
        wrap.appendChild(bot);
        page.appendChild(wrap);

        // 上半往上滑、下半往下滑（各带一点旋转，像真的断开）
        const off = Math.max(18, rect.height * 0.3);
        top.animate(
          [{ transform: "translateY(0) rotate(0deg)" },
           { transform: "translateY(-" + off + "px) rotate(-" + (1.5 + Math.random()) + "deg)" }],
          { duration: T(700), easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" }
        );
        bot.animate(
          [{ transform: "translateY(0) rotate(0deg)" },
           { transform: "translateY(" + off + "px) rotate(" + (1.5 + Math.random()) + "deg)" }],
          { duration: T(700), easing: "cubic-bezier(.2,.9,.2,1)", fill: "forwards" }
        );

        // 切口喷血
        setTimeout(function () {
          for (let i = 0; i < qc(30); i++) {
            burst(rect.left + Math.random() * rect.width, cutY + (Math.random() - 0.5) * 12, {
              count: 4, size: 12, speed: 240, life: 1500,
              colors: ["#c1001a", "#8a0012", "#ff2b2b", "#5a0008"],
            });
          }
          flash("#8a0012", T(220));
          shake("quake");
        }, T(50));

        // 两块淡出，恢复原框
        setTimeout(function () {
          top.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T(420), fill: "forwards" });
          bot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T(420), fill: "forwards" });
          setTimeout(function () {
            if (wrapRef && wrapRef.parentNode) wrapRef.remove();
            restoreEl();                       // 把原框放回来
          }, T(450));
        }, T(1300));
      } catch (e) {
        // 出错也要把原框放回来、把残留的容器清掉
        if (wrapRef && wrapRef.parentNode) wrapRef.remove();
        restoreEl();
      }
    }, T(200));

    return true;
  }

  // ---------- 对外接口 ----------
  window.FX = {
    shake, flash, burst, ring, bigText,
    punch, impact, drawBolt, lightning,
    doom, doomImpact, crackApart, groundFire, smokePlume, heatHaze, meteorFx,
    setStatus, clearStatusLayer, setPanelFx, splitPanel,
    quality: Q,
    syncUnits, clearUnits, buildUnitArt,
    PANEL_STATUS_CLASS, PANEL_STATUS_EDGE,
    playCardFx, castFx, simpleFx, CARD_FX, CARD_SFX,
    syncBomb, timebombBlast,
    syncMine, mineBlast,
    sfx, unlockAudio, playNamed, setVolume, getVolume, preloadFiles,
    sfxFall, sfxSlam,
    getAudioState: function () { return audioCtx ? audioCtx.state : "none"; },
    audio: { unlock: unlockAudio, state: function () { return audioCtx ? audioCtx.state : "none"; }, flush: flushAudioWaiters },
  };
})();
