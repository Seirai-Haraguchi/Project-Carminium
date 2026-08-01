//! Carminium — Zig ビルドスクリプト
//!
//! carminium_audio.zig + miniaudio_impl.c をコンパイルし、
//! ネイティブ動的ライブラリを生成する。
//!   Windows: carminium_audio.dll
//!   Linux:   libcarminium_audio.so → electron/bin/carminium_audio.so
//!
//! ビルド（Win 原生）:  zig build -Doptimize=ReleaseFast
//! コピー（Win 原生）:  zig build copy -Doptimize=ReleaseFast
//! ビルド（Linux クロス）: zig build -Doptimize=ReleaseFast -Dtarget=x86_64-linux-gnu
//! コピー（Linux クロス）: zig build copy -Doptimize=ReleaseFast -Dtarget=x86_64-linux-gnu

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const is_windows = target.result.os.tag == .windows;
    const is_linux = target.result.os.tag == .linux;

    const mod = b.createModule(.{
        .root_source_file = b.path("carminium_audio.zig"),
        .target = target,
        .optimize = optimize,
    });

    const lib = b.addLibrary(.{
        .name = "carminium_audio",
        .root_module = mod,
        .linkage = .dynamic,
    });

    mod.addCSourceFile(.{
        .file = b.path("miniaudio_impl.c"),
        .flags = &.{
            "-std=c11",
            "-DMA_NO_ENCODING",
            "-DMA_NO_GENERATION",
            "-DMA_NO_DECODING",
        },
    });

    mod.addIncludePath(b.path("."));

    mod.link_libc = true;

    // Windows 特有のシステムライブラリ（miniaudio の WASAPI 実装で使用）
    if (is_windows) {
        mod.linkSystemLibrary("ole32", .{});
        mod.linkSystemLibrary("ksuser", .{});
        mod.linkSystemLibrary("avrt", .{});
        mod.linkSystemLibrary("winmm", .{});
    }

    // Linux 特有のシステムライブラリ（miniaudio の PulseAudio/ALSA 実装で使用）
    if (is_linux) {
        mod.linkSystemLibrary("asound", .{});
        mod.linkSystemLibrary("pulse", .{});
        mod.linkSystemLibrary("m", .{});
        mod.linkSystemLibrary("dl", .{});
        mod.linkSystemLibrary("pthread", .{});
    }

    mod.addCMacro("MA_NO_ENCODING", "");
    mod.addCMacro("MA_NO_GENERATION", "");
    mod.addCMacro("MA_NO_DECODING", "");

    b.installArtifact(lib);

    const copy_step = b.step("copy", "ネイティブライブラリを electron/bin/{win32,linux}/ にコピー（プラットフォーム別サブディレクトリ）");
    // Windows: electron/bin/win32/carminium_audio.dll
    // Linux:   electron/bin/linux/carminium_audio.so（lib プレフィックスなし）
    const dest_subdir = if (is_windows) "win32" else if (is_linux) "linux" else "other";
    const dest_file = if (is_windows) "carminium_audio.dll" else if (is_linux) "carminium_audio.so" else "carminium_audio.unknown";
    const dest_rel = "../../electron/bin/" ++ dest_subdir ++ "/" ++ dest_file;
    const copy_lib = b.addInstallBinFile(lib.getEmittedBin(), dest_rel);
    copy_step.dependOn(&copy_lib.step);
    copy_step.dependOn(&lib.step);

    // 互換性のため electron/bin 直下にもシンボリック相当コピー（従来構成向け）
    const legacy_step = b.step("copy-legacy", "旧構成 electron/bin 直下にもコピー");
    const legacy_dest = if (is_windows) "../../electron/bin/carminium_audio.dll" else if (is_linux) "../../electron/bin/carminium_audio.so" else "../../electron/bin/carminium_audio.unknown";
    const copy_legacy = b.addInstallBinFile(lib.getEmittedBin(), legacy_dest);
    legacy_step.dependOn(&copy_legacy.step);
    legacy_step.dependOn(&lib.step);

    b.getInstallStep().dependOn(&lib.step);
}