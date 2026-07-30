//! Carminium — Zig ビルドスクリプト
//!
//! carminium_audio.zig + miniaudio_impl.c をコンパイルし、
//! carminium_audio.dll を生成する。
//!
//! ビルド:  zig build -Doptimize=ReleaseFast
//! コピー:  zig build copy -Doptimize=ReleaseFast

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

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

    mod.linkSystemLibrary("ole32", .{});
    mod.linkSystemLibrary("ksuser", .{});
    mod.linkSystemLibrary("avrt", .{});
    mod.linkSystemLibrary("winmm", .{});

    mod.addCMacro("MA_NO_ENCODING", "");
    mod.addCMacro("MA_NO_GENERATION", "");
    mod.addCMacro("MA_NO_DECODING", "");

    b.installArtifact(lib);

    const copy_step = b.step("copy", "DLL を electron/bin/ にコピー");
    const copy_dll = b.addInstallBinFile(lib.getEmittedBin(), "../../electron/bin/carminium_audio.dll");
    copy_step.dependOn(&copy_dll.step);
    copy_step.dependOn(&lib.step);

    b.getInstallStep().dependOn(&lib.step);
}