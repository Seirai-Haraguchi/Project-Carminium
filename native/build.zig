//! Carminium — Zig ビルドスクリプト
//!
//! carminium_audio.zig + miniaudio_impl.c + SoundTouch (C++) をコンパイルし、
//! carminium_audio.dll を生成する。
//!
//! ビルド:  zig build -Doptimize=ReleaseFast
//! コピー:  zig build copy -Doptimize=ReleaseFast

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // 共有ライブラリ（Windows では DLL）
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

    // ── miniaudio (C) ──────────────────────────────────────────────────────
    mod.addCSourceFile(.{
        .file = b.path("miniaudio_impl.c"),
        .flags = &.{
            "-std=c11",
            "-DMA_NO_ENCODING",
            "-DMA_NO_GENERATION",
            "-DMA_NO_DECODING",
        },
    });

    // ── SoundTouch (C++) ───────────────────────────────────────────────────
    // LGPL v2.1: 静的リンクの場合、ユーザーが再リンク可能である必要がある。
    // ソースコードを同梱し、build.zig で再ビルド可能にすることで対応。
    const st_src_dir = "soundtouch/source/SoundTouch";
    const st_sources = [_][]const u8{
        st_src_dir ++ "/AAFilter.cpp",
        st_src_dir ++ "/FIFOSampleBuffer.cpp",
        st_src_dir ++ "/FIRFilter.cpp",
        st_src_dir ++ "/InterpolateCubic.cpp",
        st_src_dir ++ "/InterpolateLinear.cpp",
        st_src_dir ++ "/InterpolateShannon.cpp",
        st_src_dir ++ "/PeakFinder.cpp",
        st_src_dir ++ "/RateTransposer.cpp",
        st_src_dir ++ "/SoundTouch.cpp",
        st_src_dir ++ "/TDStretch.cpp",
        st_src_dir ++ "/cpu_detect_x86.cpp",
        st_src_dir ++ "/mmx_optimized.cpp",
        st_src_dir ++ "/sse_optimized.cpp",
    };

    const st_flags = [_][]const u8{
        "-std=c++17",
        "-O3",
        "-fvisibility=hidden",
        // x86 SIMD 最適化を有効化
        "-msse",
        "-msse2",
        "-mfpmath=sse",
    };

    for (st_sources) |src| {
        mod.addCSourceFile(.{
            .file = b.path(src),
            .flags = &st_flags,
        });
    }

    // C wrapper
    mod.addCSourceFile(.{
        .file = b.path("soundtouch_wrapper.cpp"),
        .flags = &st_flags,
    });

    // ── インクルードパス ───────────────────────────────────────────────────
    mod.addIncludePath(b.path("."));                              // 自身のヘッダ
    mod.addIncludePath(b.path("soundtouch/include"));             // SoundTouch.h
    mod.addIncludePath(b.path("soundtouch/source/SoundTouch"));   // 内部ヘッダ (AAFilter.h 等)

    // ── リンカ設定 ─────────────────────────────────────────────────────────
    mod.link_libc = true;
    mod.link_libcpp = true;  // SoundTouch は C++

    // Windows: miniaudio WASAPI バックエンド + SoundTouch 必須ライブラリ
    mod.linkSystemLibrary("ole32", .{});
    mod.linkSystemLibrary("ksuser", .{});
    mod.linkSystemLibrary("avrt", .{});
    mod.linkSystemLibrary("winmm", .{});

    // miniaudio 定義済みマクロ
    mod.addCMacro("MA_NO_ENCODING", "");
    mod.addCMacro("MA_NO_GENERATION", "");
    mod.addCMacro("MA_NO_DECODING", "");

    // ── 出力 ───────────────────────────────────────────────────────────────
    b.installArtifact(lib);

    // 開発用: DLL を electron/bin/ にコピー
    const copy_step = b.step("copy", "DLL を electron/bin/ にコピー");
    const copy_dll = b.addInstallBinFile(lib.getEmittedBin(), "../../electron/bin/carminium_audio.dll");
    copy_step.dependOn(&copy_dll.step);
    copy_step.dependOn(&lib.step);

    b.getInstallStep().dependOn(&lib.step);
}
