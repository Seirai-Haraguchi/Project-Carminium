# Carminium 内存深度优化方案

> 目标：在**功能与感官体验完全不变**的前提下，将总内存占用从 ~1143MB 压缩到可验证的最低水位。
> 本文档基于 2026-08-09 对全代码库的实测归因分析（任务管理器截图 + 逐文件审查）。

---

## ✅ 实施状态（2026-08-09，Phase 1 + 2 已落地）

**已实施**：Phase 1 全部 9 项 + Phase 2 的 2.1/2.2/2.3/2.5（范围调整见下）。启动冒烟测试通过（主进程完整初始化、播放状态恢复、WASAPI 就绪）。

**实施中的重要发现**（改变了个别项目的落地方式）：

1. **Google Sans Flex 远程链接从一开始就是死的**：其 css2 轴参数 `GRAD@-200..150` 非法，Google Fonts 始终返回 400，字体从未真正加载。已直接移除链接（视觉零变化——它从来没生效过）。若日后想要 GSF 的歌词设计观感，可用修正轴 `opsz,wght@6..48,100..1000` 自托管。
2. **Material Symbols 连字规则挂在 rlig（非 liga）且包裹在 ExtensionSubst 中**，且按字母闭包会导致全字体牵连。落地采用两阶段法（先 GSUB 剪枝再 pyftsubset）：5.2MB → **77KB**，87/87 图标连字映射校验通过，4 个可变轴全保留。重跑：`python scripts/subset_fonts.py`（需 fonttools+brotli）。
3. **顺带修复一个存量 bug**：设置页"立即清理"按钮图标名 `cleanup` 在字体中不存在（一直显示为文字），已改为 `cleaning_services`。
4. **js-flags 隐性 Bug 确认并修复**：`--max-old-space-size=128` 此前通过 js-flags 传播到渲染进程，已改为主进程独享（`v8.setFlagsFromString`）。
5. **内存管制阈值随 GPU 合并上移**：in-process-gpu 后主进程 RSS 含 GPU 分配，阈值 150/180/200 → **320/380/450**，否则正常水位误触发紧急清理（冒烟测试实测观察到）。
6. **本地封面缓存头取 300s 而非 3600s**：应用内有标签编辑器，改封面后最长 5 分钟 stale 可接受。
7. **彩蛋**：`web/audio_mixer.js` 也是零引用死文件，已随 gsap.min.js 一并删除；package.json 移除 gsap 依赖。

**范围调整（明确剔除/降级的项）**：
- 2.3 歌词虚拟化 → 降级为 `content-visibility: auto` + `contain-intrinsic-height`（屏外行跳过样式/布局/绘制，DOM 与全部 JS 逻辑零改动，零回归风险；DOM 节点本身的 JS 堆收益放弃，光栅/合成收益保留）。
- 2.4 allTracks 窗口化查询 → **本次剔除**：牵动搜索/排序/筛选/随机队列等全部读路径，万级曲库才省 10-30MB，风险/收益比差，建议独立任务处理。
- 2.5 队列面板/专辑网格虚拟化 → 剔除（队列/专辑数量有界且条目极小，收益边际）；i18n 按语言拆包 → 剔除（~1MB，不值得引入启动异步瀑布）。
- 2.2 中 `.np-bg-cover-base` 的 will-change 直接删除（infinite 动画自动提升），surge 收窄为仅 opacity；交叉淡入包装层改为过渡期间 JS 挂 `.fading`。

**待用户实测验证**：① 播放时背景模糊观感与鼓点脉动应与之前完全一致；② 全窗口/全屏切换、交叉淡入；③ 逐字歌词与渐进模糊；④ 国旗 emoji（新手引导语言页）；⑤ in-process-gpu 稳定性（若出现异常可单独回退 main.js 该开关）。

---

## 0. 先说结论（诚实的预期管理）

| 阶段 | 性质 | 预计总量（PWSet） | 体验影响 |
|---|---|---|---|
| 现状 | — | **~1143MB**（另有 2 个 ffmpeg.exe 约 30–60MB 不在截图分组内） | — |
| Phase 1 零风险速赢 | 纯资源/合成器修复 | **~550–650MB** | 无 |
| Phase 2 结构性优化 | 感知等价的架构调整 | **~420–500MB** | 无（肉眼不可分辨） |
| Phase 3 深度注入 | 进程合并 + 零拷贝 PCM + 原生解码 | **~330–420MB** | 无 |
| Phase 4 换壳（参考网易云） | 弃用 Electron 壳，保留全部 web/ UI | **~150–250MB** | 无（但工程量以周计） |

**160MB 在保留 Electron 的前提下不可达。** 一个空窗口的 Electron（Chromium 浏览器进程 + 渲染进程 + GPU 进程 + utility + crashpad）裸机水位就是 ~250–350MB——这是 Chromium 多进程架构的地板，与业务代码无关。网易云音乐等轻量应用能做到 100–200MB，是因为它们用的是**深度裁剪的自研 CEF 壳**（合并进程、裁掉大半个 Chromium），不是 Electron。Electron 侧对应的手段是 Phase 3 的命令行开关级"注入"；要真正触及 160MB，只能走 Phase 4。

**反模式警告**：网易云时代常见 `EmptyWorkingSet`/`SetProcessWorkingSetSize(-1,-1)` 定时清工作集的手法，只是让任务管理器数字变小（页面被换出到 standby），**真实内存占用不变且恢复时卡顿**。本方案明确不采用。

---

## 1. 现状归因：1143MB 花在哪了

截图五进程归因（Windows 任务管理器显示的是私有工作集）：

| 进程 | RSS | 判定 | 主要构成 |
|---|---|---|---|
| Electron #4 | **672MB** | 渲染进程（CPU 3.3%，活跃 UI） | 合成器/光栅层（4 层全屏 `blur(96px)`）150–250MB；全尺寸封面解码 ≤70MB；字体（Material Symbols 5.35MB 全表 + 远程 Noto Color Emoji + Google Sans Flex + 16 个无分片 Roboto）40–70MB；AudioBuffer 缓存 ≤40MB+当前/下一曲；全量曲目 JSON 10–30MB；逐字歌词 DOM；PCM IPC 分配churn撑大的 V8 堆；Chromium 渲染器基线 ~100MB |
| Electron #5 | **246.9MB** | 主进程（磁盘 0.7MB/s） | Chromium 浏览器进程基线 ~130–150MB；Node + better-sqlite3/sharp(libvips)/music-metadata 原生模块 ~40–70MB；PCM 转发 Buffer churn |
| Electron #1 | **218.4MB** | GPU 进程（GPU 3.7%） | 全屏模糊层的纹理 + 模糊中间缓冲 + 过度 `will-change` 提升的合成层 + 全屏 DPR 视频背景 canvas |
| Electron #2/#3 | 3.4 / 2.7MB | utility / crashpad | 已在地板，忽略 |
| （分组外） | ~30–60MB | 2× ffmpeg.exe | 当前曲 + 下一曲预加载解码进程 |

### 三个最大的结构性发现

1. **4 层全屏 `blur(96px)` 是 GPU/渲染双端第一大户**（style.css:1669/1677）。虽然模糊源图已降采样到 384px（now_playing.js `_buildBgBlurSource`），但 `filter` 是**运行时**应用在放大的全屏元素上的——Chromium 按元素全尺寸光栅化后再跑全屏模糊，每层需要源/中间/目标三份全屏纹理。384px 小图模糊后放大，与放大后再模糊**视觉完全等同**（96px 半径抹平一切细节），运行时模糊纯属浪费。
2. **PCM 音频流在 IPC 上来回跑两遍**。FFmpeg→主进程→IPC→渲染进程 WebAudio 混音→IPC→主进程→DLL→WASAPI。44.1kHz 立体声 f32 = 单向 352KB/s，且每块数据被复制 3–4 次（decoder_pool.js:79 一次拷贝、bridge.js:192 `buffer.slice` 第二次、structured clone 跨进程第三次）。~1MB/s 的持续分配churn 把主进程 external 和渲染进程堆双双撑大。
3. **`--max-old-space-size=128` 实际作用于所有进程**（main.js:68）。`js-flags` 开关会被 Chromium 传播到渲染进程子进程，代码注释"渲染进程不受此限制"是**错的**——当前渲染进程被 128MB old-space 隐性封顶，长会话下有渲染进程 OOM 崩溃的潜在风险，应改为主进程单独设限。

---

## 2. Phase 0 — 测量基建（先行，半天）

没有基线就没有优化。先建测量设施：

- **主进程**：`CARMINIUM_MEMLOG=1` 环境变量开启，每 10s 记录 `process.memoryUsage()` + `app.getAppMetrics()`（含 GPU/渲染进程分类 RSS）到 `userData/memlog.jsonl`。
- **渲染进程**：复用现有 `memory_manager.js` 的 60s 上报（`performance.memory`），补充 `performance.measureUserAgentSpecificMemory?.()`（Chromium 104+，渲染进程全量内存，含 DOM/图片/字体/合成器）。
- **统一测量口径**：同一首 4 分钟曲目、同一窗口尺寸（1152×864 与最大化各测一次）、播放 5 分钟后读数；记录启动空转、播放中、后台最小化三种状态。
- 每个 Phase 结束后出对比表，不达预期的单项回滚。

---

## 3. Phase 1 — 零风险速赢（预计 -500MB 左右）

> 全部是不改变任何行为与视觉的资源级修复。单项独立，可逐个落地验证。

### 1.1 把模糊烘进图片，删掉运行时全屏模糊 【单项最大收益：-150~-250MB（渲染+GPU）】

- **位置**：`web/style.css:1667-1681`（`.np-bg-cover-base` / `.np-bg-cover-surge` 的 `filter: blur(96px)…`）；`web/pages/now_playing.js` `_buildBgBlurSource`（已降采样 384px）。
- **改法**：在 `_buildBgBlurSource` 里用一块 384px 离屏 canvas，以 `ctx.filter = 'blur(19px) saturate(1.6) brightness(1.05)'`（19px ≈ 96px 按 384/1920 缩放等效，先铺平均色底再画避免边缘透明渗出）**一次性烘焙**基底/涌动两张图，导出 dataURL 设为 `--cover-image`。CSS 删除两处 `filter`，`inset: -14%` 过扫描可收窄到 `-4%`。
- **原理**：模糊半径 >> 源图细节，先模糊后放大与先放大后模糊视觉等同（这正是当初降采样 384px 的依据，把同一逻辑贯彻到底）。
- **额外**：鼓点动态（`--beat-scale`/`--beat-surge`）本就是 transform/opacity 合成器属性，不受影响。
- **风险**：极低。canvas 2d filter 在 Chromium 全支持；384×384 烘焙每曲一次，毫秒级。

### 1.2 正在播放封面限宽 800px 【-30~-70MB 渲染】

- **位置**：`now_playing.js:1133/1137` 用 `coverUrl(id,'max')` 加载**原始分辨率**封面（3000×3000 解码即 36MB，交叉淡入时两份）。cover-server 已支持任意尺寸缩放 + LRU（cover-server.js:88 `_resizeCover`，sharp 实现）。
- **改法**：改用 `coverUrl(id, 800)`（封面 UI 最大显示 ~400px CSS × 2 DPR 足够）。背景模糊源已是 384px，无需动。
- **风险**：无。显示尺寸不变，800px 在 2x DPR 下无像素损失。

### 1.3 字体三件套 【-40~-70MB 渲染 + 离线可用】

- **Material Symbols 子集化**：`web/fonts/material-symbols-rounded.woff2` 5.35MB 全表 3000+ 字形，实际用量 grep 全部 `material-symbols-rounded` 文本约 60–80 个图标。构建期用 `pyftsubset` 子集化到 ~50KB，解码字形缓存同步消失。
- **去掉远程 Google Fonts**（index.html:12-16）：音乐播放器不应依赖网络字体。
  - Google Sans Flex：构建期下载一次并子集化（拉丁+数字+标点，仅实际用重）自托管，或直接回退 Roboto。
  - Noto Color Emoji：Windows 自带 Segoe UI Emoji 已覆盖全部彩色 emoji（仅国旗显示为字母组合）。**两全方案**：子集化一份仅含国旗区段的 Noto Color Emoji（~1–2MB）并加 `unicode-range`，仅当内容出现国旗时才加载。两全其美，体验无损。
- **Roboto 瘦身**：16 个 .ttf 无 `unicode-range` 全量声明（style.css:7-140）。改为 woff2 拉丁子集、仅保留实际使用的 3–4 个字重，`font-display: swap`。中文走系统回退（现状即如此，Roboto 无 CJK）。

### 1.4 视频背景 canvas DPR 封顶 【0~-25MB，视屏幕】

- **位置**：`web/video_background.js:311-315`，canvas 尺寸 = 元素矩形 × **完整 devicePixelRatio**。4K/150% 缩放下全窗口 canvas 即 33MB 级后备缓冲（且在 GPU/共享内存里）。
- **改法**：DPR 封顶 1（视频内容之上还有遮罩/噪点层，且人眼对背景视频无像素级敏感度）。

### 1.5 PCM 转发减拷贝 【降churn，稳态 -10~-30MB 双端】

- **位置**：`electron/decoder_pool.js:78-80`（`new Float32Array(fa)` 拷贝）→ `electron/bridge.js:192-195`（`buffer.slice` 再拷贝）→ IPC structured clone 第三次。
- **改法**：decoder_pool 对齐后直接产出最终 ArrayBuffer（消除①），bridge 把 `float32Array.buffer`（带 byteOffset 时用视图对应的 buffer）直接交给 `webContents.send`（消除②）。Electron IPC 支持 TypedArray/ArrayBuffer structured clone。
- **风险**：低。注意确认接收端对共享/释放时序无假设（数据消费是同步的）。

### 1.6 修正 js-flags 作用域 【修复隐性 OOM 风险】

- **位置**：`main.js:68`。
- **改法**：删掉 `app.commandLine.appendSwitch('js-flags','--max-old-space-size=128')`，改为在 main.js 顶部（require electron 之前）`require('v8').setFlagsFromString('--max-old-space-size=128')`——只约束主进程 V8。渲染进程恢复 Chromium 默认堆管理。

### 1.7 sharp/libvips 缓存管制 【主进程 -20~-50MB（封面活动后）】

- **位置**：`electron/cover-server.js:62-72`（lazy require sharp，加载后常驻）。
- **改法**：加载后立即 `sharp.cache({ memory: 16, files: 0, items: 50 })`（libvips 默认操作缓存可达 50MB 级）+ `sharp.concurrency(1)`。`_resizeCache`（Map, 300 条 JPEG buffer）维持现状即可。

### 1.8 Chromium 功能裁剪开关 【主进程 -10~-30MB】

在 `main.js` 现有 `disable-features` 基础上追加（均需逐项回归）：

```js
app.commandLine.appendSwitch('disable-features',
  'Translate,BackForwardCache,' +              // 现有
  'MediaRouter,' +                             // 投屏发现服务，本应用无 Cast
  'OptimizationHints,AutofillServerCommunication,' + // 表单/自动填云服务
  'SpeechRecognitionOnDevice,VoiceTranscription');   // 语音服务
app.commandLine.appendSwitch('disk-cache-size', 8 * 1024 * 1024);   // HTTP 磁盘缓存
app.commandLine.appendSwitch('media-cache-size', 8 * 1024 * 1024);  // <video> 背景缓存
```

- **注意**：`HardwareMediaKeyHandling,MediaSessionService` 是 SMTC 的命根子，**绝对不能动**。
- 可选：`--disable-breakpad` 省掉 crashpad 2.7MB（代价：失去崩溃转储，建议保留）。

### 1.9 cover-server 缓存头修正

- **位置**：`cover-server.js:220/231` `Cache-Control: no-cache, no-store, must-revalidate`，`index.html:8-10` 同样全局禁缓存。
- **改法**：封面响应改为 `Cache-Control: private, max-age=3600`（trackId 寻址，内容不变），让 Chromium HTTP 缓存命中，减少重复解码/传输。渲染进程自己的 CoverCache LRU（40×300px）保留。

---

## 4. Phase 2 — 结构性优化（感知等价，预计再 -100~-150MB）

### 2.1 恢复 GPU 进程合并 【-30~-60MB】

- **改法**：`app.commandLine.appendSwitch('in-process-gpu')`。GPU 进程并入浏览器进程，省一份进程基线（V8/沙箱/共享代码页）。历史记忆显示该开关曾启用、后被移除——先查清当初移除原因；若有稳定性顾虑，放在 Phase 2 单独验证（GPU 崩溃会带走整个应用，Chromium 会自动软件回退，实测可接受）。
- 可选追加：`--enable-features=NetworkServiceInProcess` 合并 utility 进程（-3MB，收益小，顺手）。

### 2.2 渲染进程合成层审计 【-20~-50MB GPU/渲染】

- 1.1 之后继续清理过度提升：`will-change` 全项目只剩 5 处，其中 3 处在全屏背景链上（`.np-bg-covers` / `.np-bg-cover` / 内层）。交叉淡入的 `will-change: opacity` 改为**过渡期间由 JS 临时挂上、过渡结束移除**，静态期不占独立合成层。
- `.np-lyrics-line` 的 `will-change: opacity, filter`（style.css:2581）对每行生效，可见 ~15 行即 ~15 个合成层。改为仅激活行±2 行挂 `will-change`（JS 随 `_updateLyrics` 维护），其余行静态。
- 收益与 1.1 部分重叠，合计计算。

### 2.3 歌词 DOM 虚拟化 【-5~-15MB + 光栅压力】

- **位置**：`now_playing.js:1262-1473` 全曲歌词一次性插入 DOM，逐字 span（一首歌数千节点）。
- **改法**：行级窗口化——只实例化激活行 ±20 行，滚动时回收/重建（项目已有成熟 `virtual_list.js` 对象池可借鉴）。逐字动画逻辑不变，仅作用于窗口内行。渐进模糊 `_applyProgressiveBlurToLines` 同步改为窗口内计算。
- **风险**：中。歌词交互（点击跳转、滚动跟随）需全量回归；建议加开关灰度。

### 2.4 全量曲目数据改窗口化读取 【-10~-30MB 渲染】

- **位置**：`app.js:105-109` `App.state.allTracks` 全量 JSON 驻留。主进程 better-sqlite3 里本来就有全部数据，这是双份驻留。
- **改法**：VirtualList 已支持按需取数，把 `allTracks` 换成"总数 + 窗口查询"IPC（`library.getTracksRange(offset, limit, sortKey)`）。万级曲库下省 10–30MB JS 堆，并消除启动时大 JSON.parse 尖峰。
- **风险**：中。排序/筛选路径都要改走查询，需完整回归列表交互。

### 2.5 队列/专辑网格虚拟化 + i18n 懒加载 【-3~-8MB】

- `now_playing.js:2526-2576` 队列面板全量渲染 → 复用 virtual_list。
- `albums.js:262-300` 专辑网格一次性 innerHTML → 网格虚拟化（img 已 lazy，主要省 DOM）。
- `i18n.js` 173KB 全语言单包 → 按当前语言加载 + 切换时动态取（-1~2MB，顺带加快启动）。
- 删除死文件 `web/gsap.min.js`（72KB，全工程无引用；包体卫生）。

---

## 5. Phase 3 — 深度注入（参考网易云思路的 Electron 等价物，预计再 -50~-100MB+）

> 网易云的做法 = 裁剪多进程 + 原生接管热路径。Electron 不能裁 Chromium 本体，但可以把**音频热路径整体下沉到原生层**，同时消灭最大的持续内存churn源。

### 3.1 零拷贝 PCM 共享内存环 【消灭 ~0.7MB/s 双向 IPC churn】

- **现状**：FFmpeg→主进程→IPC→渲染进程（混音）→IPC→主进程→DLL，每块 PCM 3–4 次拷贝（见 1.5，Phase 1 先减到 2 次）。
- **方案**：利用已在用的 `carminium_audio.dll` + koffi，在 DLL 内 `CreateFileMapping` 建命名共享内存环（双环：decode 环 + output 环）；渲染进程 preload（有 Node 能力）用 koffi `OpenFileMapping`+`MapViewOfFile` 映射同一区段。
  - 下行：FFmpeg PCM → 主进程直接写入 decode 环 → preload 侧 RingReader 喂给 StreamingPCMProcessor（替代 `audio_pcm_main/next` IPC）。
  - 上行：output-capture worklet → preload RingWriter → DLL 直接消费（替代 `audio_output` IPC）。
- **效果**：两进程 external/arrayBuffers 持续churn归零，V8 堆稳定在低位；附带省 CPU。
- **风险**：中高。需要 DLL 侧新增导出（映射创建/读写指针/水位通知机制，沿用现有事件通道发"有数据"信号，数据本身不走 IPC）。建议先在下行链路做 PoC。

### 3.2 miniaudio 原生解码接管常见格式 【-30~-60MB（系统总量）】

- **现状**：每曲一个 ffmpeg.exe 子进程（双槽位两个），各自 15–30MB RSS，且全部解码经管道进 Node。
- **方案**：miniaudio（已在 DLL 里）内置 dr_mp3/dr_flac/dr_wav，可选 stb_vorbis——直接覆盖 MP3/FLAC/WAV/OGG 主流格式。DLL 内解码直写 3.1 的共享环，**常见格式零子进程**。APE/WMA/DSD 等长尾格式回退 FFmpeg（保留 DecoderPool 现状）。
- **联动收益**：解码在主进程内完成，seek/预载延迟同步改善；`_probeDuration` 的 ffprobe 调用也可由 miniaudio 元数据替代。
- **风险**：中高。需对齐现有 44.1k 输出格式、GAPLESS 语义、seek 精度。按格式灰度（先 FLAC/MP3）。

### 3.3 主进程模块按需加载

- `music-metadata`、`subsonic`、`lyrics`、`osu_beatmap_provider` 等改为首次使用时 require；`analysis_cache`/`sortkey` 同理。主进程启动基线 -10~20MB，启动更快。

### 3.4 AudioBufferCache 降档

- `web/audio_buffer_cache.js` LRU 40MB → 24MB（保留当前+下一曲完整驻留，历史曲目让位给 streaming 重解码）。memory_manager.js:179 的 60/40 阈值同步下调到 36/24。

---

## 6. Phase 4 — 核选项：换壳（唯一通向 ~160MB 的路径）

保留 `web/` 全部 UI 与交互代码（零框架纯 JS，迁移成本低），仅替换宿主壳：

| 方案 | 预计总量 | 说明 |
|---|---|---|
| **Tauri 2（WebView2）** | ~150–250MB | WebView2 运行时系统共享，进程组小；bridge/preload 的 IPC 层需用 Rust 重写（library/player/wasapi/SMTC 逻辑已是模块化 CommonJS，可平移为 Rust 侧或保留 Node sidecar）。SMTC 在 Windows 有成熟 API。工程量最大但天花板最低。 |
| **自研裁剪 CEF**（网易云路线） | ~120–200MB | 编译期裁掉 Chromium 大半模块；工程量以月计，维护成本高，不推荐现阶段考虑。 |
| 维持 Electron + Phase 3 | ~330–420MB | 工程风险最低，性价比最高的终点。 |

**建议路线**：Phase 0→1→2→3 顺序执行（每阶段独立可发布），到达 ~350–420MB 后评估是否值得为最后 200MB 换壳。

---

## 7. 验证与回归

**功能回归清单**（每 Phase 后必跑）：
- 播放/暂停/seek/gapless/crossfade（含 APE、WMA 等 FFmpeg 独占格式）
- 独占/共享 WASAPI 模式切换、采样率切换
- 逐字歌词（含翻译/罗马音/偏移/渐进模糊/居中开关）、点击跳转
- 背景交叉淡入 + 鼓点脉动 + 视频背景
- 全窗口/全屏/迷你/浮动窗口切换
- 封面（内嵌/Subsonic/无封面占位）、SMTC 元数据与按键
- 万级曲库列表滚动/排序/筛选、专辑/艺术家/文件夹页
- 后台最小化恢复、单实例、开机状态恢复

**内存验收**：按 Phase 0 口径三状态读数，对比基线表；24 小时挂机 soak 确认无单调增长（泄漏）。

**回滚**：每项优化独立 commit；1.1/2.3/2.4/3.x 均加运行时开关（settings 表），异常时可热回退。

---

## 附：文件级索引（改动点速查）

| 文件 | 行 | 事项 |
|---|---|---|
| web/style.css | 1667–1681 | 删运行时 blur(96px)，改烘焙图 |
| web/style.css | 7–140 | 19 个 @font-face 子集化 + unicode-range |
| web/style.css | 2581 | 歌词行 will-change 收窄 |
| web/pages/now_playing.js | 415–461 | _buildBgBlurSource 内烘焙滤镜 |
| web/pages/now_playing.js | 1133/1137 | 封面 'max' → 800 |
| web/pages/now_playing.js | 1262–1473 | 歌词 DOM 窗口化 |
| web/pages/now_playing.js | 2526–2576 | 队列虚拟化 |
| web/index.html | 12–16 | 去远程 Google Fonts |
| web/index.html | 8–10 | 放开 HTTP 缓存 |
| web/video_background.js | 311–315 | canvas DPR ≤1 |
| web/audio_buffer_cache.js | 13 | 40MB → 24MB |
| web/app.js | 105–109 | allTracks 窗口化查询 |
| electron/main.js | 68 | js-flags → v8.setFlagsFromString（主进程only） |
| electron/main.js | 46–48 | disable-features 扩充 + in-process-gpu |
| electron/bridge.js | 190–202 | PCM 转发减一次拷贝 |
| electron/decoder_pool.js | 69–81 | 对齐后直接产出最终 ArrayBuffer |
| electron/cover-server.js | 62–72 | sharp.cache/concurrency 管制 |
| electron/cover-server.js | 220/231 | 缓存头 no-store → max-age |
| native/carminium_audio（zig） | 新增 | 共享内存环 + miniaudio 解码导出 |
