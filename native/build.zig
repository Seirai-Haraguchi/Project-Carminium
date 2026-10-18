
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const is_windows = target.result.os.tag == .windows;
    const is_linux = target.result.os.tag == .linux;
    const is_macos = target.result.os.tag == .macos;

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

    if (is_windows) {
        mod.linkSystemLibrary("ole32", .{});
        mod.linkSystemLibrary("ksuser", .{});
        mod.linkSystemLibrary("avrt", .{});
        mod.linkSystemLibrary("winmm", .{});
    }

    if (is_linux) {
        mod.linkSystemLibrary("asound", .{});
        mod.linkSystemLibrary("pulse", .{});
        mod.linkSystemLibrary("m", .{});
        mod.linkSystemLibrary("dl", .{});
        mod.linkSystemLibrary("pthread", .{});
    }

    if (is_macos) {
        mod.linkSystemLibrary("CoreAudio", .{});
        mod.linkSystemLibrary("AudioToolbox", .{});
        mod.linkSystemLibrary("CoreFoundation", .{});
        mod.linkSystemLibrary("pthread", .{});
    }

    mod.addCMacro("MA_NO_ENCODING", "");
    mod.addCMacro("MA_NO_GENERATION", "");
    mod.addCMacro("MA_NO_DECODING", "");

    b.installArtifact(lib);

    const copy_step = b.step("copy", "ネイティブライブラリを electron/bin/{win32,linux,darwin}/ にコピー（プラットフォーム別サブディレクトリ）");
    const dest_subdir = if (is_windows) "win32" else if (is_linux) "linux" else if (is_macos) "darwin" else "other";
    const dest_file = if (is_windows) "carminium_audio.dll" else if (is_linux) "carminium_audio.so" else if (is_macos) "carminium_audio.dylib" else "carminium_audio.unknown";
    const dest_rel = b.fmt("../../../electron/bin/{s}/{s}", .{ dest_subdir, dest_file });
    const copy_lib = b.addInstallBinFile(lib.getEmittedBin(), dest_rel);
    copy_step.dependOn(&copy_lib.step);
    copy_step.dependOn(&lib.step);

    const legacy_step = b.step("copy-legacy", "旧構成 electron/bin 直下にもコピー");
    const legacy_dest = if (is_windows) "../../../electron/bin/carminium_audio.dll" else if (is_linux) "../../../electron/bin/carminium_audio.so" else if (is_macos) "../../../electron/bin/carminium_audio.dylib" else "../../../electron/bin/carminium_audio.unknown";
    const copy_legacy = b.addInstallBinFile(lib.getEmittedBin(), legacy_dest);
    legacy_step.dependOn(&copy_legacy.step);
    legacy_step.dependOn(&lib.step);

    b.getInstallStep().dependOn(&lib.step);
}
