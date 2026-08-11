//! Carminium — WASAPI ネイティブオーディオ DLL (Zig + miniaudio)
//!
//! 音声管線:
//!   JS (ffmpeg decode + 合成) → ca_push_pcm() → 入力リングバッファ (f32)
//!     → dataCallback → WASAPI 出力
//!
//! 共有モードと排他モードの両方をサポート。
//! PCM は常に f32 interleaved。
//! Gapless/AutoMix は JS 側で合成された後、この DLL に渡す。

const std = @import("std");

const c = @cImport({
    @cDefine("MA_NO_ENCODING", "");
    @cDefine("MA_NO_GENERATION", "");
    @cDefine("MA_NO_DECODING", "");
    @cInclude("miniaudio.h");
});

// ── 定数 ────────────────────────────────────────────────────────────────────

// 4MB = roughly 11.9 seconds of 44.1kHz stereo f32 audio. This keeps a wide
// margin over the 800ms pre-roll target while avoiding a large always-resident
// DLL buffer.
const RING_SIZE: u64 = 4 * 1024 * 1024;
const RING_MASK: u64 = RING_SIZE - 1;

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
var g_bytes_per_frame: u32 = 0;

var g_ring: ?[]u8 = null;
var g_ring_w: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);
var g_ring_r: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);

var g_frames_consumed: std.atomic.Value(u64) = std.atomic.Value(u64).init(0);

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

    const frames_written = readRingToF32Direct(out, frames_needed);

    if (frames_written < frames_needed) {
        const start_sample = frames_written * g_channels;
        const end_sample = frames_needed * g_channels;
        var i: u32 = start_sample;
        while (i < end_sample) : (i += 1) {
            out[i] = 0.0;
        }
    }

    if (g_volume < 1.0) {
        applyVolume(out[0 .. @as(usize, frames_needed) * g_channels], g_volume);
    }
}

fn readRingToF32Direct(out: [*]f32, max_frames: u32) u32 {
    const ring = g_ring orelse return 0;
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
            ring[pos .. pos + @as(usize, @intCast(chunk))],
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

// ── エクスポート C API ──────────────────────────────────────────────────────

export fn ca_init(
    share_mode: i32,
    device_index: i32,
    sample_rate: u32,
    channels: u16,
) i32 {
    if (g_initialized) return -1;

    g_ring = std.heap.c_allocator.alloc(u8, @as(usize, @intCast(RING_SIZE))) catch return -4;

    g_share_mode = if (share_mode == SHARE_EXCLUSIVE) SHARE_EXCLUSIVE else SHARE_SHARED;
    const ch: u32 = if (channels == 0) 2 else @as(u32, channels);

    const format = c.ma_format_f32;
    g_bytes_per_frame = ch * 4;

    if (c.ma_context_init(null, 0, null, &g_context) != c.MA_SUCCESS) {
        std.heap.c_allocator.free(g_ring.?);
        g_ring = null;
        return -3;
    }
    g_has_context = true;

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

    if (has_device_id) {
        config.playback.pDeviceID = &device_id;
    }

    const result = c.ma_device_init(&g_context, &config, &g_device);
    if (result != c.MA_SUCCESS) {
        _ = c.ma_context_uninit(&g_context);
        g_has_context = false;
        std.heap.c_allocator.free(g_ring.?);
        g_ring = null;
        return @intCast(result);
    }

    g_sample_rate = g_device.sampleRate;
    g_channels = @intCast(g_device.playback.channels);
    g_bytes_per_frame = @as(u32, g_channels) * 4;

    g_ring_w.store(0, .monotonic);
    g_ring_r.store(0, .monotonic);
    g_frames_consumed.store(0, .monotonic);

    g_initialized = true;
    return 0;
}

export fn ca_start() i32 {
    if (!g_initialized) return -1;
    const result = c.ma_device_start(&g_device);
    if (result == c.MA_SUCCESS) {
        g_playing = true;
        return 0;
    }
    return @intCast(result);
}

export fn ca_stop() i32 {
    if (!g_initialized) return -1;
    const result = c.ma_device_stop(&g_device);
    if (result == c.MA_SUCCESS) {
        g_playing = false;
        return 0;
    }
    return @intCast(result);
}

export fn ca_push_pcm(data: [*]const u8, len: u32) i32 {
    const ring = g_ring orelse return -1;
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
            ring[pos .. pos + @as(usize, @intCast(chunk))],
            data[@as(usize, @intCast(written)) .. @as(usize, @intCast(written + chunk))],
        );
        written += chunk;
    }

    g_ring_w.store(wp + @as(u64, len), .release);
    return 0;
}

export fn ca_set_volume(vol: f32) void {
    g_volume = @max(0.0, @min(1.0, vol));
}

export fn ca_get_consumed_frames() u64 {
    return g_frames_consumed.load(.monotonic);
}

export fn ca_get_buffered_bytes() u32 {
    const wp = g_ring_w.load(.acquire);
    const rp = g_ring_r.load(.acquire);
    return @intCast(wp -% rp);
}

export fn ca_clear_buffer() void {
    g_ring_w.store(0, .monotonic);
    g_ring_r.store(0, .monotonic);
    g_frames_consumed.store(0, .monotonic);
}

export fn ca_get_sample_rate() u32 {
    return g_sample_rate;
}

export fn ca_get_channels() u16 {
    return g_channels;
}

export fn ca_get_bits_per_sample() u16 {
    return 32;
}

export fn ca_get_share_mode() i32 {
    return g_share_mode;
}

export fn ca_is_playing() i32 {
    return if (g_playing) 1 else 0;
}

export fn ca_close() void {
    if (!g_initialized) return;
    _ = c.ma_device_stop(&g_device);
    c.ma_device_uninit(&g_device);
    if (g_has_context) {
        _ = c.ma_context_uninit(&g_context);
        g_has_context = false;
    }
    g_initialized = false;
    g_playing = false;
    if (g_ring) |ring| {
        std.heap.c_allocator.free(ring);
        g_ring = null;
    }
    g_ring_w.store(0, .monotonic);
    g_ring_r.store(0, .monotonic);
    g_frames_consumed.store(0, .monotonic);
}

// ── デバイス列挙 ────────────────────────────────────────────────────────────

var g_devices_json: ?[*:0]u8 = null;

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

export fn ca_free_string(str: ?[*:0]u8) void {
    if (str) |s| {
        std.heap.c_allocator.free(std.mem.span(s));
    }
}
