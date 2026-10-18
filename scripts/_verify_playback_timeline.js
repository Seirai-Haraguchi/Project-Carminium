// 播放时间轴守卫用例：npm run? 无。直接 `node scripts/_verify_playback_timeline.js`
//
// 覆盖 AudioEngine 的进度时间轴（_tl*）与"智能过渡"收尾锚点。
// 这两处一旦回退，症状是：过渡之后前端进度整首歌永久落后于实际播放（定时器超时那截），
// 以及 BPM tempo 斜坡期间进度倒退 / 永久落后。
global.window = {
  AudioBufferCache: function () {
    this.get = function () { return null; };
    this.set = function () {};
    this.shrinkTo = function () {};
  },
};
require('../web/audio_engine.js');
const AudioEngine = global.window.AudioEngine;

let failures = 0;
function check(name, actual, expected, tol) {
  tol = tol || 2;
  if (!(Math.abs(actual - expected) <= tol)) {
    failures++;
    console.error('  ✗ ' + name + '：期望 ~' + expected + '，实际 ' + actual);
  } else {
    console.log('  ✓ ' + name + ' = ' + Math.round(actual));
  }
}

function mkGain() {
  return {
    gain: {
      value: 0,
      cancelScheduledValues() {},
      setValueAtTime() {},
      linearRampToValueAtTime() {},
    },
    connect() {},
    disconnect() {},
  };
}

function mkSource() {
  return {
    playbackRate: {
      value: 1,
      cancelScheduledValues() {},
      setValueAtTime() {},
      linearRampToValueAtTime() {},
    },
    disconnect() {},
  };
}

function mkEngine() {
  const e = new AudioEngine();
  e._ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    createGain: mkGain,
  };
  e._volume = 1;
  e._crossfadeDurationMs = 5000;
  return e;
}

// ---------- 1. 基准积分 ----------
console.log('时间轴积分');
const e = mkEngine();
e._tlSeed(0, 1000, 1);
e._ctx.currentTime = 5;
check('常数速率 1×，5s', e._tlPositionNow(), 6000);

// ---------- 2. tempo 斜坡积分 ----------
e._tlSeed(10, 0, 1.25);
e._tlPushRamp(10, 1.25, 1.0, 3);
e._ctx.currentTime = 13;
check('1.25→1.0 斜坡 3s（梯形面积）', e._tlPositionNow(), 3375);
e._ctx.currentTime = 14;
check('斜坡后按 1.0 续算', e._tlPositionNow(), 4375);

// ---------- 3. 过去时刻锚点（定时器晚触发） ----------
e._tlSeed(100, 5000, 1);
e._ctx.currentTime = 100.25;
check('晚 250ms 收尾仍对齐', e._tlPositionNow(), 5250);

// ---------- 4. 变速不倒退 ----------
e._tlSeed(0, 0, 1);
e._ctx.currentTime = 4;
check('变速前', e._tlPositionNow(), 4000);
e._tlPushConst(4, 0.5);
e._ctx.currentTime = 6;
check('变速后继续前进', e._tlPositionNow(), 5000);

// ---------- 5. 高水位：抖动不回退，换曲放行 ----------
console.log('进度单调性');
e._isPlaying = true;
e._currentBuffer = {};
e._dllBufferLatencyMs = 100;
e._tlSeed(0, 0, 1);
e._ctx.currentTime = 10;
const p1 = e.getCurrentPositionMs();
e._dllBufferLatencyMs = 180;
const p2 = e.getCurrentPositionMs();
check('延迟估计跳变不回退', p2, p1);
e._tlSeed(0, 0, 1);
e._ctx.currentTime = 0.5;
if (e.getCurrentPositionMs() >= 1000) {
  failures++;
  console.error('  ✗ 换曲后未放行大跨度回退');
} else {
  console.log('  ✓ 换曲后允许回退');
}

// ---------- 6. 智能过渡收尾锚点 ----------
console.log('智能过渡收尾');
const x = mkEngine();
x._isPlaying = true;
x._dllBufferLatencyMs = 0;
const T0 = 100;
const CF_MS = 5000;
x._currentSource = mkSource();
x._currentGain = mkGain();
x._currentBuffer = {};
x._nextSource = x._currentSource;
x._nextGain = x._currentGain;
x._nextBuffer = {};
x._nextDurationMs = 240000;
x._nextFilePath = 'b.mp3';
x._tempoAdjustActive = 0.8;
x._transitionPlan = { crossfadeDurationMs: CF_MS, nextStartOffsetMs: 0, tempoRampMs: 3000 };
x._xfadeAnchor = { ctxTime: T0, baseMs: 0, rate: 0.8, streaming: false };
x._tlSeed(T0, 0, 0.8);

let reported = null;
x.onCrossfadeComplete = function (ms) { reported = ms; };

// 定时器晚 320ms（淡变期间渲染线程繁忙）
x._ctx.currentTime = T0 + CF_MS / 1000 + 0.32;
x._finishTransition();

const LAT = 100;
check('收尾位置含定时器超时（@0.8×）', reported, CF_MS * 0.8 + 320 * 0.8 - LAT);

x._ctx.currentTime = T0 + CF_MS / 1000 + 0.32 + 5;
check('收尾后 5s 含 tempo 回正积分', x.getCurrentPositionMs(),
  (CF_MS * 0.8 + 320 * 0.8 - LAT) + 2700 + 2000);

if (failures) {
  console.error('\n失败 ' + failures + ' 项');
  process.exit(1);
}
console.log('\n播放时间轴校验全部通过');
