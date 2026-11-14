'use strict';
/*
 * 多声道 → 立体声空间化核心。
 *
 * 目标：用已解码的多声道 PCM 近似「耳机上的多声道听感」—— 头外化、正前声场、
 * 前后纵深、可控侧向宽度、稳定的中置人声。不是 Dolby 解码器，不做个性化 HRTF
 * 卷积，也不声称等价于任何认证渲染器。
 *
 * 结构（每声道，逐样本）：
 *   ring ─┬─ direct tap L ─→ LP4 拆分 ─→ 低频×gL + 头影(高频)×gL ─┐
 *         ├─ direct tap R ─→ LP4 拆分 ─→ 低频×gR + 头影(高频)×gR ─┤
 *         └─ 3×反射 tap（各自方位/延迟/增益）→ 反射总线 ──────────┴→ L/R
 *   反射总线：HPF(去浑浊) → 阻尼 LPF → 2 级 allpass(密度) → 自适应增益
 *
 * 关键取巧：低频用「减法式分频」（high = tap - LP4(tap)），低频与高频逐样本
 * 精确相加还原原信号，所以串扰点没有相位坑；低频不吃头影/反射，保 punch。
 *
 * 纯算术：不碰 DOM / 定时器 / 分配（缓冲区在 configure 时一次备好）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SpatialCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var MAX_CHANNELS = 12;
  var MAX_BLOCK = 2048;
  // 所有抽头统一垫 4 个样本，保证 5 点插值总能拿到 ip-2 的历史
  var TAP_PAD = 4;
  // 近耳侧向增益用的一阶频点（约 1.5kHz）
  var PRES_K = 0.192;
  // 输出级的双耳高频补偿：双耳化必然会丢掉一部分远耳高频（物理上真实），
  // 不补的话整体比标准下混暗 1~2dB（实测 8–16kHz −1.7dB，听感就是"闷"）。
  // 这是标定量，不是音染口味：一阶搁架，6kHz 以上 +1.2dB。
  var AIR_K = 0.573;
  var AIR_GAIN = 0.155;

  // 头模型
  var HEAD_RADIUS_M = 0.0875;
  var SPEED_OF_SOUND = 343.0;

  // 声道角色：az 方位角（0 = 正前，正值向右），el 仰角（正值向上）
  var ROLE = {
    L:    { az: -30,  el: 0,  kind: 'front' },
    R:    { az:  30,  el: 0,  kind: 'front' },
    C:    { az:   0,  el: 0,  kind: 'center' },
    LFE:  { az:   0,  el: 0,  kind: 'lfe' },
    Lb:   { az: -135, el: 0,  kind: 'rear' },
    Rb:   { az:  135, el: 0,  kind: 'rear' },
    Ls:   { az: -90,  el: 0,  kind: 'side' },
    Rs:   { az:  90,  el: 0,  kind: 'side' },
    Cs:   { az:  180, el: 0,  kind: 'rear' },
    Tfl:  { az: -30,  el: 45, kind: 'height' },
    Tfr:  { az:  30,  el: 45, kind: 'height' },
    Tfc:  { az:   0,  el: 45, kind: 'height' },
    Tbl:  { az: -135, el: 45, kind: 'height' },
    Tbr:  { az:  135, el: 45, kind: 'height' },
    Tsl:  { az: -90,  el: 45, kind: 'height' },
    Tsr:  { az:  90,  el: 45, kind: 'height' },
  };

  // 声道顺序按 ffmpeg 的 channel_layout 定义（解码侧用 aformat 强制成这些布局）
  var LAYOUTS = {
    '1.0':        ['C'],
    'mono':       ['C'],
    '2.0':        ['L', 'R'],
    'stereo':     ['L', 'R'],
    '2.1':        ['L', 'R', 'LFE'],
    '3.0':        ['L', 'R', 'C'],
    '3.0(back)':  ['L', 'R', 'Cs'],
    '4.0':        ['L', 'R', 'Lb', 'Rb'],
    'quad':       ['L', 'R', 'Lb', 'Rb'],
    '5.0':        ['L', 'R', 'C', 'Lb', 'Rb'],
    '5.0(side)':  ['L', 'R', 'C', 'Ls', 'Rs'],
    '5.1':        ['L', 'R', 'C', 'LFE', 'Lb', 'Rb'],
    '5.1(side)':  ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'],
    '6.0':        ['L', 'R', 'C', 'Lb', 'Rb', 'Cs'],
    '6.0(front)': ['L', 'R', 'C', 'Ls', 'Rs', 'Cs'],
    '6.1':        ['L', 'R', 'C', 'LFE', 'Cs', 'Ls', 'Rs'],
    '7.0':        ['L', 'R', 'C', 'Lb', 'Rb', 'Ls', 'Rs'],
    '7.1':        ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Ls', 'Rs'],
    '7.1(wide)':  ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Tfl', 'Tfr'],
    '5.1.2':      ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Tfl', 'Tfr'],
    '5.1.4':      ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Tfl', 'Tfr', 'Tbl', 'Tbr'],
    '7.1.2':      ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Ls', 'Rs', 'Tfl', 'Tfr'],
    '7.1.4':      ['L', 'R', 'C', 'LFE', 'Lb', 'Rb', 'Ls', 'Rs', 'Tfl', 'Tfr', 'Tbl', 'Tbr'],
  };

  // 只按声道数兜底（拿不到 / 不认识布局时）
  var BY_COUNT = {
    1: LAYOUTS['1.0'],
    2: LAYOUTS['2.0'],
    3: LAYOUTS['3.0'],
    4: LAYOUTS['4.0'],
    5: LAYOUTS['5.0'],
    6: LAYOUTS['5.1'],
    7: LAYOUTS['6.1'],
    8: LAYOUTS['7.1'],
    10: LAYOUTS['7.1.2'],
    12: LAYOUTS['7.1.4'],
  };

  var DEFAULTS = {
    enabled: true,
    // 0..1：整体效果量（反射 / 扩散 / 侧向张力的总闸），不动 ITD
    intensity: 0.5,
    // 0..1：头外化强度（反射能量占比 + 距离模型的空气吸收）
    externalization: 0.45,
    // 0.5..1.5：侧向坐标缩放倍率（1.0 = 原始布局；只放大侧向分量，不改前后）
    width: 1.2,
    // 0..1：纵深（反射电平 + 高频空气吸收）
    depth: 0.45,
    // 0..1：虚拟房间尺寸（反射延迟 3.5ms → 30ms）
    room: 0.4,
    // 0..1：房间尾音（短混响，−20dB 量级；0 = 完全干）
    tail: 0.6,
    // 0..1：早期反射量。默认档约 −17dB（支撑性反射）；
    // 早先给到 −11dB，对着干下混听就是"糊上一层"，是"开了不如不开"的主因之一。
    reflections: 0.62,
    // LFE 折叠电平（线性）
    lfe: 0.5,
    // 输出补偿（离线标定得出，见 scripts/bench/spatial_bench.js）
    trim: 1.0,
  };

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function normLayoutKey(name) {
    return String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, '');
  }

  // 未知道道数：按前后顺序确定性铺开，不假装知道语义
  function genericRoles(n) {
    if (n <= 0) return [];
    if (n === 1) return ['C'];
    if (n === 2) return ['L', 'R'];
    var roles = ['L', 'R', 'C'];
    var rest = n - 3;
    var ring = ['Lb', 'Rb', 'Ls', 'Rs', 'Cs', 'Tfl', 'Tfr', 'Tbl', 'Tbr'];
    for (var i = 0; i < rest && i < ring.length; i++) roles.push(ring[i]);
    while (roles.length < n) roles.push('C');
    return roles;
  }

  function resolveRoles(layoutName, channels) {
    var key = normLayoutKey(layoutName);
    var roles = key && LAYOUTS[key] ? LAYOUTS[key].slice() : null;
    if (roles && roles.length !== channels) roles = null;
    if (!roles && BY_COUNT[channels]) roles = BY_COUNT[channels].slice();
    if (!roles) roles = genericRoles(channels);
    if (roles.length > channels) roles = roles.slice(0, channels);
    return roles;
  }

  function layoutNameOf(roles) {
    for (var k in LAYOUTS) {
      if (!Object.prototype.hasOwnProperty.call(LAYOUTS, k)) continue;
      var a = LAYOUTS[k];
      if (a.length !== roles.length) continue;
      var same = true;
      for (var i = 0; i < a.length; i++) if (a[i] !== roles[i]) { same = false; break; }
      if (same) return k;
    }
    return 'generic';
  }

  // ---------------------------------------------------------------- 基础单元

  function Biquad() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }

  Biquad.prototype.setLowPass = function (f, fs, Q) {
    Q = Math.max(0.1, Q);
    var w0 = 2 * Math.PI * f / fs, c = Math.cos(w0), s = Math.sin(w0);
    var a = s / (2 * Q), a0 = 1 + a;
    this.b0 = ((1 - c) * 0.5) / a0; this.b1 = (1 - c) / a0; this.b2 = ((1 - c) * 0.5) / a0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  };

  Biquad.prototype.setHighPass = function (f, fs, Q) {
    Q = Math.max(0.1, Q);
    var w0 = 2 * Math.PI * f / fs, c = Math.cos(w0), s = Math.sin(w0);
    var a = s / (2 * Q), a0 = 1 + a;
    this.b0 = ((1 + c) * 0.5) / a0; this.b1 = -(1 + c) / a0; this.b2 = ((1 + c) * 0.5) / a0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  };

  Biquad.prototype.process = function (x) {
    var y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  };

  Biquad.prototype.reset = function () { this.z1 = 0; this.z2 = 0; };

  // Linkwitz-Riley 4 阶（两级同 Q Butterworth 级联），经典分频器
  function LR4(fs, fc, highpass) {
    this.s1 = new Biquad(); this.s2 = new Biquad();
    this.set(fs, fc, highpass);
  }

  LR4.prototype.set = function (fs, fc, highpass) {
    var q = 0.7071067811865476;
    if (highpass) {
      this.s1.setHighPass(fc, fs, q); this.s2.setHighPass(fc, fs, q);
    } else {
      this.s1.setLowPass(fc, fs, q); this.s2.setLowPass(fc, fs, q);
    }
  };

  LR4.prototype.process = function (x) { return this.s2.process(this.s1.process(x)); };
  LR4.prototype.reset = function () { this.s1.reset(); this.s2.reset(); };

  // 4 线反馈延迟网络（Hadamard 反馈 + 反馈内一阶阻尼）。
  // 只用来给"房间"一个尾巴：没有尾音，直达+离散反射会被听成头内。
  function FDN(fs, scale) {
    var d = [0.0227, 0.0291, 0.0341, 0.0413];
    this.l = [];
    for (var i = 0; i < 4; i++) {
      var n = Math.max(8, Math.round(d[i] * scale * fs));
      this.l.push({ buf: new Float32Array(n), i: 0, lp: 0 });
    }
    this.g = 0.87;
    this.damp = 0.30;
    this._out = [0, 0];
  }

  FDN.prototype.process = function (x) {
    var a = this.l[0], b = this.l[1], c = this.l[2], e = this.l[3];
    var x0 = a.buf[a.i], x1 = b.buf[b.i], x2 = c.buf[c.i], x3 = e.buf[e.i];
    // 正交混合（4 点 Hadamard），保证能量守恒、回声密度快速上升
    var m0 = (x0 + x1 + x2 + x3) * 0.5;
    var m1 = (x0 - x1 + x2 - x3) * 0.5;
    var m2 = (x0 + x1 - x2 - x3) * 0.5;
    var m3 = (x0 - x1 - x2 + x3) * 0.5;

    var kd = this.damp, g = this.g;
    a.lp += kd * (m0 - a.lp); a.buf[a.i] = x + g * a.lp;
    b.lp += kd * (m1 - b.lp); b.buf[b.i] = x + g * b.lp;
    c.lp += kd * (m2 - c.lp); c.buf[c.i] = x + g * c.lp;
    e.lp += kd * (m3 - e.lp); e.buf[e.i] = x + g * e.lp;

    if (++a.i >= a.buf.length) a.i = 0;
    if (++b.i >= b.buf.length) b.i = 0;
    if (++c.i >= c.buf.length) c.i = 0;
    if (++e.i >= e.buf.length) e.i = 0;

    // 🔴 两耳取同一混合：4 条线的延迟长度不同，取不相交的抽头对会让两耳
    // 能量不等（实测偏 7%），对称布局会被听成偏一边。宽度交给早反射去做，
    // 尾音只负责"这里有间屋子"，必须严格对称。
    var out = this._out;
    out[0] = out[1] = (x0 + x1 + x2 + x3) * 0.25;
    return out;
  };

  FDN.prototype.reset = function () {
    for (var i = 0; i < this.l.length; i++) { this.l[i].buf.fill(0); this.l[i].i = 0; this.l[i].lp = 0; }
  };

  function AllPass(fs, delayMs, g) {
    var n = Math.max(1, Math.round(fs * delayMs / 1000));
    this.buf = new Float32Array(n);
    this.i = 0;
    this.g = g;
  }

  AllPass.prototype.process = function (x) {
    var d = this.buf[this.i];
    var y = -this.g * x + d;
    this.buf[this.i] = x + this.g * y;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  };

  AllPass.prototype.reset = function () { this.buf.fill(0); this.i = 0; };

  // -------------------------------------------------------------- 房间/反射

  // 单个声道的早期反射方案：3 条，方位由主方位派生（侧墙 / 对侧后墙 / 上方）
  function reflectionSpecs(role, params) {
    var az = role.az, kind = role.kind;
    // 2.0–20ms：短延迟的早反射会被 precedence 效应融合进直达声，
    // 作用是"把声像推出头外"，而不是听成一间屋子（长延迟才像混响）。
    var baseMs = 2.0 + 18.0 * clamp(params.room, 0, 1);
    var dist = kind === 'rear' ? 1.25 : (kind === 'side' ? 1.12 : (kind === 'height' ? 1.10 : 1.0));
    var spec = [];
    var sg = az > 0 ? 1 : (az < 0 ? -1 : 0);

    if (kind === 'center' || az === 0) {
      // 🔴 左右两条壁反射必须同延迟、镜像方位：延迟不同就不是镜像关系，
      // 两耳的和不可交换，居中声源会被听成偏一边（实测 L/R 差 52%）。
      spec.push({ az: 78, el: 0, delayMs: baseMs * 0.95 * dist, gain: 0.62 });
      spec.push({ az: -78, el: 0, delayMs: baseMs * 0.95 * dist, gain: 0.62 });
      spec.push({ az: 180, el: 22, delayMs: baseMs * 1.70 * dist, gain: 0.30 });
      return spec;
    }

    if (kind === 'height') {
      spec.push({ az: sg * 90, el: 18, delayMs: baseMs * 0.95 * dist, gain: 0.56 });
      spec.push({ az: az * 0.5, el: 30, delayMs: baseMs * 1.30 * dist, gain: 0.40 });
      spec.push({ az: 180, el: 20, delayMs: baseMs * 1.65 * dist, gain: 0.30 });
      return spec;
    }

    // 前方 / 侧方 / 后方
    var wide = kind === 'front' ? 40 : 34;
    spec.push({
      az: clamp(az + sg * wide, -168, 168), el: 0,
      delayMs: baseMs * 0.88 * dist,
      gain: kind === 'front' ? 0.60 : 0.64,
    });
    // 对侧反射：放在 ±100°（物理上是另一面墙的反射），比 ±128° 更靠前、
    // 不会占满侧后方空隙——空隙留空，"几个离散的点"才立得住。
    spec.push({
      az: clamp(-sg * 100, -168, 168), el: 0,
      delayMs: baseMs * 1.40 * dist,
      gain: kind === 'front' ? 0.30 : 0.36,
    });
    spec.push({
      az: clamp(az + sg * 62, -172, 172), el: 28,
      delayMs: baseMs * 1.72 * dist,
      gain: 0.28,
    });
    return spec;
  }

  // -------------------------------------------------------------- 空间化核心

  function SpatialEngine(opts) {
    opts = opts || {};
    this.sampleRate = opts.sampleRate || 48000;
    this.version = VERSION;

    this.params = {};
    for (var k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) this.params[k] = DEFAULTS[k];
    if (opts.params) this.setParams(opts.params, true);

    this.channels = 0;
    this.roles = [];
    this.layoutName = 'none';
    this.active = false;

    this._ch = [];
    this._reflL = new LR4(this.sampleRate, 190, true);
    this._reflR = new LR4(this.sampleRate, 190, true);
    this._reflDampL = 0;
    this._reflDampR = 0;
    // 🔴 两耳扩散器必须同延迟：延迟不同 = 输出是彼此的时移版本，能量相等但与
    // 同一条直达声相加的干涉不同 → 居中声源被判成偏一边（实测 L/R 差 2.8dB）。
    // 去相关交给"带自身 ITD 的反射抽头"，不靠扩散器。
    this._apL1 = new AllPass(this.sampleRate, 7.3, 0.62);
    this._apL2 = new AllPass(this.sampleRate, 11.1, 0.55);
    this._apR1 = new AllPass(this.sampleRate, 7.3, 0.62);
    // 单套 FDN，两耳取不同抽头输出：能量严格对称（否则对称布局会被听成偏右），
    // 抽头错开保证去相关，而且比两套省一半开销。
    this._fdn = new FDN(this.sampleRate, 1.0);
    // 尾音两耳去相关：全通幅频恒 1，所以两耳能量严格相等（不会偏一边），
    // 但相位不同 → 相关度降下来，混响才会"包住"耳朵而不是中间一团。
    // 这是单声道尾音听不出外化的根因：两耳拿到同一信号，大脑判成头内。
    this._tailApL = new AllPass(this.sampleRate, 1.9, 0.5);
    this._tailApR = new AllPass(this.sampleRate, 3.3, 0.5);
    this._apR2 = new AllPass(this.sampleRate, 11.1, 0.55);

    this._accL = new Float32Array(MAX_BLOCK);
    this._accR = new Float32Array(MAX_BLOCK);
    this._reflAccL = new Float32Array(MAX_BLOCK);
    this._reflAccR = new Float32Array(MAX_BLOCK);

    // 平滑值（参数改动不直接落到采样上，避免 zipper）
    this._sm = {
      reflGain: 0, trim: 1, dampK: 1, lfe: 0.5, diffG: 0.6,
      reflScale: 1, corr: 0, tail: 0,
    };

    // 自适应统计
    this._envSlow = 0;
    this._envFast = 0;
    this._eCh = new Float32Array(MAX_CHANNELS);
    this._centerRatio = 0;
    this._surroundRatio = 0;

    this.peaks = { l: 0, r: 0 };

    this.configure(opts.channels || 0, opts.layout || '', true);
  }

  SpatialEngine.prototype.setParams = function (patch, silent) {
    if (!patch) return;
    for (var k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      if (patch[k] === undefined || patch[k] === null) continue;
      var v = patch[k];
      if (typeof DEFAULTS[k] === 'boolean' || typeof DEFAULTS[k] === 'string') {
        this.params[k] = v;
      } else {
        v = Number(v);
        if (isFinite(v)) this.params[k] = v;
      }
    }
    this.params.intensity = clamp(this.params.intensity, 0, 1);
    this.params.externalization = clamp(this.params.externalization, 0, 1);
    this.params.width = clamp(this.params.width, 0.5, 1.5);
    this.params.depth = clamp(this.params.depth, 0, 1);
    this.params.room = clamp(this.params.room, 0, 1);
    this.params.reflections = clamp(this.params.reflections, 0, 1);
    this.params.tail = clamp(this.params.tail, 0, 1);
    this.params.lfe = clamp(this.params.lfe, 0, 1);
    this.active = this.channels > 2 && !!this.params.enabled;
    if (!silent) this._updateDerived();
  };

  // 目标值写进预分配对象：每块都 new 一个字面量会持续制造垃圾，
  // 音频线程里这属于「不必要的每块分配」。
  SpatialEngine.prototype._targets = function () {
    var p = this.params;
    var tg = this._tg || (this._tg = { reflGain: 0, trim: 1, dampK: 1, lfe: 0.5, diffG: 0.6 });
    // 早期反射总量：默认档（refl .5 / ext .6 / int .55）落在 −10dB 量级
    // 系数 0.55：滑杆中点 ≈ −15dB（支撑性反射），拉满 ≈ −9dB（明确的房间）
    // 2.2 这个系数是实测标定的：反射抽头本身很小（每条 0.28–0.6 × 声像 × 单耳
    // 分量），总线实测只有 −18.5dB，撑不起"耳外"。拉到默认档 ≈ −13dB、拉满 ≈ −9dB。
    tg.reflGain = 2.2 * p.reflections * (0.35 + 0.85 * p.externalization) * (0.55 + 0.75 * p.intensity);
    // 阻尼：纵深越大，反射越暗
    var dampHz = 9800 - 4600 * p.depth;
    var k = 1 - Math.exp(-2 * Math.PI * dampHz / this.sampleRate);
    // 双耳化必然带来串扰（每个声道都进两只耳朵），能量比标准下混高约 3dB。
    // 按「每耳能量相等」解析补偿，A/B 才不会被音量骗。
    // 反射与尾音是加在直达上的能量，不补偿的话开了空间化会整体响 1~1.5dB，
    // A/B 就成了"更响 = 更好听"的错觉。系数按实测拟合。
    // 系数是实测拟合：反射总线 ≈ 0.104·reflGain（满档 −9dB），尾音 ≈ 0.22·tailG。
    // 早先用 0.20/0.55（相当于假设反射 -1.5dB）会把满档压掉 5dB，
    // 结果是"拉到最大反而更轻"，比不补偿更误导。
    var comp = 1 / Math.sqrt(1 + 0.0108 * tg.reflGain * tg.reflGain + 0.0484 * tg.tail * tg.tail);
    // 0.90 是实测标定（对音乐结构素材）：双耳化本身净增益约 +1.3dB（每个声道
    // 都进两只耳朵），压回 0 附近才叫等响。宁可略轻不要略响——否则 A/B 会被
    // "更响"骗成"更好"。实测残差：5.1 音乐 +0.4dB、7.1 +1.2dB、全带噪 −0.7dB。
    comp *= 0.90;
    tg.trim = p.trim * (this._autoTrim || 1) * comp;
    tg.dampK = clamp(k, 0.02, 1);
    tg.lfe = p.lfe;
    // 扩散量刻意压低：两级 allpass 高增益会把各声道的离散早反射揉成一片"相位糊"，
    // 听感就从"房间里几个点"退化成"一坨"。保留一点密度用来暗示空间边界即可。
    tg.diffG = 0.12 + 0.12 * p.intensity;
    // 尾音量（实测标定）：默认 ≈ −22dB（听得见"有间屋子"但不抢直达），
    // 拉满 ≈ −16dB（明确的房间感）。0 = 完全干。
    tg.tail = 0.85 * p.tail * (0.6 + 0.4 * p.intensity);
    return tg;
  };

  // 标准下混矩阵的每耳功率 / 双耳渲染的每耳功率（去相关、等功率假设）
  SpatialEngine.prototype._computeAutoTrim = function () {
    var bypassP = 0, spatialP = 0;
    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      var g = 0;
      switch (ch.kind) {
        case 'front': g = 1.0; break;
        case 'center': g = 0.7071; break;
        case 'side': case 'rear': g = 0.7071; break;
        case 'height': g = 0.5; break;
        default: g = 0; break;   // LFE：标准下混丢弃
      }
      bypassP += g * g;
      if (ch.kind !== 'lfe') spatialP += 2 * ch.gL * ch.gL;
    }
    this._autoTrim = spatialP > 1e-9 ? Math.sqrt(bypassP / spatialP) : 1;
  };

  SpatialEngine.prototype.configure = function (channels, layout, force) {
    channels = Math.max(0, Math.min(MAX_CHANNELS, channels | 0));
    var layoutIn = layout == null ? '' : String(layout);
    if (!force && channels === this.channels && layoutIn === this._layoutInput) return;
    this._layoutInput = layoutIn;

    var sr = this.sampleRate;
    this.channels = channels;
    this.roles = channels > 0 ? resolveRoles(layoutIn, channels) : [];
    this.layoutName = channels > 0 ? layoutNameOf(this.roles) : 'none';
    this.active = channels > 2 && !!this.params.enabled;

    // 采样率无关的环形缓冲：够长到能盖住最大反射（≈30ms×1.7×1.25 + ITD）
    var needSamples = Math.ceil(sr * 0.075) + 8;
    var ringLen = 1;
    while (ringLen < needSamples) ringLen <<= 1;
    this._ringMask = ringLen - 1;

    this._ch = [];
    for (var i = 0; i < channels; i++) {
      var roleName = this.roles[i] || 'C';
      var role = ROLE[roleName] || ROLE.C;
      var ch = {
        role: roleName,
        kind: role.kind,
        az: role.az,
        el: role.el,
        ring: new Float32Array(ringLen),
        w: 0,
        gL: 0, gR: 0,
        shK: 1,                 // 头影低通形状系数（截止频率）
        shLDepth: 0, shRDepth: 0, // 远耳遮挡深度：0 = 直通
        presL: 0, presR: 0,     // 近耳同侧增益（挡板/耳廓在 2–4k 的轻微抬起）
        shL1: 0, shL2: 0, shR1: 0, shR2: 0,
        presStateL: 0, presStateR: 0,
        lpL: new LR4(sr, 170, false),
        lpR: new LR4(sr, 170, false),
        tiltK: 0, tiltL: 0, tiltR: 0, tiltStateL: 0, tiltStateR: 0,
        dL: 0, dR: 0,           // 目标 ITD（样本），只用来算全通系数
        dLT: 0, dRT: 0,         // 平滑中的实际 ITD
        apL: 0, apR: 0,         // 平滑后的一阶全通系数
        apLT: 0, apRT: 0,       // 目标系数
        apStateL: 0, apStateR: 0,
        refl: [],               // {aL,aR,dL,dR,dLT,dRT}
        tapW: new Float64Array((2 + 6) * 5),
        tapOff: new Int32Array(2 + 6),
        reflDelayScale: 1,
        reflLevel: 1,
        isLfe: role.kind === 'lfe',
        lfeLP: role.kind === 'lfe' ? new LR4(sr, 120, false) : null,
        lfeState: 0,
      };
      this._ch.push(ch);
    }

    this._updateDerived(true);
    this.reset();
  };

  SpatialEngine.prototype._updateDerived = function (jump) {
    var sr = this.sampleRate;
    var p = this.params;
    var t = this._targets();
    var azScale = p.width;

    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      if (ch.isLfe) {
        ch.gL = ch.gR = 1;
        continue;
      }

      var elr = ch.el * Math.PI / 180;
      // 🔴 宽度只能缩放「侧向分量」，不能乘方位角本身：
      // 后方声道在 ±135°，乘 1.3 就成 ±175°，sin 趋 0 → ITD/ILD 一起归零，
      // 结果「越加宽，后面越糊」。改成缩放 sin(az) 后前后关系保持不变，
      // 侧向线索单调变强（实测 Lb ITD 430→560µs 而不是掉到 37µs）。
      var u0 = Math.sin(ch.az * Math.PI / 180) * Math.cos(elr);
      var u = clamp(u0 * azScale, -1, 1);
      // 方位角回算：保持前后半平面，只把侧向坐标放大
      var az = (ch.az < 0 ? -1 : 1) * (Math.abs(ch.az) > 90
        ? 180 - Math.asin(clamp(Math.abs(u), 0, 1)) * 180 / Math.PI
        : Math.asin(clamp(Math.abs(u), 0, 1)) * 180 / Math.PI);

      // 近耳不做衰减（同侧耳几乎无遮挡），远耳的 ILD 全部交给头影低通。
      // 每声道电平对齐标准下混矩阵，这样 A/B 的音量差只来自串扰不再来自混音系数。
      // 中置 0.775 而不是 0.7071：双耳化对中置的净损失比 L/R 大 0.8dB
      // （中置两耳同相，拿不到侧向抬起的补益）。不补的话人声相对变小，
      // 这是实测标定量（逐声道对比标准下混），不是口味。
      var kindGain = ch.kind === 'center' ? 0.775
        : (ch.kind === 'side' || ch.kind === 'rear') ? 0.7071
          : ch.kind === 'height' ? 0.5 : 1.0;
      // 宽频带 ILD：真实头部对远耳的衰减从 300Hz 就开始了，不只是高频头影。
      // 只做两耳差 3dB 量级（KEMAR 在 90° 的宽频带 ILD 约 3–4dB），
      // 但它是"侧向有多硬"的主要来源，比加深高频低通安全得多（不会有相位坑）。
      var mag = Math.abs(u);
      var ildDb = 3.0 * Math.pow(mag, 1.3);
      var farG = Math.pow(10, -ildDb / 20);
      ch.gL = kindGain * (u > 0 ? farG : 1);
      ch.gR = kindGain * (u > 0 ? 1 : farG);

      // 头影：形状（截止频率）+ 深度（0 = 严格直通）分开。
      // 🔴 深度必须从 0 连续长起来：只按「哪只耳朵是远耳」二选一的话，
      // 正中声道（u = 0）会有一只耳朵吃到两级 18kHz 低通 = 16k 掉 5dB，
      // 而中置恰恰是人声，听起来就是"闷"。
      var fcFar = clamp(20000 * Math.exp(-1.9 * Math.pow(mag, 0.8)), 3000, 20000);
      ch.shK = 1 - Math.exp(-2 * Math.PI * fcFar / sr);
      // 2.6：侧向 22° 以上就吃满遮挡，方位更"硬"（图中每个声道是一个明确的点）
      var depth = clamp(mag * 2.6, 0, 1);
      // u > 0 = 音源在右侧 → 右耳是近耳。近耳必须完全不吃低通，
      // 高频全在近耳上，一旦遮错耳朵整条输出就发闷。
      var rightIsNear = u > 0;
      ch.shLDepth = rightIsNear ? depth : 0;
      ch.shRDepth = rightIsNear ? 0 : depth;
      // 2–4kHz 抬起：只给近耳会破坏发声平衡（L/R 每声道多 +2dB 而中置没有，
      // 实测 L/R +0.6dB / C −1.5dB，人声会显得更小）。改成两耳同等施加，
      // 定位差交给「头影 + 宽频带 ILD」，这里只负责把双耳化丢掉的高频补回来。
      var pres = 0.30 * (0.35 + 0.65 * mag);
      ch.presL = pres;
      ch.presR = pres;

      // 高频倾斜（后方更暗、上方略亮）；一阶高频搁架
      var tiltDb = ch.kind === 'rear' ? -2.0 : (ch.kind === 'side' ? -1.2 : (ch.kind === 'height' ? 1.2 : 0));
      ch.tiltK = clamp(Math.pow(10, tiltDb / 40) - 1, -0.5, 0.5);

      // 双耳时间差（Woodworth）：θ = 与耳朵轴的夹角
      var thetaR = Math.acos(clamp(u, -1, 1));
      var thetaL = Math.acos(clamp(-u, -1, 1));
      var kd = HEAD_RADIUS_M / SPEED_OF_SOUND;
      // 全通在高频把群延迟拉到接近 0，中频只剩约 75–80% 的时差。
      // 乘 1.3 补回有效 ITD（定位/外化靠它），高频仍然是 0 时差、不会梳状。
      var dL = Math.max(0.2, (thetaL + Math.sin(thetaL)) * kd * sr * 1.3);
      var dR = Math.max(0.2, (thetaR + Math.sin(thetaR)) * kd * sr * 1.3);
      // 物理上限：人头的最大双耳时差约 700µs。Woodworth 在 θ>90° 会继续增长，
      // 加宽滑杆时后方声道会算出 1ms 以上（全通系数趋 −1，相位失真且不稳定）。
      var half = (dR - dL) * 0.5;
      var cap = 0.00070 * sr * 0.5;
      if (half > cap || half < -cap) {
        var mid = (dL + dR) * 0.5;
        half = clamp(half, -cap, cap);
        dL = mid - half; dR = mid + half;
      }
      ch.dL = dL; ch.dR = dR;
      // 🔴 ITD 用一阶全通而不是纯延迟：全通的群延迟在 DC 等于 ITD、在 Nyquist 趋近 0，
      // 幅频恒为 1。这样高频段各声道之间没有相对时差，就不会在同一只耳朵里
      // 梳状抵消（纯延迟会给相关素材挖出 1.8~6kHz 的深坑，听感"闷/空/不如不开"），
      // 低频的时差线索和定位完全保留。a = (1-D)/(1+D)。
      ch.apLT = (1 - ch.dL) / (1 + ch.dL);
      ch.apRT = (1 - ch.dR) / (1 + ch.dR);

      // 反射
      var specs = reflectionSpecs({ az: az, el: ch.el, kind: ch.kind }, p);
      ch.refl = [];
      var reflLevel = ch.kind === 'rear' ? 1.10 : (ch.kind === 'side' ? 1.05 : 1.0);
      ch.reflLevel = reflLevel;
      for (var r = 0; r < specs.length; r++) {
        var sp = specs[r];
        var uR2 = clamp(Math.sin(sp.az * Math.PI / 180) * Math.cos(sp.el * Math.PI / 180), -1, 1);
        var delayS = sp.delayMs * sr / 1000;
        var pan = (1 - Math.abs(uR2)) * 0.35 + 0.65;  // 反射整体比直达「靠中间」一些
        // 🔴 每条反射必须带自己的双耳时差：只做声像（电平）的话，同一个延迟副本
        // 在左右耳被不同加权，两个耳的和就不可交换——居中声源会被听成偏一边
        // （实测 L/R 能量差 67%）。补上它自己的 ITD，左右才严格镜像。
        var thR2 = Math.acos(uR2), thL2 = Math.acos(-uR2);
        var itd2L = (thL2 + Math.sin(thL2)) * kd * sr;
        var itd2R = (thR2 + Math.sin(thR2)) * kd * sr;
        ch.refl.push({
          dL: itd2L + delayS, dR: itd2R + delayS,
          dLT: itd2L + delayS, dRT: itd2R + delayS,
          aL: Math.sqrt(0.5 * (1 - uR2)) * pan * sp.gain,
          aR: Math.sqrt(0.5 * (1 + uR2)) * pan * sp.gain,
        });
      }
    }

    // 平滑目标立即落到初值（避免开头一段淡入）
    this._computeAutoTrim();
    var tg = this._targets();
    this._sm.reflGain = tg.reflGain;
    this._sm.trim = tg.trim;
    this._sm.dampK = tg.dampK;
    this._sm.lfe = tg.lfe;
    this._sm.diffG = tg.diffG;

    for (var i2 = 0; i2 < this._ch.length; i2++) {
      var c2 = this._ch[i2];
      if (!jump) continue;
      c2.apL = c2.apLT; c2.apR = c2.apRT;
      for (var r2 = 0; r2 < c2.refl.length; r2++) {
        c2.refl[r2].dLT = c2.refl[r2].dL;
        c2.refl[r2].dRT = c2.refl[r2].dR;
      }
    }
  };

  SpatialEngine.prototype.reset = function () {
    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      ch.ring.fill(0);
      ch.w = 0;
      ch.shL1 = 0; ch.shL2 = 0; ch.shR1 = 0; ch.shR2 = 0;
      ch.presStateL = 0; ch.presStateR = 0;
      ch.apStateL = 0; ch.apStateR = 0;
      ch.apL = ch.apLT || 0; ch.apR = ch.apRT || 0;
      ch.tiltStateL = 0; ch.tiltStateR = 0;
      ch.lpL.reset(); ch.lpR.reset();
      if (ch.lfeLP) ch.lfeLP.reset();
      ch.dLT = ch.dL; ch.dRT = ch.dR;
      for (var r = 0; r < ch.refl.length; r++) {
        ch.refl[r].dLT = ch.refl[r].dL;
        ch.refl[r].dRT = ch.refl[r].dR;
      }
    }
    this._reflL.reset(); this._reflR.reset();
    this._reflDampL = 0; this._reflDampR = 0;
    this._apL1.reset(); this._apL2.reset(); this._apR1.reset(); this._apR2.reset();
    if (this._fdn) this._fdn.reset();
    if (this._tailApL) { this._tailApL.reset(); this._tailApR.reset(); }
    this._envSlow = 0; this._envFast = 0;
    this._airL = 0; this._airR = 0;
    this._sm.reflScale = 1; this._sm.corr = 0;
  };

  // 自适应：块级估计，只做保守调整（不改变混音意图）
  SpatialEngine.prototype._adapt = function (input, frames) {
    if (frames <= 0) return;
    var sum = 0;
    var centerE = 0, frontE = 0, surE = 0;
    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      var x = input[i];
      if (!x) { this._eCh[i] = this._eCh[i] * 0.7; continue; }
      var acc = 0;
      for (var n = 0; n < frames; n++) {
        var v = x[n];
        // 输入里混进一个 NaN 会永久污染环形缓冲和滤波器状态（永远不会自愈），
        // 在这里就地清零——代价是每样本一次比较，比整条链路变哑划算。
        if (v !== v) { v = 0; x[n] = 0; }
        acc += v * v;
      }
      acc /= frames;
      this._eCh[i] = this._eCh[i] * 0.72 + acc * 0.28;
      sum += this._eCh[i];
      if (ch.kind === 'center') centerE += this._eCh[i];
      else if (ch.kind === 'front') frontE += this._eCh[i];
      else if (ch.kind === 'side' || ch.kind === 'rear') surE += this._eCh[i];
    }

    this._envFast = this._envFast * 0.55 + sum * 0.45;
    this._envSlow = this._envSlow * 0.92 + sum * 0.08;

    var surge = this._envSlow > 1e-9 ? this._envFast / this._envSlow : 1;
    this._centerRatio = (centerE + 1e-12) / (frontE + centerE + 1e-12);
    this._surroundRatio = (surE + 1e-12) / (sum + 1e-12);

    // 瞬态密度高 → 反射稍让路，免得糊攻击
    var duck = clamp(1.16 - 0.5 * clamp(surge - 1.0, 0, 2), 0.5, 1.16);
    // 中置很突出（人声段落）→ 反射再收一点，保住正前结像
    var centerDuck = 1 - 0.18 * clamp((this._centerRatio - 0.35) / 0.5, 0, 1);
    // 相关度守门：输出持续负相关说明去相关过头了
    var guard = clamp(1 + 4 * Math.min(0, this._sm.corr + 0.10), 0.35, 1);

    var target = duck * centerDuck * guard;
    this._sm.reflScale = this._sm.reflScale * 0.8 + target * 0.2;
  };

  SpatialEngine.prototype._smooth = function () {
    var tg = this._targets();
    var s = this._sm;
    s.reflGain += (tg.reflGain - s.reflGain) * 0.12;
    s.trim += (tg.trim - s.trim) * 0.12;
    s.dampK += (tg.dampK - s.dampK) * 0.12;
    s.lfe += (tg.lfe - s.lfe) * 0.12;
    s.diffG += (tg.diffG - s.diffG) * 0.12;
    s.tail += (tg.tail - s.tail) * 0.12;

    // 反射延迟缓动（拖动 roomSize 时是轻微的音高滑动，不会咔哒）
    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      ch.apL += (ch.apLT - ch.apL) * 0.10;
      ch.apR += (ch.apRT - ch.apR) * 0.10;
      for (var r = 0; r < ch.refl.length; r++) {
        var rf = ch.refl[r];
        rf.dLT += (rf.dL - rf.dLT) * 0.10;
        rf.dRT += (rf.dR - rf.dRT) * 0.10;
      }
    }
  };

  // 5 点拉格朗日分数延迟权重（每块算一次；样本循环里只做 5 次乘加）
  SpatialEngine.prototype._setTap = function (ch, j, d) {
    if (d < 2.5) d = 2.5;
    var ci = Math.ceil(d);
    var x = ci - d;              // 小数部分
    var t1 = x + 1, t2 = x + 2, m1 = x - 1, m2 = x - 2;
    var k = j * 5;
    var W = ch.tapW;
    W[k] = x * t1 * m1 * m2 / 24;
    W[k + 1] = -x * t2 * m1 * m2 / 6;
    W[k + 2] = t2 * t1 * m1 * m2 / 4;
    W[k + 3] = -x * t2 * t1 * m2 / 6;
    W[k + 4] = x * t2 * t1 * m1 / 24;
    ch.tapOff[j] = -(ci + 2);
  };

  SpatialEngine.prototype._prepareTaps = function () {
    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      if (ch.isLfe) continue;
      // 直达不再走环形缓冲（改用全通），只给反射抽头算权重
      for (var r = 0; r < ch.refl.length; r++) {
        this._setTap(ch, 2 + r * 2, ch.refl[r].dLT + TAP_PAD);
        this._setTap(ch, 3 + r * 2, ch.refl[r].dRT + TAP_PAD);
      }
    }
  };

  /**
   * 处理一块非交织多声道 PCM。
   * @param {Array<Float32Array>} input  长度 >= channels
   * @param {number} frames
   * @param {Float32Array} outL
   * @param {Float32Array} outR
   * @returns {boolean} 是否走了空间化路径
   */
  SpatialEngine.prototype.process = function (input, frames, outL, outR) {
    if (!this.active) return false;
    // frames<=0（缓冲欠载、流末尾）必须直接返回：_adapt 里要除以 frames，
    // 0 会让整条状态链路变成 NaN 并永久卡死。
    if (frames <= 0) return true;
    if (frames > MAX_BLOCK) return false;
    // 宿主给的 frames 大于实际缓冲长度时，读越界的 undefined 会让整条状态链变 NaN
    // 且永不自愈（最后一块、异常 tail 都会触发）。以最短输入为准。
    for (var av = 0; av < input.length; av++) {
      if (input[av] && input[av].length < frames) frames = input[av].length;
    }
    if (frames <= 0) return true;

    this._smooth();
    this._adapt(input, frames);
    this._prepareTaps();

    var accL = this._accL, accR = this._accR;
    var rL = this._reflAccL, rR = this._reflAccR;
    for (var z = 0; z < frames; z++) { accL[z] = 0; accR[z] = 0; rL[z] = 0; rR[z] = 0; }

    var mask = this._ringMask;
    var reflG = this._sm.reflGain * this._sm.reflScale;

    for (var i = 0; i < this._ch.length; i++) {
      var ch = this._ch[i];
      var x = input[i];
      if (!x) continue;

      if (ch.isLfe) {
        var lfeG = this._sm.lfe;
        for (var n0 = 0; n0 < frames; n0++) {
          var lv = ch.lfeLP.process(x[n0]) * lfeG;
          accL[n0] += lv; accR[n0] += lv;
        }
        continue;
      }

      var ring = ch.ring;
      var W = ch.tapW;
      var off = ch.tapOff;
      var w = ch.w;
      var gL = ch.gL, gR = ch.gR;
      var kE = ch.shK;
      var dL2 = ch.shLDepth, dR2 = ch.shRDepth;
      var presL = ch.presL, presR = ch.presR;
      var shL1 = ch.shL1, shL2 = ch.shL2, shR1 = ch.shR1, shR2 = ch.shR2;
      var pSL = ch.presStateL, pSR = ch.presStateR;
      var tiltK = ch.tiltK;
      var tzL = ch.tiltStateL, tzR = ch.tiltStateR;
      var lpL = ch.lpL, lpR = ch.lpR;
      var refl = ch.refl;
      var nr = refl.length;
      var apL = ch.apL, apR = ch.apR;
      var apSL = ch.apStateL, apSR = ch.apStateR;
      var lvl = ch.reflLevel;
      var hasTilt = tiltK !== 0;

      for (var n = 0; n < frames; n++) {
        var xin = x[n];
        ring[w & mask] = xin;

        // 直达：一阶全通 ITD（幅频恒 1，低频群延迟 = ITD，高频 → 0）
        var tl = apL * xin + apSL;
        apSL = xin - apL * tl;
        var tr = apR * xin + apSR;
        apSR = xin - apR * tr;

        // 减法式分频：低频走电平，高频走头影（低频完全不吃遮挡）。
        // 备选方案「ITD 只给 1.2kHz 以下」已试过并放弃：延迟支与未延迟支在
        // 分频点相消，125–500Hz 挖出 −6…−11dB 的坑，比梳状更难受。
        // 现在 ITD 由全通实现（见上），不需要分频，也没有这个坑。
        var loL = lpL.process(tl);
        var hiL = tl - loL;
        shL1 += kE * (hiL - shL1);
        shL2 += kE * (shL1 - shL2);
        var yl = loL + hiL + dL2 * (shL2 - hiL);   // depth=0 → 严格直通
        pSL += PRES_K * (yl - pSL);
        yl += presL * (yl - pSL);

        var loR = lpR.process(tr);
        var hiR = tr - loR;
        shR1 += kE * (hiR - shR1);
        shR2 += kE * (shR1 - shR2);
        var yr = loR + hiR + dR2 * (shR2 - hiR);
        pSR += PRES_K * (yr - pSR);
        yr += presR * (yr - pSR);

        // 高频倾斜（一阶搁架）
        if (hasTilt) {
          tzL += 0.25 * (yl - tzL);
          tzR += 0.25 * (yr - tzR);
          yl += tiltK * (yl - tzL);
          yr += tiltK * (yr - tzR);
        }

        accL[n] += yl * gL;
        accR[n] += yr * gR;

        if (nr > 0) {
          var rl = 0, rr = 0;
          for (var k = 0; k < nr; k++) {
            var rf = refl[k];
            var jl = (2 + k * 2) * 5, jr = jl + 5;
            var bl = w + off[2 + k * 2], br = w + off[3 + k * 2];
            var vl = ring[bl & mask] * W[jl] + ring[(bl + 1) & mask] * W[jl + 1] +
                     ring[(bl + 2) & mask] * W[jl + 2] + ring[(bl + 3) & mask] * W[jl + 3] +
                     ring[(bl + 4) & mask] * W[jl + 4];
            var vr = ring[br & mask] * W[jr] + ring[(br + 1) & mask] * W[jr + 1] +
                     ring[(br + 2) & mask] * W[jr + 2] + ring[(br + 3) & mask] * W[jr + 3] +
                     ring[(br + 4) & mask] * W[jr + 4];
            rl += vl * rf.aL;
            rr += vr * rf.aR;
          }
          rL[n] += rl * lvl;
          rR[n] += rr * lvl;
        }

        w++;
      }

      ch.w = w & mask;
      ch.apStateL = apSL; ch.apStateR = apSR;
      ch.shL1 = shL1; ch.shL2 = shL2; ch.shR1 = shR1; ch.shR2 = shR2;
      ch.presStateL = pSL; ch.presStateR = pSR;
      ch.tiltStateL = tzL; ch.tiltStateR = tzR;
    }

    // 反射总线：去低频浑浊 → 阻尼 → 扩散
    var hpL = this._reflL, hpR = this._reflR;
    var dampL = this._reflDampL, dampR = this._reflDampR;
    var dk = this._sm.dampK;
    var g = this._sm.diffG;
    this._apL1.g = g; this._apL2.g = g * 0.9;
    this._apR1.g = g; this._apR2.g = g * 0.9;
    var apL1 = this._apL1, apL2 = this._apL2, apR1 = this._apR1, apR2 = this._apR2;
    var fdn = this._fdn;
    var tapL = this._tailApL, tapR = this._tailApR;
    var trim = this._sm.trim;
    var pl = 0, pr = 0;
    var airL = this._airL || 0, airR = this._airR || 0;
    var dbgL = 0, dbgR = 0;

    for (var m = 0; m < frames; m++) {
      var bl = hpL.process(rL[m]);
      var br = hpR.process(rR[m]);
      dampL += dk * (bl - dampL);
      dampR += dk * (br - dampR);
      var dl = apL2.process(apL1.process(dampL)) * reflG;
      var dr = apR2.process(apR1.process(dampR)) * reflG;

      // 反射总线同时驱动两耳的尾音网络
      var tailG = this._sm.tail;
      if (tailG > 0.001) {
        var fv = fdn.process((dampL + dampR) * 0.5);
        dl += tapL.process(fv[0]) * tailG;
        dr += tapR.process(fv[1]) * tailG;
      }

      var outl = (accL[m] + dl) * trim;
      var outr = (accR[m] + dr) * trim;

      // 高频补偿（一阶搁架）
      airL += AIR_K * (outl - airL);
      airR += AIR_K * (outr - airR);
      outl += AIR_GAIN * (outl - airL);
      outr += AIR_GAIN * (outr - airR);

      // 软限幅：只在接近满刻度时介入，保住瞬态
      if (outl > 0.82 || outl < -0.82) outl = softClip(outl);
      if (outr > 0.82 || outr < -0.82) outr = softClip(outr);

      outL[m] = outl;
      outR[m] = outr;
      dbgL += dl * dl; dbgR += dr * dr;
      if (outl > pl) pl = outl; if (-outl > pl) pl = -outl;
      if (outr > pr) pr = outr; if (-outr > pr) pr = -outr;
    }

    this._reflDampL = dampL; this._reflDampR = dampR;
    this._airL = airL; this._airR = airR;
    this._dbgBus = [dbgL, dbgR];
    if (pl > this.peaks.l) this.peaks.l = pl;
    if (pr > this.peaks.r) this.peaks.r = pr;

    // 输出相关度（估计值，给下一块的守门用）
    var sll = 0, srr = 0, slr = 0;
    for (var q = 0; q < frames; q++) {
      var a2 = outL[q], b2 = outR[q];
      sll += a2 * a2; srr += b2 * b2; slr += a2 * b2;
    }
    var den = Math.sqrt(sll * srr);
    var corr = den > 1e-9 ? slr / den : 1;
    this._sm.corr = this._sm.corr * 0.7 + corr * 0.3;

    return true;
  };

  function softClip(x) {
    var c = 0.82, span = 1 - c;
    var t = (Math.abs(x) - c) / span;
    var shaped = c + span * (t * (27 + t * t) / (27 + 9 * t * t));
    return x < 0 ? -shaped : shaped;
  }

  // 离线比对用：ITU/ffmpeg 风格的标准下混（这是「旁路」的参考口径）
  SpatialEngine.prototype.downmixBypass = function (input, frames, outL, outR, chCount) {
    var n = Math.min(chCount || this.channels, input.length);
    for (var z = 0; z < frames; z++) { outL[z] = 0; outR[z] = 0; }
    for (var i = 0; i < n; i++) {
      var x = input[i];
      if (!x) continue;
      var role = this.roles[i] || 'C';
      var gl = 0, gr = 0;
      switch (role) {
        case 'L': gl = 1; break;
        case 'R': gr = 1; break;
        case 'C': gl = 0.707; gr = 0.707; break;
        case 'LFE': break;                    // 与 ffmpeg 默认一致：LFE 不进立体声
        case 'Lb': case 'Ls': gl = 0.707; break;
        case 'Rb': case 'Rs': gr = 0.707; break;
        case 'Cs': gl = 0.5; gr = 0.5; break;
        case 'Tfl': case 'Tbl': gl = 0.5; break;
        case 'Tfr': case 'Tbr': gr = 0.5; break;
        case 'Tfc': gl = 0.4; gr = 0.4; break;
        default: gl = 0.5; gr = 0.5; break;
      }
      for (var z2 = 0; z2 < frames; z2++) {
        outL[z2] += x[z2] * gl;
        outR[z2] += x[z2] * gr;
      }
    }
  };

  SpatialEngine.prototype.describe = function () {
    return {
      version: VERSION,
      sampleRate: this.sampleRate,
      channels: this.channels,
      layout: this.layoutName,
      roles: this.roles.slice(),
      active: this.active,
      reflections: this._ch.length ? this._ch[0].refl.length : 0,
      params: JSON.parse(JSON.stringify(this.params)),
    };
  };

  return {
    VERSION: VERSION,
    MAX_CHANNELS: MAX_CHANNELS,
    LAYOUTS: LAYOUTS,
    ROLE: ROLE,
    DEFAULTS: DEFAULTS,
    SpatialEngine: SpatialEngine,
    resolveRoles: resolveRoles,
    layoutNameOf: layoutNameOf,
  };
});
