//! Carminium — WASAPI ネイティブオーディオ DLL (Zig + miniaudio + SoundTouch)
//!
//! 音声管線:
//!   JS (ffmpeg decode) → ca_push_pcm() → 入力リングバッファ (f32)
//!     → dataCallback: SoundTouch (tempo/pitch) → 出力バッファ → WASAPI
//!
//! 共有モードと排他モードの両方をサポート。pitch/tempo/rate は SoundTouch で
//! リアルタイム処理される。PCM は常に f32 interleaved。

const std = @import("std");

const c = @cImport({
    @cDefine("MA_NO_ENCODING", "");
    @cDefine("MA_NO_GENERATION", "");
    @cDefine("MA_NO_DECODING", "");
    @cInclude("miniaudio.h");
});

const st = @cImport({
    @cInclude("soundtouch_wrapper.h");
});

// ── 定数 ────────────────────────────────────────────────────────────────────

/// 入力リングバッファサイズ（8MB、2 の累乗必須）。
/// 192kHz/2ch/f32 で約 5.4 秒分。
const RING_SIZE: u64 = 8 * 1024 * 1024;
const RING_MASK: u64 = RING_SIZE - 1;

/// SoundTouch への一度の入力チャンク上限（フレーム）。
const ST_INPUT_CHUNK: u32 = 4096;

// ── 共有モード定数 ──────────────────────────────────────────────────────────

pub const SHARE_SHARED: i32 = 0;
pub const SHARE_EXCLUSIVE: i32 = 1;

// ── グローバル状態 ──────────────────────────────────────────────────────────

var g_device: c.ma_device = undefined;
var g_context: c.ma_context = undefined;
var g_has_context: bool = false;
var g_initialized: bool = false;
var g_playing: bool = false;
var g_volume: f32 = 1.0;
var g_share_mode: i32 = SHARE_EXCLUSIVE;

var g_sample_rate: u32 = 0;
var g_channels: u16 = 0;
// PCM は常に f32 (SoundTouch 要件)
var g_bytes_per_frame: u32 = 0;

/// 入力リングバッファ（JS スレッドが書き込み、audio スレッドが読み取り）
var g_ring: [RING_SIZE]u8 = undefined;
var g_ring_w: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);
var g_ring_r: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);

/// 消費済み入力フレーム数（位置追跡用）
var g_frames_consumed: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);

/// 次曲プリロード用リングバッファ（AutoMix）
var g_ring_next: [RING_SIZE]u8 = undefined;
var g_ring_next_w: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);
var g_ring_next_r: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);

/// AutoMix クロスフェード状態
var g_crossfading: bool = false;
var g_cf_total_frames: u64 = 0;     // クロスフェード全フレーム数
var g_cf_current_frame: u64 = 0;    // 現在のフェード位置
var g_cf_completed_flag: std.atomic.Value(i32) = std.atomic.Value(i32).init(0); // 完了フラグ（JS 側読み取り用）

/// Gapless モードフラグ
var g_gapless_enabled: bool = false;

/// クロスフェード処理中の一時バッファ
var g_cf_tmp_main: [ST_INPUT_CHUNK * 32]f32 = undefined;
var g_cf_tmp_next: [ST_INPUT_CHUNK * 32]f32 = undefined;

/// SoundTouch インスタンス
var g_st_handle: ?*anyopaque = null;
var g_tempo: f32 = 1.0;
var g_pitch: f32 = 1.0;
var g_rate: f32 = 1.0;

/// SoundTouch 出力の一時バッファ（dataCallback 内で使用）
var g_st_out_buf: [ST_INPUT_CHUNK * 32]f32 = undefined; // 余裕を持たせる

// ── miniaudio データコールバック ────────────────────────────────────────────

fn dataCallback(
    pDevice: ?*c.ma_device,
    pOutput: ?*anyopaque,
    pInput: ?*const anyopaque,
    frameCount: c.ma_uint32,
) callconv(.c) void {
    _ = pDevice;
    _ = pInput;

    if (pOutput == null) return;

    const out: [*]f32 = @ptrCast(@alignCast(pOutput.?));
    const frames_needed: u32 = frameCount;
    var frames_written: u32 = 0;

    // tempo/pitch/rate がすべて 1.0 なら SoundTouch をバイパス
    const st_bypass = g_tempo == 1.0 and g_pitch == 1.0 and g_rate == 1.0;

    if (g_crossfading and st_bypass) {
        frames_written = renderCrossfade(out, frames_needed);
    } else if (g_st_handle != null and !st_bypass) {
        const handle = g_st_handle.?;
        while (frames_written < frames_needed) {
            const want = frames_needed - frames_written;
            const max_take = @min(want, ST_INPUT_CHUNK);
            const got = st.st_receive_samples(handle, &g_st_out_buf[0], max_take);

            if (got > 0) {
                const dst = out + frames_written * g_channels;
                const src = &g_st_out_buf[0];
                const samples = got * @as(u32, g_channels);
                @memcpy(@as([*]u8, @ptrCast(dst))[0 .. samples * 4],
                        @as([*]const u8, @ptrCast(src))[0 .. samples * 4]);
                frames_written += got;
                continue;
            }

            const input_frames = readFromRingToF32(ST_INPUT_CHUNK);
            if (input_frames == 0) {
                break;
            }
            _ = st.st_put_samples(handle, &g_st_in_buf[0], input_frames);
        }
    } else {
        const input_frames = readRingToF32Direct(out, frames_needed);
        frames_written = input_frames;

        // Gapless: メインバッファが尽きて次バッファにデータがあれば即時切り替え
        if (frames_written == 0 and g_gapless_enabled) {
            const next_buffered = ca_get_next_buffered_bytes();
            if (next_buffered > 0) {
                swapRings();
                g_cf_completed_flag.store(1, .release);
                // 切り替え後、新しいメインバッファから読み直し
                const retry_frames = readRingToF32Direct(out, frames_needed);
                frames_written = retry_frames;
            }
        }
    }

    // アンダーラン部分を無音で埋める
    if (frames_written < frames_needed) {
        const start_sample = frames_written * g_channels;
        const end_sample = frames_needed * g_channels;
        var i: u32 = start_sample;
        while (i < end_sample) : (i += 1) {
            out[i] = 0.0;
        }
    }

    // 音量適用
    if (g_volume < 1.0) {
        applyVolume(out[0 .. @as(usize, frames_needed) * g_channels], g_volume);
    }
}

/// SoundTouch 入力用の一時バッファ（f32 変換用）
var g_st_in_buf: [ST_INPUT_CHUNK * 32]f32 = undefined;

/// リングバッファから f32 データを ST_INPUT_CHUNK フレーム読み出し、
/// g_st_in_buf に格納する。実際に読めたフレーム数を返す。
fn readFromRingToF32(max_frames: u32) u32 {
    const bytes_per_frame = g_bytes_per_frame;
    const want_bytes = @as(u64, max_frames) * bytes_per_frame;

    const wp = g_ring_w.load(.acquire);
    const rp = g_ring_r.load(.acquire);
    const available = wp -% rp;
    const to_read_bytes = @min(want_bytes, available);
    const to_read_frames: u32 = @intCast(to_read_bytes / bytes_per_frame);
    if (to_read_frames == 0) return 0;

    // リングバッファから g_st_in_buf へコピー
    const dst_bytes = to_read_frames * bytes_per_frame;
    var read: u64 = 0;
    while (read < dst_bytes) {
        const pos = @as(usize, @intCast((rp + read) & RING_MASK));
        const chunk = @min(dst_bytes - read, RING_SIZE - @as(u64, pos));
        @memcpy(
            @as([*]u8, @ptrCast(&g_st_in_buf[0]))[read .. read + @as(usize, @intCast(chunk))],
            g_ring[pos .. pos + @as(usize, @intCast(chunk))],
        );
        read += chunk;
    }

    g_ring_r.store(rp + dst_bytes, .release);
    _ = g_frames_consumed.fetchAdd(to_read_frames, .monotonic);
    return to_read_frames;
}

/// リングバッファから直接出力バッファへ f32 をコピー（SoundTouch 未使用時）。
/// 実際に書き込んだフレーム数を返す。
fn readRingToF32Direct(out: [*]f32, max_frames: u32) u32 {
    const bytes_per_frame = g_bytes_per_frame;
    const want_bytes = @as(u64, max_frames) * bytes_per_frame;

    const wp = g_ring_w.load(.acquire);
    const rp = g_ring_r.load(.acquire);
    const available = wp -% rp;
    const to_read_bytes = @min(want_bytes, available);
    const to_read_frames: u32 = @intCast(to_read_bytes / bytes_per_frame);
    if (to_read_frames == 0) return 0;

    const dst: [*]u8 = @ptrCast(out);
    var read: u64 = 0;
    while (read < to_read_bytes) {
        const pos = @as(usize, @intCast((rp + read) & RING_MASK));
        const chunk = @min(to_read_bytes - read, RING_SIZE - @as(u64, pos));
        @memcpy(
            dst[read .. read + @as(usize, @intCast(chunk))],
            g_ring[pos .. pos + @as(usize, @intCast(chunk))],
        );
        read += chunk;
    }

    g_ring_r.store(rp + to_read_bytes, .release);
    _ = g_frames_consumed.fetchAdd(to_read_frames, .monotonic);
    return to_read_frames;
}

fn applyVolume(buf: []f32, vol: f32) void {
    var i: usize = 0;
    while (i < buf.len) : (i += 1) {
        buf[i] *= vol;
    }
}

/// 次曲リングバッファから直接 f32 を読み出す
fn readNextRingToF32Direct(out: [*]f32, max_frames: u32) u32 {
    const bytes_per_frame = g_bytes_per_frame;
    const want_bytes = @as(u64, max_frames) * bytes_per_frame;

    const wp = g_ring_next_w.load(.acquire);
    const rp = g_ring_next_r.load(.acquire);
    const available = wp -% rp;
    const to_read_bytes = @min(want_bytes, available);
    const to_read_frames: u32 = @intCast(to_read_bytes / bytes_per_frame);
    if (to_read_frames == 0) return 0;

    const dst: [*]u8 = @ptrCast(out);
    var read: u64 = 0;
    while (read < to_read_bytes) {
        const pos = @as(usize, @intCast((rp + read) & RING_MASK));
        const chunk = @min(to_read_bytes - read, RING_SIZE - @as(u64, pos));
        @memcpy(
            dst[read .. read + @as(usize, @intCast(chunk))],
            g_ring_next[pos .. pos + @as(usize, @intCast(chunk))],
        );
        read += chunk;
    }

    g_ring_next_r.store(rp + to_read_bytes, .release);
    return to_read_frames;
}

/// クロスフェードレンダリング
/// メインバッファをフェードアウト、次バッファをフェードインして加算混合
/// 完了したらバッファを入れ替える
fn renderCrossfade(out: [*]f32, frames_needed: u32) u32 {
    const channels = g_channels;
    var frames_done: u32 = 0;

    while (frames_done < frames_needed) {
        const remain: u32 = frames_needed - frames_done;
        const chunk: u32 = @min(remain, ST_INPUT_CHUNK);

        // 両バッファから読み出し
        const main_got = readRingToF32Direct(g_cf_tmp_main[0..].ptr, chunk);
        const next_got = readNextRingToF32Direct(g_cf_tmp_next[0..].ptr, chunk);

        // 両方 0 ならアンダーランで終了
        if (main_got == 0 and next_got == 0) break;

        const actual = @max(main_got, next_got);

        // 不足分を 0 埋め
        if (main_got < actual) {
            var i = main_got * channels;
            const end = actual * channels;
            while (i < end) : (i += 1) g_cf_tmp_main[i] = 0.0;
        }
        if (next_got < actual) {
            var i = next_got * channels;
            const end = actual * channels;
            while (i < end) : (i += 1) g_cf_tmp_next[i] = 0.0;
        }

        // フェードカーブ計算 + 混合
        const cf_total = g_cf_total_frames;
        var f: u32 = 0;
        while (f < actual) : (f += 1) {
            const progress: f32 = if (cf_total > 0)
                @as(f32, @floatFromInt(g_cf_current_frame)) / @as(f32, @floatFromInt(cf_total))
            else
                1.0;

            // 等パワークロスフェードカーブ
            const main_gain = @cos(progress * std.math.pi / 2.0);
            const next_gain = @sin(progress * std.math.pi / 2.0);

            var ch: u16 = 0;
            while (ch < channels) : (ch += 1) {
                const idx = (frames_done + f) * channels + ch;
                const tmp_idx = f * channels + ch;
                out[idx] = g_cf_tmp_main[tmp_idx] * main_gain + g_cf_tmp_next[tmp_idx] * next_gain;
            }

            g_cf_current_frame += 1;
            if (g_cf_current_frame >= cf_total) {
                // クロスフェード完了: バッファを入れ替える
                swapRings();
                g_crossfading = false;
                g_cf_completed_flag.store(1, .release);
                // フェード完了、残りフレームは通常パスで処理するためループ脱出
                // （呼び出し元で残りは無音埋めされるが、ここまで来たら殆どの場合完了済み）
                frames_done += f + 1;
                return frames_done;
            }
        }

        frames_done += actual;
    }

    return frames_done;
}

/// メインバッファと次バッファを入れ替える（ポインタスワップ方式ではなく
/// データをコピーする方式。実行頻度が低いため簡潔さ優先。）
fn swapRings() void {
    // 次バッファのデータをメインバッファの先頭にコピーする
    const next_w = g_ring_next_w.load(.monotonic);
    const next_r = g_ring_next_r.load(.monotonic);
    const next_used = next_w -% next_r;

    // 次バッファの残りデータをメインバッファの先頭にコピー
    if (next_used > 0) {
        var src_rp = next_r;
        var dst_wp: u64 = 0;
        const to_copy = next_used;
        var copied: u64 = 0;
        while (copied < to_copy) {
            const src_pos = @as(usize, @intCast(src_rp & RING_MASK));
            const dst_pos = @as(usize, @intCast(dst_wp & RING_MASK));
            const src_chunk = @min(to_copy - copied, RING_SIZE - @as(u64, src_pos));
            const dst_chunk = @min(to_copy - copied, RING_SIZE - @as(u64, dst_pos));
            const chunk = @min(src_chunk, dst_chunk);
            @memcpy(
                g_ring[dst_pos .. dst_pos + @as(usize, @intCast(chunk))],
                g_ring_next[src_pos .. src_pos + @as(usize, @intCast(chunk))],
            );
            src_rp += chunk;
            dst_wp += chunk;
            copied += chunk;
        }
        g_ring_w.store(to_copy, .release);
        g_ring_r.store(0, .release);
    } else {
        g_ring_w.store(0, .release);
        g_ring_r.store(0, .release);
    }

    // 次バッファをクリア
    g_ring_next_w.store(0, .release);
    g_ring_next_r.store(0, .release);

    // フレームカウンタはリセット（JS 側で新しいトラックの位置に更新される）
    g_frames_consumed.store(0, .release);
}

// ── エクスポート C API ──────────────────────────────────────────────────────

/// デバイスを初期化する
/// share_mode: 0 = 共有, 1 = 排他
/// device_index: -1 = デフォルト
/// sample_rate, channels: 0 = デバイスネイティブ
/// 戻り値: 0 = 成功、負 = エラー
export fn ca_init(
    share_mode: i32,
    device_index: i32,
    sample_rate: u32,
    channels: u16,
) i32 {
    if (g_initialized) return -1;

    g_share_mode = if (share_mode == SHARE_EXCLUSIVE) SHARE_EXCLUSIVE else SHARE_SHARED;
    const ch: u32 = if (channels == 0) 2 else @as(u32, channels);

    // PCM は常に f32 (SoundTouch 要件)
    const format = c.ma_format_f32;
    g_bytes_per_frame = ch * 4;

    // コンテキスト初期化
    if (c.ma_context_init(null, 0, null, &g_context) != c.MA_SUCCESS) {
        return -3;
    }
    g_has_context = true;

    // デバイス ID 検索（指定インデックスの場合）
    var device_id: c.ma_device_id = std.mem.zeroes(c.ma_device_id);
    var has_device_id: bool = false;

    if (device_index >= 0) {
        var playback_infos: [*c]c.ma_device_info = null;
        var playback_count: c.ma_uint32 = 0;
        if (c.ma_context_get_devices(&g_context, &playback_infos, &playback_count, null, null) == c.MA_SUCCESS) {
            const idx: u32 = @intCast(device_index);
            if (idx < playback_count) {
                device_id = playback_infos[idx].id;
                has_device_id = true;
            }
        }
    }

    // デバイス設定
    var config = c.ma_device_config_init(c.ma_device_type_playback);
    config.playback.format = format;
    config.playback.channels = ch;
    config.sampleRate = sample_rate;
    config.dataCallback = dataCallback;
    config.pUserData = null;
    config.playback.shareMode = if (g_share_mode == SHARE_EXCLUSIVE)
        c.ma_share_mode_exclusive
    else
        c.ma_share_mode_shared;

    // 排他モード時はイベント駆動で低遅延化（可能なら）
    if (g_share_mode == SHARE_EXCLUSIVE) {
        config.periodSizeInFrames = 0;  // デフォルト
        config.periods = 0;             // デフォルト
    }

    if (has_device_id) {
        config.playback.pDeviceID = &device_id;
    }

    // デバイス初期化
    const result = c.ma_device_init(&g_context, &config, &g_device);
    if (result != c.MA_SUCCESS) {
        _ = c.ma_context_uninit(&g_context);
        g_has_context = false;
        return @intCast(result);
    }

    // 実際の形式を取得
    g_sample_rate = g_device.sampleRate;
    g_channels = @intCast(g_device.playback.channels);
    g_bytes_per_frame = @as(u32, g_channels) * 4;

    // SoundTouch インスタンス作成
    g_st_handle = st.st_create(g_sample_rate, g_channels);
    if (g_st_handle == null) {
        _ = c.ma_device_uninit(&g_device);
        _ = c.ma_context_uninit(&g_context);
        g_has_context = false;
        return -4;
    }
    st.st_set_tempo(g_st_handle.?, g_tempo);
    st.st_set_pitch(g_st_handle.?, g_pitch);
    st.st_set_rate(g_st_handle.?, g_rate);

    // 状態リセット
    g_ring_w.store(0, .monotonic);
    g_ring_r.store(0, .monotonic);
    g_frames_consumed.store(0, .monotonic);
    g_ring_next_w.store(0, .monotonic);
    g_ring_next_r.store(0, .monotonic);
    g_crossfading = false;
    g_cf_total_frames = 0;
    g_cf_current_frame = 0;
    g_cf_completed_flag.store(0, .monotonic);
    g_gapless_enabled = false;

    g_initialized = true;
    return 0;
}

/// 再生開始
export fn ca_start() i32 {
    if (!g_initialized) return -1;
    const result = c.ma_device_start(&g_device);
    if (result == c.MA_SUCCESS) {
        g_playing = true;
        return 0;
    }
    return @intCast(result);
}

/// 再生停止
export fn ca_stop() i32 {
    if (!g_initialized) return -1;
    const result = c.ma_device_stop(&g_device);
    if (result == c.MA_SUCCESS) {
        g_playing = false;
        return 0;
    }
    return @intCast(result);
}

/// PCM データをリングバッファにプッシュ（f32 interleaved 想定）
/// 戻り値: 0 = 成功、-1 = 未初期化、-2 = バッファフル
export fn ca_push_pcm(data: [*]const u8, len: u32) i32 {
    if (!g_initialized) return -1;

    const wp = g_ring_w.load(.acquire);
    const rp = g_ring_r.load(.acquire);
    const used = wp -% rp;
    const available = RING_SIZE - used;

    if (@as(u64, len) > available) return -2;

    var written: u64 = 0;
    while (written < @as(u64, len)) {
        const pos = @as(usize, @intCast((wp + written) & RING_MASK));
        const chunk = @min(@as(u64, len) - written, RING_SIZE - @as(u64, pos));
        @memcpy(
            g_ring[pos .. pos + @as(usize, @intCast(chunk))],
            data[@as(usize, @intCast(written)) .. @as(usize, @intCast(written + chunk))],
        );
        written += chunk;
    }

    g_ring_w.store(wp + @as(u64, len), .release);
    return 0;
}

/// 音量設定 (0.0 - 1.0)
export fn ca_set_volume(vol: f32) void {
    g_volume = @max(0.0, @min(1.0, vol));
}

/// tempo 設定 (1.0 = 原速)。リアルタイム反映。
export fn ca_set_tempo(tempo: f32) void {
    g_tempo = @max(0.25, @min(4.0, tempo));
    if (g_st_handle) |h| st.st_set_tempo(h, g_tempo);
}

/// pitch 設定 (1.0 = 原調)
export fn ca_set_pitch(pitch: f32) void {
    g_pitch = @max(0.25, @min(4.0, pitch));
    if (g_st_handle) |h| st.st_set_pitch(h, g_pitch);
}

/// rate 設定 (1.0 = 原速原調, テープ風エフェクト)
export fn ca_set_rate(rate: f32) void {
    g_rate = @max(0.25, @min(4.0, rate));
    if (g_st_handle) |h| st.st_set_rate(h, g_rate);
}

/// 消費済みフレーム数を取得
export fn ca_get_consumed_frames() u64 {
    return g_frames_consumed.load(.monotonic);
}

/// リングバッファ内の未再生バイト数
export fn ca_get_buffered_bytes() u32 {
    const wp = g_ring_w.load(.acquire);
    const rp = g_ring_r.load(.acquire);
    return @intCast(wp -% rp);
}

/// SoundTouch の出力に残っているフレーム数（位置計算の補正用）
export fn ca_get_st_latency_frames() u32 {
    if (g_st_handle) |h| {
        return st.st_num_samples(h);
    }
    return 0;
}

/// リングバッファとフレームカウンタをクリア（シーク時）
/// SoundTouch の内部バッファもクリアする
export fn ca_clear_buffer() void {
    g_ring_w.store(0, .monotonic);
    g_ring_r.store(0, .monotonic);
    g_frames_consumed.store(0, .monotonic);
    if (g_st_handle) |h| st.st_clear(h);
}

// ── AutoMix / クロスフェード API ───────────────────────────────────────────

/// 次曲の PCM をプリロードバッファにプッシュ
/// 戻り値: 0 = 成功、-1 = 未初期化、-2 = バッファフル
export fn ca_push_next_pcm(data: [*]const u8, len: u32) i32 {
    if (!g_initialized) return -1;

    const wp = g_ring_next_w.load(.acquire);
    const rp = g_ring_next_r.load(.acquire);
    const used = wp -% rp;
    const available = RING_SIZE - used;

    if (@as(u64, len) > available) return -2;

    var written: u64 = 0;
    while (written < @as(u64, len)) {
        const pos = @as(usize, @intCast((wp + written) & RING_MASK));
        const chunk = @min(@as(u64, len) - written, RING_SIZE - @as(u64, pos));
        @memcpy(
            g_ring_next[pos .. pos + @as(usize, @intCast(chunk))],
            data[@as(usize, @intCast(written)) .. @as(usize, @intCast(written + chunk))],
        );
        written += chunk;
    }

    g_ring_next_w.store(wp + @as(u64, len), .release);
    return 0;
}

/// プリロードバッファをクリア
export fn ca_clear_next_buffer() void {
    g_ring_next_w.store(0, .monotonic);
    g_ring_next_r.store(0, .monotonic);
}

/// プリロードバッファの未再生バイト数
export fn ca_get_next_buffered_bytes() u32 {
    const wp = g_ring_next_w.load(.acquire);
    const rp = g_ring_next_r.load(.acquire);
    return @intCast(wp -% rp);
}

/// クロスフェードを開始する
/// duration_ms: フェード時間（ミリ秒）
/// 戻り値: 0 = 成功、-1 = 未初期化、-2 = 次曲バッファが空
export fn ca_start_crossfade(duration_ms: u32) i32 {
    if (!g_initialized) return -1;

    const next_buffered = ca_get_next_buffered_bytes();
    if (next_buffered == 0) return -2;

    // クロスフェードフレーム数を計算
    const total_frames = @as(u64, g_sample_rate) * @as(u64, duration_ms) / 1000;
    if (total_frames == 0) return -2;

    g_cf_total_frames = total_frames;
    g_cf_current_frame = 0;
    g_cf_completed_flag.store(0, .release);
    g_crossfading = true;

    return 0;
}

/// クロスフェード中かどうか
export fn ca_is_crossfading() i32 {
    return if (g_crossfading) 1 else 0;
}

/// クロスフェード完了フラグを取得してリセット
/// 戻り値: 1 = 完了していた、0 = 未完了
export fn ca_check_crossfade_completed() i32 {
    return g_cf_completed_flag.swap(0, .acq_rel);
}

/// Gapless モードを有効/無効にする
/// 有効時はメインバッファが尽きると自動的に次バッファに切り替わる
export fn ca_set_gapless_enabled(enabled: i32) void {
    g_gapless_enabled = enabled != 0;
}

/// Gapless モードかどうか
export fn ca_get_gapless_enabled() i32 {
    return if (g_gapless_enabled) 1 else 0;
}

/// Gapless 即時切り替え: 次バッファに即時スワップする（手動トリガー用）
/// （クロスフェードなし、単なるバッファ入れ替え）
/// 戻り値: 0 = 成功、-1 = 未初期化、-2 = 次バッファが空
export fn ca_gapless_switch() i32 {
    if (!g_initialized) return -1;

    const next_buffered = ca_get_next_buffered_bytes();
    if (next_buffered == 0) return -2;

    swapRings();
    g_cf_completed_flag.store(1, .release);

    return 0;
}

/// 実際のサンプルレート
export fn ca_get_sample_rate() u32 {
    return g_sample_rate;
}

/// 実際のチャンネル数
export fn ca_get_channels() u16 {
    return g_channels;
}

/// ビット深度（常に 32bit float）
export fn ca_get_bits_per_sample() u16 {
    return 32;
}

/// 共有モード (0=shared, 1=exclusive)
export fn ca_get_share_mode() i32 {
    return g_share_mode;
}

/// 再生中か
export fn ca_is_playing() i32 {
    return if (g_playing) 1 else 0;
}

/// クリーンアップ
export fn ca_close() void {
    if (!g_initialized) return;
    _ = c.ma_device_stop(&g_device);
    c.ma_device_uninit(&g_device);
    if (g_has_context) {
        _ = c.ma_context_uninit(&g_context);
        g_has_context = false;
    }
    if (g_st_handle) |h| {
        st.st_destroy(h);
        g_st_handle = null;
    }
    g_initialized = false;
    g_playing = false;
    g_ring_w.store(0, .monotonic);
    g_ring_r.store(0, .monotonic);
    g_frames_consumed.store(0, .monotonic);
    g_ring_next_w.store(0, .monotonic);
    g_ring_next_r.store(0, .monotonic);
    g_crossfading = false;
    g_cf_total_frames = 0;
    g_cf_current_frame = 0;
    g_cf_completed_flag.store(0, .monotonic);
    g_gapless_enabled = false;
}

// ── デバイス列挙 ────────────────────────────────────────────────────────────

var g_devices_json: ?[*:0]u8 = null;

/// 再生デバイスを列挙し JSON 文字列を返す
/// {"devices":[{"index":0,"name":"..."}],"default_index":0}
export fn ca_enumerate_devices() ?[*:0]const u8 {
    if (g_devices_json) |ptr| {
        std.heap.c_allocator.free(std.mem.span(ptr));
        g_devices_json = null;
    }

    var context: c.ma_context = undefined;
    if (c.ma_context_init(null, 0, null, &context) != c.MA_SUCCESS) {
        return null;
    }
    defer _ = c.ma_context_uninit(&context);

    var playback_infos: [*c]c.ma_device_info = null;
    var playback_count: c.ma_uint32 = 0;

    if (c.ma_context_get_devices(&context, &playback_infos, &playback_count, null, null) != c.MA_SUCCESS) {
        return null;
    }

    var stack_buf: [8192]u8 = undefined;
    var len: usize = 0;

    const appendStr = struct {
        fn s(b: *[8192]u8, l: *usize, str: []const u8) bool {
            if (l.* + str.len > b.len) return false;
            @memcpy(b[l.* .. l.* + str.len], str);
            l.* += str.len;
            return true;
        }
        fn c(b: *[8192]u8, l: *usize, ch: u8) bool {
            if (l.* >= b.len) return false;
            b[l.*] = ch;
            l.* += 1;
            return true;
        }
    };

    if (!appendStr.s(&stack_buf, &len, "{\"devices\":[")) return null;

    var i: u32 = 0;
    while (i < playback_count) : (i += 1) {
        if (i > 0) {
            if (!appendStr.c(&stack_buf, &len, ',')) return null;
        }
        if (!appendStr.s(&stack_buf, &len, "{\"name\":\"")) return null;
        const name_ptr: [*:0]const u8 = @ptrCast(&playback_infos[i].name);
        const name = std.mem.span(name_ptr);
        for (name) |ch| {
            const ok = switch (ch) {
                '"' => appendStr.s(&stack_buf, &len, "\\\""),
                '\\' => appendStr.s(&stack_buf, &len, "\\\\"),
                '\n' => appendStr.s(&stack_buf, &len, "\\n"),
                '\r' => appendStr.s(&stack_buf, &len, "\\r"),
                '\t' => appendStr.s(&stack_buf, &len, "\\t"),
                else => appendStr.c(&stack_buf, &len, ch),
            };
            if (!ok) return null;
        }
        var idx_buf: [16]u8 = undefined;
        const idx_str = std.fmt.bufPrint(&idx_buf, "\",\"index\":{d}}}", .{i}) catch return null;
        if (!appendStr.s(&stack_buf, &len, idx_str)) return null;
    }
    if (!appendStr.s(&stack_buf, &len, "],\"default_index\":0}")) return null;

    const total = len + 1;
    const result = std.heap.c_allocator.alloc(u8, total) catch return null;
    @memcpy(result[0..len], stack_buf[0..len]);
    result[len] = 0;
    g_devices_json = @ptrCast(result.ptr);
    return @ptrCast(result.ptr);
}

/// ca_enumerate_devices で返された文字列を解放
export fn ca_free_string(str: ?[*:0]u8) void {
    if (str) |s| {
        std.heap.c_allocator.free(std.mem.span(s));
    }
}
