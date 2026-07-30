const __root = @This();
pub const __builtin = @import("std").zig.c_translation.builtins;
pub const __helpers = @import("std").zig.c_translation.helpers;
pub const ptrdiff_t = c_longlong;
pub const wchar_t = c_ushort;
pub const max_align_t = extern struct {
    __aro_max_align_ll: c_longlong = 0,
    __aro_max_align_ld: c_longdouble = 0,
};
pub const ma_int8 = i8;
pub const ma_uint8 = u8;
pub const ma_int16 = c_short;
pub const ma_uint16 = c_ushort;
pub const ma_int32 = c_int;
pub const ma_uint32 = c_uint;
pub const ma_int64 = c_longlong;
pub const ma_uint64 = c_ulonglong;
pub const ma_uintptr = ma_uint64;
pub const ma_bool8 = ma_uint8;
pub const ma_bool32 = ma_uint32;
pub const ma_float = f32;
pub const ma_double = f64;
pub const ma_handle = ?*anyopaque;
pub const ma_ptr = ?*anyopaque;
pub const ma_proc = ?*const fn () callconv(.c) void;
pub const ma_wchar_win32 = wchar_t;
pub const MA_LOG_LEVEL_DEBUG: c_int = 4;
pub const MA_LOG_LEVEL_INFO: c_int = 3;
pub const MA_LOG_LEVEL_WARNING: c_int = 2;
pub const MA_LOG_LEVEL_ERROR: c_int = 1;
pub const ma_log_level = c_uint;
pub const ma_context = struct_ma_context;
const struct_unnamed_1 = extern struct {
    hWnd: ma_handle = null,
};
const struct_unnamed_2 = extern struct {
    useVerboseDeviceEnumeration: ma_bool32 = 0,
};
const struct_unnamed_3 = extern struct {
    pApplicationName: [*c]const u8 = null,
    pServerName: [*c]const u8 = null,
    tryAutoSpawn: ma_bool32 = 0,
};
const struct_unnamed_4 = extern struct {
    sessionCategory: ma_ios_session_category = @import("std").mem.zeroes(ma_ios_session_category),
    sessionCategoryOptions: ma_uint32 = 0,
    noAudioSessionActivate: ma_bool32 = 0,
    noAudioSessionDeactivate: ma_bool32 = 0,
};
const struct_unnamed_5 = extern struct {
    pClientName: [*c]const u8 = null,
    tryStartServer: ma_bool32 = 0,
};
pub const struct_ma_context_config = extern struct {
    pLog: [*c]ma_log = null,
    threadPriority: ma_thread_priority = @import("std").mem.zeroes(ma_thread_priority),
    threadStackSize: usize = 0,
    pUserData: ?*anyopaque = null,
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    dsound: struct_unnamed_1 = @import("std").mem.zeroes(struct_unnamed_1),
    alsa: struct_unnamed_2 = @import("std").mem.zeroes(struct_unnamed_2),
    pulse: struct_unnamed_3 = @import("std").mem.zeroes(struct_unnamed_3),
    coreaudio: struct_unnamed_4 = @import("std").mem.zeroes(struct_unnamed_4),
    jack: struct_unnamed_5 = @import("std").mem.zeroes(struct_unnamed_5),
    custom: ma_backend_callbacks = @import("std").mem.zeroes(ma_backend_callbacks),
};
pub const ma_context_config = struct_ma_context_config;
pub const ma_enum_devices_callback_proc = ?*const fn (pContext: [*c]ma_context, deviceType: ma_device_type, pInfo: [*c]const ma_device_info, pUserData: ?*anyopaque) callconv(.c) ma_bool32;
pub const ma_device_data_proc = ?*const fn (pDevice: [*c]ma_device, pOutput: ?*anyopaque, pInput: ?*const anyopaque, frameCount: ma_uint32) callconv(.c) void;
pub const ma_device_notification_proc = ?*const fn (pNotification: [*c]const ma_device_notification) callconv(.c) void;
pub const ma_stop_proc = ?*const fn (pDevice: [*c]ma_device) callconv(.c) void;
pub const ma_mutex = ma_handle;
pub const ma_event = ma_handle;
pub const ma_thread = ma_handle;
const struct_unnamed_7 = extern struct {
    lpfOrder: ma_uint32 = 0,
};
const struct_unnamed_6 = extern struct {
    algorithm: ma_resample_algorithm = @import("std").mem.zeroes(ma_resample_algorithm),
    pBackendVTable: [*c]ma_resampling_backend_vtable = null,
    pBackendUserData: ?*anyopaque = null,
    linear: struct_unnamed_7 = @import("std").mem.zeroes(struct_unnamed_7),
};
pub const ma_channel = ma_uint8;
const struct_unnamed_8 = extern struct {
    pID: [*c]ma_device_id = null,
    id: ma_device_id = @import("std").mem.zeroes(ma_device_id),
    name: [256]u8 = @import("std").mem.zeroes([256]u8),
    shareMode: ma_share_mode = @import("std").mem.zeroes(ma_share_mode),
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    channelMap: [254]ma_channel = @import("std").mem.zeroes([254]ma_channel),
    internalFormat: ma_format = @import("std").mem.zeroes(ma_format),
    internalChannels: ma_uint32 = 0,
    internalSampleRate: ma_uint32 = 0,
    internalChannelMap: [254]ma_channel = @import("std").mem.zeroes([254]ma_channel),
    internalPeriodSizeInFrames: ma_uint32 = 0,
    internalPeriods: ma_uint32 = 0,
    channelMixMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    calculateLFEFromSpatialChannels: ma_bool32 = 0,
    converter: ma_data_converter = @import("std").mem.zeroes(ma_data_converter),
    pIntermediaryBuffer: ?*anyopaque = null,
    intermediaryBufferCap: ma_uint32 = 0,
    intermediaryBufferLen: ma_uint32 = 0,
    pInputCache: ?*anyopaque = null,
    inputCacheCap: ma_uint64 = 0,
    inputCacheConsumed: ma_uint64 = 0,
    inputCacheRemaining: ma_uint64 = 0,
};
const struct_unnamed_9 = extern struct {
    pID: [*c]ma_device_id = null,
    id: ma_device_id = @import("std").mem.zeroes(ma_device_id),
    name: [256]u8 = @import("std").mem.zeroes([256]u8),
    shareMode: ma_share_mode = @import("std").mem.zeroes(ma_share_mode),
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    channelMap: [254]ma_channel = @import("std").mem.zeroes([254]ma_channel),
    internalFormat: ma_format = @import("std").mem.zeroes(ma_format),
    internalChannels: ma_uint32 = 0,
    internalSampleRate: ma_uint32 = 0,
    internalChannelMap: [254]ma_channel = @import("std").mem.zeroes([254]ma_channel),
    internalPeriodSizeInFrames: ma_uint32 = 0,
    internalPeriods: ma_uint32 = 0,
    channelMixMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    calculateLFEFromSpatialChannels: ma_bool32 = 0,
    converter: ma_data_converter = @import("std").mem.zeroes(ma_data_converter),
    pIntermediaryBuffer: ?*anyopaque = null,
    intermediaryBufferCap: ma_uint32 = 0,
    intermediaryBufferLen: ma_uint32 = 0,
};
const struct_unnamed_11 = extern struct {
    pAudioClientPlayback: ma_ptr = null,
    pAudioClientCapture: ma_ptr = null,
    pRenderClient: ma_ptr = null,
    pCaptureClient: ma_ptr = null,
    pDeviceEnumerator: ma_ptr = null,
    notificationClient: ma_IMMNotificationClient = @import("std").mem.zeroes(ma_IMMNotificationClient),
    hEventPlayback: ma_handle = null,
    hEventCapture: ma_handle = null,
    actualBufferSizeInFramesPlayback: ma_uint32 = 0,
    actualBufferSizeInFramesCapture: ma_uint32 = 0,
    originalPeriodSizeInFrames: ma_uint32 = 0,
    originalPeriodSizeInMilliseconds: ma_uint32 = 0,
    originalPeriods: ma_uint32 = 0,
    originalPerformanceProfile: ma_performance_profile = @import("std").mem.zeroes(ma_performance_profile),
    periodSizeInFramesPlayback: ma_uint32 = 0,
    periodSizeInFramesCapture: ma_uint32 = 0,
    pMappedBufferCapture: ?*anyopaque = null,
    mappedBufferCaptureCap: ma_uint32 = 0,
    mappedBufferCaptureLen: ma_uint32 = 0,
    pMappedBufferPlayback: ?*anyopaque = null,
    mappedBufferPlaybackCap: ma_uint32 = 0,
    mappedBufferPlaybackLen: ma_uint32 = 0,
    isStartedCapture: ma_atomic_bool32 = @import("std").mem.zeroes(ma_atomic_bool32),
    isStartedPlayback: ma_atomic_bool32 = @import("std").mem.zeroes(ma_atomic_bool32),
    loopbackProcessID: ma_uint32 = 0,
    loopbackProcessExclude: ma_bool8 = 0,
    noAutoConvertSRC: ma_bool8 = 0,
    noDefaultQualitySRC: ma_bool8 = 0,
    noHardwareOffloading: ma_bool8 = 0,
    allowCaptureAutoStreamRouting: ma_bool8 = 0,
    allowPlaybackAutoStreamRouting: ma_bool8 = 0,
    isDetachedPlayback: ma_bool8 = 0,
    isDetachedCapture: ma_bool8 = 0,
    usage: ma_wasapi_usage = @import("std").mem.zeroes(ma_wasapi_usage),
    hAvrtHandle: ?*anyopaque = null,
    rerouteLock: ma_mutex = null,
};
const struct_unnamed_12 = extern struct {
    pPlayback: ma_ptr = null,
    pPlaybackPrimaryBuffer: ma_ptr = null,
    pPlaybackBuffer: ma_ptr = null,
    pCapture: ma_ptr = null,
    pCaptureBuffer: ma_ptr = null,
};
const struct_unnamed_13 = extern struct {
    hDevicePlayback: ma_handle = null,
    hDeviceCapture: ma_handle = null,
    hEventPlayback: ma_handle = null,
    hEventCapture: ma_handle = null,
    fragmentSizeInFrames: ma_uint32 = 0,
    iNextHeaderPlayback: ma_uint32 = 0,
    iNextHeaderCapture: ma_uint32 = 0,
    headerFramesConsumedPlayback: ma_uint32 = 0,
    headerFramesConsumedCapture: ma_uint32 = 0,
    pWAVEHDRPlayback: [*c]ma_uint8 = null,
    pWAVEHDRCapture: [*c]ma_uint8 = null,
    pIntermediaryBufferPlayback: [*c]ma_uint8 = null,
    pIntermediaryBufferCapture: [*c]ma_uint8 = null,
    _pHeapData: [*c]ma_uint8 = null,
};
const struct_unnamed_14 = extern struct {
    pClient: ma_ptr = null,
    ppPortsPlayback: [*c]ma_ptr = null,
    ppPortsCapture: [*c]ma_ptr = null,
    pIntermediaryBufferPlayback: [*c]f32 = null,
    pIntermediaryBufferCapture: [*c]f32 = null,
};
pub const ma_semaphore = ma_handle;
const struct_unnamed_15 = extern struct {
    deviceThread: ma_thread = null,
    operationEvent: ma_event = null,
    operationCompletionEvent: ma_event = null,
    operationSemaphore: ma_semaphore = null,
    operation: ma_uint32 = 0,
    operationResult: ma_result = @import("std").mem.zeroes(ma_result),
    timer: ma_timer = @import("std").mem.zeroes(ma_timer),
    priorRunTime: f64 = 0,
    currentPeriodFramesRemainingPlayback: ma_uint32 = 0,
    currentPeriodFramesRemainingCapture: ma_uint32 = 0,
    lastProcessedFramePlayback: ma_uint64 = 0,
    lastProcessedFrameCapture: ma_uint64 = 0,
    isStarted: ma_atomic_bool32 = @import("std").mem.zeroes(ma_atomic_bool32),
};
const union_unnamed_10 = extern union {
    wasapi: struct_unnamed_11,
    dsound: struct_unnamed_12,
    winmm: struct_unnamed_13,
    jack: struct_unnamed_14,
    null_device: struct_unnamed_15,
};
pub const struct_ma_device = extern struct {
    pContext: [*c]ma_context = null,
    type: ma_device_type = @import("std").mem.zeroes(ma_device_type),
    sampleRate: ma_uint32 = 0,
    state: ma_atomic_device_state = @import("std").mem.zeroes(ma_atomic_device_state),
    onData: ma_device_data_proc = null,
    onNotification: ma_device_notification_proc = null,
    onStop: ma_stop_proc = null,
    pUserData: ?*anyopaque = null,
    startStopLock: ma_mutex = null,
    wakeupEvent: ma_event = null,
    startEvent: ma_event = null,
    stopEvent: ma_event = null,
    thread: ma_thread = null,
    workResult: ma_result = @import("std").mem.zeroes(ma_result),
    isOwnerOfContext: ma_bool8 = 0,
    noPreSilencedOutputBuffer: ma_bool8 = 0,
    noClip: ma_bool8 = 0,
    noDisableDenormals: ma_bool8 = 0,
    noFixedSizedCallback: ma_bool8 = 0,
    masterVolumeFactor: ma_atomic_float = @import("std").mem.zeroes(ma_atomic_float),
    duplexRB: ma_duplex_rb = @import("std").mem.zeroes(ma_duplex_rb),
    resampling: struct_unnamed_6 = @import("std").mem.zeroes(struct_unnamed_6),
    playback: struct_unnamed_8 = @import("std").mem.zeroes(struct_unnamed_8),
    capture: struct_unnamed_9 = @import("std").mem.zeroes(struct_unnamed_9),
    unnamed_0: union_unnamed_10 = @import("std").mem.zeroes(union_unnamed_10),
    pub const ma_device_uninit = __root.ma_device_uninit;
    pub const ma_device_get_context = __root.ma_device_get_context;
    pub const ma_device_get_log = __root.ma_device_get_log;
    pub const ma_device_get_info = __root.ma_device_get_info;
    pub const ma_device_get_name = __root.ma_device_get_name;
    pub const ma_device_start = __root.ma_device_start;
    pub const ma_device_stop = __root.ma_device_stop;
    pub const ma_device_is_started = __root.ma_device_is_started;
    pub const ma_device_get_state = __root.ma_device_get_state;
    pub const ma_device_post_init = __root.ma_device_post_init;
    pub const ma_device_set_master_volume = __root.ma_device_set_master_volume;
    pub const ma_device_get_master_volume = __root.ma_device_get_master_volume;
    pub const ma_device_set_master_volume_db = __root.ma_device_set_master_volume_db;
    pub const ma_device_get_master_volume_db = __root.ma_device_get_master_volume_db;
    pub const ma_device_handle_backend_data_callback = __root.ma_device_handle_backend_data_callback;
    pub const uninit = __root.ma_device_uninit;
    pub const get_context = __root.ma_device_get_context;
    pub const get_log = __root.ma_device_get_log;
    pub const get_info = __root.ma_device_get_info;
    pub const get_name = __root.ma_device_get_name;
    pub const start = __root.ma_device_start;
    pub const stop = __root.ma_device_stop;
    pub const is_started = __root.ma_device_is_started;
    pub const get_state = __root.ma_device_get_state;
    pub const post_init = __root.ma_device_post_init;
    pub const set_master_volume = __root.ma_device_set_master_volume;
    pub const get_master_volume = __root.ma_device_get_master_volume;
    pub const set_master_volume_db = __root.ma_device_set_master_volume_db;
    pub const get_master_volume_db = __root.ma_device_get_master_volume_db;
    pub const handle_backend_data_callback = __root.ma_device_handle_backend_data_callback;
};
pub const ma_device = struct_ma_device;
const struct_unnamed_16 = extern struct {
    lpfOrder: ma_uint32 = 0,
};
pub const struct_ma_resampler_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRateIn: ma_uint32 = 0,
    sampleRateOut: ma_uint32 = 0,
    algorithm: ma_resample_algorithm = @import("std").mem.zeroes(ma_resample_algorithm),
    pBackendVTable: [*c]ma_resampling_backend_vtable = null,
    pBackendUserData: ?*anyopaque = null,
    linear: struct_unnamed_16 = @import("std").mem.zeroes(struct_unnamed_16),
    pub const ma_resampler_get_heap_size = __root.ma_resampler_get_heap_size;
    pub const ma_resampler_init_preallocated = __root.ma_resampler_init_preallocated;
    pub const ma_resampler_init = __root.ma_resampler_init;
    pub const size = __root.ma_resampler_get_heap_size;
    pub const preallocated = __root.ma_resampler_init_preallocated;
    pub const init = __root.ma_resampler_init;
};
pub const ma_resampler_config = struct_ma_resampler_config;
const struct_unnamed_17 = extern struct {
    pDeviceID: [*c]const ma_device_id = null,
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    pChannelMap: [*c]ma_channel = null,
    channelMixMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    calculateLFEFromSpatialChannels: ma_bool32 = 0,
    shareMode: ma_share_mode = @import("std").mem.zeroes(ma_share_mode),
};
const struct_unnamed_18 = extern struct {
    pDeviceID: [*c]const ma_device_id = null,
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    pChannelMap: [*c]ma_channel = null,
    channelMixMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    calculateLFEFromSpatialChannels: ma_bool32 = 0,
    shareMode: ma_share_mode = @import("std").mem.zeroes(ma_share_mode),
};
const struct_unnamed_19 = extern struct {
    usage: ma_wasapi_usage = @import("std").mem.zeroes(ma_wasapi_usage),
    noAutoConvertSRC: ma_bool8 = 0,
    noDefaultQualitySRC: ma_bool8 = 0,
    noAutoStreamRouting: ma_bool8 = 0,
    noHardwareOffloading: ma_bool8 = 0,
    loopbackProcessID: ma_uint32 = 0,
    loopbackProcessExclude: ma_bool8 = 0,
};
const struct_unnamed_20 = extern struct {
    noMMap: ma_bool32 = 0,
    noAutoFormat: ma_bool32 = 0,
    noAutoChannels: ma_bool32 = 0,
    noAutoResample: ma_bool32 = 0,
};
const struct_unnamed_21 = extern struct {
    pStreamNamePlayback: [*c]const u8 = null,
    pStreamNameCapture: [*c]const u8 = null,
    channelMap: c_int = 0,
};
const struct_unnamed_22 = extern struct {
    allowNominalSampleRateChange: ma_bool32 = 0,
};
const struct_unnamed_23 = extern struct {
    streamType: ma_opensl_stream_type = @import("std").mem.zeroes(ma_opensl_stream_type),
    recordingPreset: ma_opensl_recording_preset = @import("std").mem.zeroes(ma_opensl_recording_preset),
    enableCompatibilityWorkarounds: ma_bool32 = 0,
};
const struct_unnamed_24 = extern struct {
    usage: ma_aaudio_usage = @import("std").mem.zeroes(ma_aaudio_usage),
    contentType: ma_aaudio_content_type = @import("std").mem.zeroes(ma_aaudio_content_type),
    inputPreset: ma_aaudio_input_preset = @import("std").mem.zeroes(ma_aaudio_input_preset),
    allowedCapturePolicy: ma_aaudio_allowed_capture_policy = @import("std").mem.zeroes(ma_aaudio_allowed_capture_policy),
    noAutoStartAfterReroute: ma_bool32 = 0,
    enableCompatibilityWorkarounds: ma_bool32 = 0,
    allowSetBufferCapacity: ma_bool32 = 0,
};
pub const struct_ma_device_config = extern struct {
    deviceType: ma_device_type = @import("std").mem.zeroes(ma_device_type),
    sampleRate: ma_uint32 = 0,
    periodSizeInFrames: ma_uint32 = 0,
    periodSizeInMilliseconds: ma_uint32 = 0,
    periods: ma_uint32 = 0,
    performanceProfile: ma_performance_profile = @import("std").mem.zeroes(ma_performance_profile),
    noPreSilencedOutputBuffer: ma_bool8 = 0,
    noClip: ma_bool8 = 0,
    noDisableDenormals: ma_bool8 = 0,
    noFixedSizedCallback: ma_bool8 = 0,
    dataCallback: ma_device_data_proc = null,
    notificationCallback: ma_device_notification_proc = null,
    stopCallback: ma_stop_proc = null,
    pUserData: ?*anyopaque = null,
    resampling: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    playback: struct_unnamed_17 = @import("std").mem.zeroes(struct_unnamed_17),
    capture: struct_unnamed_18 = @import("std").mem.zeroes(struct_unnamed_18),
    wasapi: struct_unnamed_19 = @import("std").mem.zeroes(struct_unnamed_19),
    alsa: struct_unnamed_20 = @import("std").mem.zeroes(struct_unnamed_20),
    pulse: struct_unnamed_21 = @import("std").mem.zeroes(struct_unnamed_21),
    coreaudio: struct_unnamed_22 = @import("std").mem.zeroes(struct_unnamed_22),
    opensl: struct_unnamed_23 = @import("std").mem.zeroes(struct_unnamed_23),
    aaudio: struct_unnamed_24 = @import("std").mem.zeroes(struct_unnamed_24),
};
pub const ma_device_config = struct_ma_device_config;
pub const struct_ma_backend_callbacks = extern struct {
    onContextInit: ?*const fn (pContext: [*c]ma_context, pConfig: [*c]const ma_context_config, pCallbacks: [*c]ma_backend_callbacks) callconv(.c) ma_result = null,
    onContextUninit: ?*const fn (pContext: [*c]ma_context) callconv(.c) ma_result = null,
    onContextEnumerateDevices: ?*const fn (pContext: [*c]ma_context, callback: ma_enum_devices_callback_proc, pUserData: ?*anyopaque) callconv(.c) ma_result = null,
    onContextGetDeviceInfo: ?*const fn (pContext: [*c]ma_context, deviceType: ma_device_type, pDeviceID: [*c]const ma_device_id, pDeviceInfo: [*c]ma_device_info) callconv(.c) ma_result = null,
    onDeviceInit: ?*const fn (pDevice: [*c]ma_device, pConfig: [*c]const ma_device_config, pDescriptorPlayback: [*c]ma_device_descriptor, pDescriptorCapture: [*c]ma_device_descriptor) callconv(.c) ma_result = null,
    onDeviceUninit: ?*const fn (pDevice: [*c]ma_device) callconv(.c) ma_result = null,
    onDeviceStart: ?*const fn (pDevice: [*c]ma_device) callconv(.c) ma_result = null,
    onDeviceStop: ?*const fn (pDevice: [*c]ma_device) callconv(.c) ma_result = null,
    onDeviceRead: ?*const fn (pDevice: [*c]ma_device, pFrames: ?*anyopaque, frameCount: ma_uint32, pFramesRead: [*c]ma_uint32) callconv(.c) ma_result = null,
    onDeviceWrite: ?*const fn (pDevice: [*c]ma_device, pFrames: ?*const anyopaque, frameCount: ma_uint32, pFramesWritten: [*c]ma_uint32) callconv(.c) ma_result = null,
    onDeviceDataLoop: ?*const fn (pDevice: [*c]ma_device) callconv(.c) ma_result = null,
    onDeviceDataLoopWakeup: ?*const fn (pDevice: [*c]ma_device) callconv(.c) ma_result = null,
    onDeviceGetInfo: ?*const fn (pDevice: [*c]ma_device, @"type": ma_device_type, pDeviceInfo: [*c]ma_device_info) callconv(.c) ma_result = null,
};
pub const ma_backend_callbacks = struct_ma_backend_callbacks;
const struct_unnamed_26 = extern struct {
    commandThread: ma_thread = null,
    commandLock: ma_mutex = null,
    commandSem: ma_semaphore = null,
    commandIndex: ma_uint32 = 0,
    commandCount: ma_uint32 = 0,
    commands: [4]ma_context_command__wasapi = @import("std").mem.zeroes([4]ma_context_command__wasapi),
    hAvrt: ma_handle = null,
    AvSetMmThreadCharacteristicsA: ma_proc = null,
    AvRevertMmThreadcharacteristics: ma_proc = null,
    hMMDevapi: ma_handle = null,
    ActivateAudioInterfaceAsync: ma_proc = null,
};
const struct_unnamed_27 = extern struct {
    hWnd: ma_handle = null,
    hDSoundDLL: ma_handle = null,
    DirectSoundCreate: ma_proc = null,
    DirectSoundEnumerateA: ma_proc = null,
    DirectSoundCaptureCreate: ma_proc = null,
    DirectSoundCaptureEnumerateA: ma_proc = null,
};
const struct_unnamed_28 = extern struct {
    hWinMM: ma_handle = null,
    waveOutGetNumDevs: ma_proc = null,
    waveOutGetDevCapsA: ma_proc = null,
    waveOutOpen: ma_proc = null,
    waveOutClose: ma_proc = null,
    waveOutPrepareHeader: ma_proc = null,
    waveOutUnprepareHeader: ma_proc = null,
    waveOutWrite: ma_proc = null,
    waveOutReset: ma_proc = null,
    waveInGetNumDevs: ma_proc = null,
    waveInGetDevCapsA: ma_proc = null,
    waveInOpen: ma_proc = null,
    waveInClose: ma_proc = null,
    waveInPrepareHeader: ma_proc = null,
    waveInUnprepareHeader: ma_proc = null,
    waveInAddBuffer: ma_proc = null,
    waveInStart: ma_proc = null,
    waveInReset: ma_proc = null,
};
const struct_unnamed_29 = extern struct {
    jackSO: ma_handle = null,
    jack_client_open: ma_proc = null,
    jack_client_close: ma_proc = null,
    jack_client_name_size: ma_proc = null,
    jack_set_process_callback: ma_proc = null,
    jack_set_buffer_size_callback: ma_proc = null,
    jack_on_shutdown: ma_proc = null,
    jack_get_sample_rate: ma_proc = null,
    jack_get_buffer_size: ma_proc = null,
    jack_get_ports: ma_proc = null,
    jack_activate: ma_proc = null,
    jack_deactivate: ma_proc = null,
    jack_connect: ma_proc = null,
    jack_port_register: ma_proc = null,
    jack_port_name: ma_proc = null,
    jack_port_get_buffer: ma_proc = null,
    jack_free: ma_proc = null,
    pClientName: [*c]u8 = null,
    tryStartServer: ma_bool32 = 0,
};
const struct_unnamed_30 = extern struct {
    _unused: c_int = 0,
};
const union_unnamed_25 = extern union {
    wasapi: struct_unnamed_26,
    dsound: struct_unnamed_27,
    winmm: struct_unnamed_28,
    jack: struct_unnamed_29,
    null_backend: struct_unnamed_30,
};
const struct_unnamed_32 = extern struct {
    hOle32DLL: ma_handle = null,
    CoInitialize: ma_proc = null,
    CoInitializeEx: ma_proc = null,
    CoUninitialize: ma_proc = null,
    CoCreateInstance: ma_proc = null,
    CoTaskMemFree: ma_proc = null,
    PropVariantClear: ma_proc = null,
    StringFromGUID2: ma_proc = null,
    hUser32DLL: ma_handle = null,
    GetForegroundWindow: ma_proc = null,
    GetDesktopWindow: ma_proc = null,
    hAdvapi32DLL: ma_handle = null,
    RegOpenKeyExA: ma_proc = null,
    RegCloseKey: ma_proc = null,
    RegQueryValueExA: ma_proc = null,
    CoInitializeResult: c_long = 0,
};
const union_unnamed_31 = extern union {
    win32: struct_unnamed_32,
    _unused: c_int,
};
pub const struct_ma_context = extern struct {
    callbacks: ma_backend_callbacks = @import("std").mem.zeroes(ma_backend_callbacks),
    backend: ma_backend = @import("std").mem.zeroes(ma_backend),
    pLog: [*c]ma_log = null,
    log: ma_log = @import("std").mem.zeroes(ma_log),
    threadPriority: ma_thread_priority = @import("std").mem.zeroes(ma_thread_priority),
    threadStackSize: usize = 0,
    pUserData: ?*anyopaque = null,
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    deviceEnumLock: ma_mutex = null,
    deviceInfoLock: ma_mutex = null,
    deviceInfoCapacity: ma_uint32 = 0,
    playbackDeviceInfoCount: ma_uint32 = 0,
    captureDeviceInfoCount: ma_uint32 = 0,
    pDeviceInfos: [*c]ma_device_info = null,
    unnamed_0: union_unnamed_25 = @import("std").mem.zeroes(union_unnamed_25),
    unnamed_1: union_unnamed_31 = @import("std").mem.zeroes(union_unnamed_31),
    pub const ma_context_uninit = __root.ma_context_uninit;
    pub const ma_context_get_log = __root.ma_context_get_log;
    pub const ma_context_enumerate_devices = __root.ma_context_enumerate_devices;
    pub const ma_context_get_devices = __root.ma_context_get_devices;
    pub const ma_context_get_device_info = __root.ma_context_get_device_info;
    pub const ma_context_is_loopback_supported = __root.ma_context_is_loopback_supported;
    pub const ma_device_init = __root.ma_device_init;
    pub const uninit = __root.ma_context_uninit;
    pub const get_log = __root.ma_context_get_log;
    pub const enumerate_devices = __root.ma_context_enumerate_devices;
    pub const get_devices = __root.ma_context_get_devices;
    pub const get_device_info = __root.ma_context_get_device_info;
    pub const is_loopback_supported = __root.ma_context_is_loopback_supported;
    pub const init = __root.ma_device_init;
};
pub const MA_CHANNEL_NONE: c_int = 0;
pub const MA_CHANNEL_MONO: c_int = 1;
pub const MA_CHANNEL_FRONT_LEFT: c_int = 2;
pub const MA_CHANNEL_FRONT_RIGHT: c_int = 3;
pub const MA_CHANNEL_FRONT_CENTER: c_int = 4;
pub const MA_CHANNEL_LFE: c_int = 5;
pub const MA_CHANNEL_BACK_LEFT: c_int = 6;
pub const MA_CHANNEL_BACK_RIGHT: c_int = 7;
pub const MA_CHANNEL_FRONT_LEFT_CENTER: c_int = 8;
pub const MA_CHANNEL_FRONT_RIGHT_CENTER: c_int = 9;
pub const MA_CHANNEL_BACK_CENTER: c_int = 10;
pub const MA_CHANNEL_SIDE_LEFT: c_int = 11;
pub const MA_CHANNEL_SIDE_RIGHT: c_int = 12;
pub const MA_CHANNEL_TOP_CENTER: c_int = 13;
pub const MA_CHANNEL_TOP_FRONT_LEFT: c_int = 14;
pub const MA_CHANNEL_TOP_FRONT_CENTER: c_int = 15;
pub const MA_CHANNEL_TOP_FRONT_RIGHT: c_int = 16;
pub const MA_CHANNEL_TOP_BACK_LEFT: c_int = 17;
pub const MA_CHANNEL_TOP_BACK_CENTER: c_int = 18;
pub const MA_CHANNEL_TOP_BACK_RIGHT: c_int = 19;
pub const MA_CHANNEL_AUX_0: c_int = 20;
pub const MA_CHANNEL_AUX_1: c_int = 21;
pub const MA_CHANNEL_AUX_2: c_int = 22;
pub const MA_CHANNEL_AUX_3: c_int = 23;
pub const MA_CHANNEL_AUX_4: c_int = 24;
pub const MA_CHANNEL_AUX_5: c_int = 25;
pub const MA_CHANNEL_AUX_6: c_int = 26;
pub const MA_CHANNEL_AUX_7: c_int = 27;
pub const MA_CHANNEL_AUX_8: c_int = 28;
pub const MA_CHANNEL_AUX_9: c_int = 29;
pub const MA_CHANNEL_AUX_10: c_int = 30;
pub const MA_CHANNEL_AUX_11: c_int = 31;
pub const MA_CHANNEL_AUX_12: c_int = 32;
pub const MA_CHANNEL_AUX_13: c_int = 33;
pub const MA_CHANNEL_AUX_14: c_int = 34;
pub const MA_CHANNEL_AUX_15: c_int = 35;
pub const MA_CHANNEL_AUX_16: c_int = 36;
pub const MA_CHANNEL_AUX_17: c_int = 37;
pub const MA_CHANNEL_AUX_18: c_int = 38;
pub const MA_CHANNEL_AUX_19: c_int = 39;
pub const MA_CHANNEL_AUX_20: c_int = 40;
pub const MA_CHANNEL_AUX_21: c_int = 41;
pub const MA_CHANNEL_AUX_22: c_int = 42;
pub const MA_CHANNEL_AUX_23: c_int = 43;
pub const MA_CHANNEL_AUX_24: c_int = 44;
pub const MA_CHANNEL_AUX_25: c_int = 45;
pub const MA_CHANNEL_AUX_26: c_int = 46;
pub const MA_CHANNEL_AUX_27: c_int = 47;
pub const MA_CHANNEL_AUX_28: c_int = 48;
pub const MA_CHANNEL_AUX_29: c_int = 49;
pub const MA_CHANNEL_AUX_30: c_int = 50;
pub const MA_CHANNEL_AUX_31: c_int = 51;
pub const MA_CHANNEL_POSITION_COUNT: c_int = 52;
pub const MA_CHANNEL_LEFT: c_int = 2;
pub const MA_CHANNEL_RIGHT: c_int = 3;
pub const _ma_channel_position = c_uint;
pub const MA_SUCCESS: c_int = 0;
pub const MA_ERROR: c_int = -1;
pub const MA_INVALID_ARGS: c_int = -2;
pub const MA_INVALID_OPERATION: c_int = -3;
pub const MA_OUT_OF_MEMORY: c_int = -4;
pub const MA_OUT_OF_RANGE: c_int = -5;
pub const MA_ACCESS_DENIED: c_int = -6;
pub const MA_DOES_NOT_EXIST: c_int = -7;
pub const MA_ALREADY_EXISTS: c_int = -8;
pub const MA_TOO_MANY_OPEN_FILES: c_int = -9;
pub const MA_INVALID_FILE: c_int = -10;
pub const MA_TOO_BIG: c_int = -11;
pub const MA_PATH_TOO_LONG: c_int = -12;
pub const MA_NAME_TOO_LONG: c_int = -13;
pub const MA_NOT_DIRECTORY: c_int = -14;
pub const MA_IS_DIRECTORY: c_int = -15;
pub const MA_DIRECTORY_NOT_EMPTY: c_int = -16;
pub const MA_AT_END: c_int = -17;
pub const MA_NO_SPACE: c_int = -18;
pub const MA_BUSY: c_int = -19;
pub const MA_IO_ERROR: c_int = -20;
pub const MA_INTERRUPT: c_int = -21;
pub const MA_UNAVAILABLE: c_int = -22;
pub const MA_ALREADY_IN_USE: c_int = -23;
pub const MA_BAD_ADDRESS: c_int = -24;
pub const MA_BAD_SEEK: c_int = -25;
pub const MA_BAD_PIPE: c_int = -26;
pub const MA_DEADLOCK: c_int = -27;
pub const MA_TOO_MANY_LINKS: c_int = -28;
pub const MA_NOT_IMPLEMENTED: c_int = -29;
pub const MA_NO_MESSAGE: c_int = -30;
pub const MA_BAD_MESSAGE: c_int = -31;
pub const MA_NO_DATA_AVAILABLE: c_int = -32;
pub const MA_INVALID_DATA: c_int = -33;
pub const MA_TIMEOUT: c_int = -34;
pub const MA_NO_NETWORK: c_int = -35;
pub const MA_NOT_UNIQUE: c_int = -36;
pub const MA_NOT_SOCKET: c_int = -37;
pub const MA_NO_ADDRESS: c_int = -38;
pub const MA_BAD_PROTOCOL: c_int = -39;
pub const MA_PROTOCOL_UNAVAILABLE: c_int = -40;
pub const MA_PROTOCOL_NOT_SUPPORTED: c_int = -41;
pub const MA_PROTOCOL_FAMILY_NOT_SUPPORTED: c_int = -42;
pub const MA_ADDRESS_FAMILY_NOT_SUPPORTED: c_int = -43;
pub const MA_SOCKET_NOT_SUPPORTED: c_int = -44;
pub const MA_CONNECTION_RESET: c_int = -45;
pub const MA_ALREADY_CONNECTED: c_int = -46;
pub const MA_NOT_CONNECTED: c_int = -47;
pub const MA_CONNECTION_REFUSED: c_int = -48;
pub const MA_NO_HOST: c_int = -49;
pub const MA_IN_PROGRESS: c_int = -50;
pub const MA_CANCELLED: c_int = -51;
pub const MA_MEMORY_ALREADY_MAPPED: c_int = -52;
pub const MA_CRC_MISMATCH: c_int = -100;
pub const MA_FORMAT_NOT_SUPPORTED: c_int = -200;
pub const MA_DEVICE_TYPE_NOT_SUPPORTED: c_int = -201;
pub const MA_SHARE_MODE_NOT_SUPPORTED: c_int = -202;
pub const MA_NO_BACKEND: c_int = -203;
pub const MA_NO_DEVICE: c_int = -204;
pub const MA_API_NOT_FOUND: c_int = -205;
pub const MA_INVALID_DEVICE_CONFIG: c_int = -206;
pub const MA_LOOP: c_int = -207;
pub const MA_BACKEND_NOT_ENABLED: c_int = -208;
pub const MA_DEVICE_NOT_INITIALIZED: c_int = -300;
pub const MA_DEVICE_ALREADY_INITIALIZED: c_int = -301;
pub const MA_DEVICE_NOT_STARTED: c_int = -302;
pub const MA_DEVICE_NOT_STOPPED: c_int = -303;
pub const MA_FAILED_TO_INIT_BACKEND: c_int = -400;
pub const MA_FAILED_TO_OPEN_BACKEND_DEVICE: c_int = -401;
pub const MA_FAILED_TO_START_BACKEND_DEVICE: c_int = -402;
pub const MA_FAILED_TO_STOP_BACKEND_DEVICE: c_int = -403;
pub const ma_result = c_int;
pub const ma_stream_format_pcm: c_int = 0;
pub const ma_stream_format = c_uint;
pub const ma_stream_layout_interleaved: c_int = 0;
pub const ma_stream_layout_deinterleaved: c_int = 1;
pub const ma_stream_layout = c_uint;
pub const ma_dither_mode_none: c_int = 0;
pub const ma_dither_mode_rectangle: c_int = 1;
pub const ma_dither_mode_triangle: c_int = 2;
pub const ma_dither_mode = c_uint;
pub const ma_format_unknown: c_int = 0;
pub const ma_format_u8: c_int = 1;
pub const ma_format_s16: c_int = 2;
pub const ma_format_s24: c_int = 3;
pub const ma_format_s32: c_int = 4;
pub const ma_format_f32: c_int = 5;
pub const ma_format_count: c_int = 6;
pub const ma_format = c_uint;
pub const ma_standard_sample_rate_48000: c_int = 48000;
pub const ma_standard_sample_rate_44100: c_int = 44100;
pub const ma_standard_sample_rate_32000: c_int = 32000;
pub const ma_standard_sample_rate_24000: c_int = 24000;
pub const ma_standard_sample_rate_22050: c_int = 22050;
pub const ma_standard_sample_rate_88200: c_int = 88200;
pub const ma_standard_sample_rate_96000: c_int = 96000;
pub const ma_standard_sample_rate_176400: c_int = 176400;
pub const ma_standard_sample_rate_192000: c_int = 192000;
pub const ma_standard_sample_rate_16000: c_int = 16000;
pub const ma_standard_sample_rate_11025: c_int = 11025;
pub const ma_standard_sample_rate_8000: c_int = 8000;
pub const ma_standard_sample_rate_352800: c_int = 352800;
pub const ma_standard_sample_rate_384000: c_int = 384000;
pub const ma_standard_sample_rate_min: c_int = 8000;
pub const ma_standard_sample_rate_max: c_int = 384000;
pub const ma_standard_sample_rate_count: c_int = 14;
pub const ma_standard_sample_rate = c_uint;
pub const ma_channel_mix_mode_rectangular: c_int = 0;
pub const ma_channel_mix_mode_simple: c_int = 1;
pub const ma_channel_mix_mode_custom_weights: c_int = 2;
pub const ma_channel_mix_mode_default: c_int = 0;
pub const ma_channel_mix_mode = c_uint;
pub const ma_standard_channel_map_microsoft: c_int = 0;
pub const ma_standard_channel_map_alsa: c_int = 1;
pub const ma_standard_channel_map_rfc3551: c_int = 2;
pub const ma_standard_channel_map_flac: c_int = 3;
pub const ma_standard_channel_map_vorbis: c_int = 4;
pub const ma_standard_channel_map_sound4: c_int = 5;
pub const ma_standard_channel_map_sndio: c_int = 6;
pub const ma_standard_channel_map_webaudio: c_int = 3;
pub const ma_standard_channel_map_default: c_int = 0;
pub const ma_standard_channel_map = c_uint;
pub const ma_performance_profile_low_latency: c_int = 0;
pub const ma_performance_profile_conservative: c_int = 1;
pub const ma_performance_profile = c_uint;
pub const ma_allocation_callbacks = extern struct {
    pUserData: ?*anyopaque = null,
    onMalloc: ?*const fn (sz: usize, pUserData: ?*anyopaque) callconv(.c) ?*anyopaque = null,
    onRealloc: ?*const fn (p: ?*anyopaque, sz: usize, pUserData: ?*anyopaque) callconv(.c) ?*anyopaque = null,
    onFree: ?*const fn (p: ?*anyopaque, pUserData: ?*anyopaque) callconv(.c) void = null,
    pub const ma_log_init = __root.ma_log_init;
    pub const init = __root.ma_log_init;
};
pub const ma_lcg = extern struct {
    state: ma_uint32 = 0,
};
pub const ma_atomic_uint32 = extern struct {
    value: ma_uint32 = 0,
};
pub const ma_atomic_int32 = extern struct {
    value: ma_int32 = 0,
};
pub const ma_atomic_uint64 = extern struct {
    value: ma_uint64 = 0,
};
pub const ma_atomic_float = extern struct {
    value: ma_float = 0,
};
pub const ma_atomic_bool32 = extern struct {
    value: ma_bool32 = 0,
};
pub const ma_spinlock = ma_uint32;
pub const ma_thread_priority_idle: c_int = -5;
pub const ma_thread_priority_lowest: c_int = -4;
pub const ma_thread_priority_low: c_int = -3;
pub const ma_thread_priority_normal: c_int = -2;
pub const ma_thread_priority_high: c_int = -1;
pub const ma_thread_priority_highest: c_int = 0;
pub const ma_thread_priority_realtime: c_int = 1;
pub const ma_thread_priority_default: c_int = 0;
pub const ma_thread_priority = c_int;
pub extern fn ma_version(pMajor: [*c]ma_uint32, pMinor: [*c]ma_uint32, pRevision: [*c]ma_uint32) void;
pub extern fn ma_version_string() [*c]const u8;
pub const __builtin_va_list = [*c]u8;
pub const va_list = __builtin_va_list;
pub const __gnuc_va_list = __builtin_va_list;
pub const ma_log_callback_proc = ?*const fn (pUserData: ?*anyopaque, level: ma_uint32, pMessage: [*c]const u8) callconv(.c) void;
pub const ma_log_callback = extern struct {
    onLog: ma_log_callback_proc = null,
    pUserData: ?*anyopaque = null,
};
pub extern fn ma_log_callback_init(onLog: ma_log_callback_proc, pUserData: ?*anyopaque) ma_log_callback;
pub const ma_log = extern struct {
    callbacks: [4]ma_log_callback = @import("std").mem.zeroes([4]ma_log_callback),
    callbackCount: ma_uint32 = 0,
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    lock: ma_mutex = null,
    pub const ma_log_uninit = __root.ma_log_uninit;
    pub const ma_log_register_callback = __root.ma_log_register_callback;
    pub const ma_log_unregister_callback = __root.ma_log_unregister_callback;
    pub const ma_log_post = __root.ma_log_post;
    pub const ma_log_postv = __root.ma_log_postv;
    pub const ma_log_postf = __root.ma_log_postf;
    pub const uninit = __root.ma_log_uninit;
    pub const register_callback = __root.ma_log_register_callback;
    pub const unregister_callback = __root.ma_log_unregister_callback;
    pub const post = __root.ma_log_post;
    pub const postv = __root.ma_log_postv;
    pub const postf = __root.ma_log_postf;
};
pub extern fn ma_log_init(pAllocationCallbacks: [*c]const ma_allocation_callbacks, pLog: [*c]ma_log) ma_result;
pub extern fn ma_log_uninit(pLog: [*c]ma_log) void;
pub extern fn ma_log_register_callback(pLog: [*c]ma_log, callback: ma_log_callback) ma_result;
pub extern fn ma_log_unregister_callback(pLog: [*c]ma_log, callback: ma_log_callback) ma_result;
pub extern fn ma_log_post(pLog: [*c]ma_log, level: ma_uint32, pMessage: [*c]const u8) ma_result;
pub extern fn ma_log_postv(pLog: [*c]ma_log, level: ma_uint32, pFormat: [*c]const u8, args: va_list) ma_result;
pub extern fn ma_log_postf(pLog: [*c]ma_log, level: ma_uint32, pFormat: [*c]const u8, ...) ma_result;
pub const ma_biquad_coefficient = extern union {
    f32: f32,
    s32: ma_int32,
};
pub const ma_biquad_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    b0: f64 = 0,
    b1: f64 = 0,
    b2: f64 = 0,
    a0: f64 = 0,
    a1: f64 = 0,
    a2: f64 = 0,
    pub const ma_biquad_get_heap_size = __root.ma_biquad_get_heap_size;
    pub const ma_biquad_init_preallocated = __root.ma_biquad_init_preallocated;
    pub const ma_biquad_init = __root.ma_biquad_init;
    pub const ma_biquad_reinit = __root.ma_biquad_reinit;
    pub const ma_biquad_node_reinit = __root.ma_biquad_node_reinit;
    pub const size = __root.ma_biquad_get_heap_size;
    pub const preallocated = __root.ma_biquad_init_preallocated;
    pub const init = __root.ma_biquad_init;
    pub const reinit = __root.ma_biquad_reinit;
};
pub extern fn ma_biquad_config_init(format: ma_format, channels: ma_uint32, b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) ma_biquad_config;
pub const ma_biquad = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    b0: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    b1: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    b2: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    a1: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    a2: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    pR1: [*c]ma_biquad_coefficient = null,
    pR2: [*c]ma_biquad_coefficient = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_biquad_uninit = __root.ma_biquad_uninit;
    pub const ma_biquad_clear_cache = __root.ma_biquad_clear_cache;
    pub const ma_biquad_process_pcm_frames = __root.ma_biquad_process_pcm_frames;
    pub const ma_biquad_get_latency = __root.ma_biquad_get_latency;
    pub const uninit = __root.ma_biquad_uninit;
    pub const clear_cache = __root.ma_biquad_clear_cache;
    pub const process_pcm_frames = __root.ma_biquad_process_pcm_frames;
    pub const get_latency = __root.ma_biquad_get_latency;
};
pub extern fn ma_biquad_get_heap_size(pConfig: [*c]const ma_biquad_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_biquad_init_preallocated(pConfig: [*c]const ma_biquad_config, pHeap: ?*anyopaque, pBQ: [*c]ma_biquad) ma_result;
pub extern fn ma_biquad_init(pConfig: [*c]const ma_biquad_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pBQ: [*c]ma_biquad) ma_result;
pub extern fn ma_biquad_uninit(pBQ: [*c]ma_biquad, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_biquad_reinit(pConfig: [*c]const ma_biquad_config, pBQ: [*c]ma_biquad) ma_result;
pub extern fn ma_biquad_clear_cache(pBQ: [*c]ma_biquad) ma_result;
pub extern fn ma_biquad_process_pcm_frames(pBQ: [*c]ma_biquad, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_biquad_get_latency(pBQ: [*c]const ma_biquad) ma_uint32;
pub const ma_lpf1_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cutoffFrequency: f64 = 0,
    q: f64 = 0,
    pub const ma_lpf1_get_heap_size = __root.ma_lpf1_get_heap_size;
    pub const ma_lpf1_init_preallocated = __root.ma_lpf1_init_preallocated;
    pub const ma_lpf1_init = __root.ma_lpf1_init;
    pub const ma_lpf1_reinit = __root.ma_lpf1_reinit;
    pub const ma_lpf2_get_heap_size = __root.ma_lpf2_get_heap_size;
    pub const ma_lpf2_init_preallocated = __root.ma_lpf2_init_preallocated;
    pub const ma_lpf2_init = __root.ma_lpf2_init;
    pub const ma_lpf2_reinit = __root.ma_lpf2_reinit;
    pub const size = __root.ma_lpf1_get_heap_size;
    pub const preallocated = __root.ma_lpf1_init_preallocated;
    pub const init = __root.ma_lpf1_init;
    pub const reinit = __root.ma_lpf1_reinit;
};
pub const ma_lpf2_config = ma_lpf1_config;
pub extern fn ma_lpf1_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64) ma_lpf1_config;
pub extern fn ma_lpf2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, q: f64) ma_lpf2_config;
pub const ma_lpf1 = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    a: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    pR1: [*c]ma_biquad_coefficient = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_lpf1_uninit = __root.ma_lpf1_uninit;
    pub const ma_lpf1_clear_cache = __root.ma_lpf1_clear_cache;
    pub const ma_lpf1_process_pcm_frames = __root.ma_lpf1_process_pcm_frames;
    pub const ma_lpf1_get_latency = __root.ma_lpf1_get_latency;
    pub const uninit = __root.ma_lpf1_uninit;
    pub const clear_cache = __root.ma_lpf1_clear_cache;
    pub const process_pcm_frames = __root.ma_lpf1_process_pcm_frames;
    pub const get_latency = __root.ma_lpf1_get_latency;
};
pub extern fn ma_lpf1_get_heap_size(pConfig: [*c]const ma_lpf1_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_lpf1_init_preallocated(pConfig: [*c]const ma_lpf1_config, pHeap: ?*anyopaque, pLPF: [*c]ma_lpf1) ma_result;
pub extern fn ma_lpf1_init(pConfig: [*c]const ma_lpf1_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pLPF: [*c]ma_lpf1) ma_result;
pub extern fn ma_lpf1_uninit(pLPF: [*c]ma_lpf1, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_lpf1_reinit(pConfig: [*c]const ma_lpf1_config, pLPF: [*c]ma_lpf1) ma_result;
pub extern fn ma_lpf1_clear_cache(pLPF: [*c]ma_lpf1) ma_result;
pub extern fn ma_lpf1_process_pcm_frames(pLPF: [*c]ma_lpf1, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_lpf1_get_latency(pLPF: [*c]const ma_lpf1) ma_uint32;
pub const ma_lpf2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_lpf2_uninit = __root.ma_lpf2_uninit;
    pub const ma_lpf2_clear_cache = __root.ma_lpf2_clear_cache;
    pub const ma_lpf2_process_pcm_frames = __root.ma_lpf2_process_pcm_frames;
    pub const ma_lpf2_get_latency = __root.ma_lpf2_get_latency;
    pub const uninit = __root.ma_lpf2_uninit;
    pub const clear_cache = __root.ma_lpf2_clear_cache;
    pub const process_pcm_frames = __root.ma_lpf2_process_pcm_frames;
    pub const get_latency = __root.ma_lpf2_get_latency;
};
pub extern fn ma_lpf2_get_heap_size(pConfig: [*c]const ma_lpf2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_lpf2_init_preallocated(pConfig: [*c]const ma_lpf2_config, pHeap: ?*anyopaque, pHPF: [*c]ma_lpf2) ma_result;
pub extern fn ma_lpf2_init(pConfig: [*c]const ma_lpf2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pLPF: [*c]ma_lpf2) ma_result;
pub extern fn ma_lpf2_uninit(pLPF: [*c]ma_lpf2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_lpf2_reinit(pConfig: [*c]const ma_lpf2_config, pLPF: [*c]ma_lpf2) ma_result;
pub extern fn ma_lpf2_clear_cache(pLPF: [*c]ma_lpf2) ma_result;
pub extern fn ma_lpf2_process_pcm_frames(pLPF: [*c]ma_lpf2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_lpf2_get_latency(pLPF: [*c]const ma_lpf2) ma_uint32;
pub const ma_lpf_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cutoffFrequency: f64 = 0,
    order: ma_uint32 = 0,
    pub const ma_lpf_get_heap_size = __root.ma_lpf_get_heap_size;
    pub const ma_lpf_init_preallocated = __root.ma_lpf_init_preallocated;
    pub const ma_lpf_init = __root.ma_lpf_init;
    pub const ma_lpf_reinit = __root.ma_lpf_reinit;
    pub const ma_lpf_node_reinit = __root.ma_lpf_node_reinit;
    pub const size = __root.ma_lpf_get_heap_size;
    pub const preallocated = __root.ma_lpf_init_preallocated;
    pub const init = __root.ma_lpf_init;
    pub const reinit = __root.ma_lpf_reinit;
};
pub extern fn ma_lpf_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, order: ma_uint32) ma_lpf_config;
pub const ma_lpf = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    lpf1Count: ma_uint32 = 0,
    lpf2Count: ma_uint32 = 0,
    pLPF1: [*c]ma_lpf1 = null,
    pLPF2: [*c]ma_lpf2 = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_lpf_uninit = __root.ma_lpf_uninit;
    pub const ma_lpf_clear_cache = __root.ma_lpf_clear_cache;
    pub const ma_lpf_process_pcm_frames = __root.ma_lpf_process_pcm_frames;
    pub const ma_lpf_get_latency = __root.ma_lpf_get_latency;
    pub const uninit = __root.ma_lpf_uninit;
    pub const clear_cache = __root.ma_lpf_clear_cache;
    pub const process_pcm_frames = __root.ma_lpf_process_pcm_frames;
    pub const get_latency = __root.ma_lpf_get_latency;
};
pub extern fn ma_lpf_get_heap_size(pConfig: [*c]const ma_lpf_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_lpf_init_preallocated(pConfig: [*c]const ma_lpf_config, pHeap: ?*anyopaque, pLPF: [*c]ma_lpf) ma_result;
pub extern fn ma_lpf_init(pConfig: [*c]const ma_lpf_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pLPF: [*c]ma_lpf) ma_result;
pub extern fn ma_lpf_uninit(pLPF: [*c]ma_lpf, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_lpf_reinit(pConfig: [*c]const ma_lpf_config, pLPF: [*c]ma_lpf) ma_result;
pub extern fn ma_lpf_clear_cache(pLPF: [*c]ma_lpf) ma_result;
pub extern fn ma_lpf_process_pcm_frames(pLPF: [*c]ma_lpf, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_lpf_get_latency(pLPF: [*c]const ma_lpf) ma_uint32;
pub const ma_hpf1_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cutoffFrequency: f64 = 0,
    q: f64 = 0,
    pub const ma_hpf1_get_heap_size = __root.ma_hpf1_get_heap_size;
    pub const ma_hpf1_init_preallocated = __root.ma_hpf1_init_preallocated;
    pub const ma_hpf1_init = __root.ma_hpf1_init;
    pub const ma_hpf1_reinit = __root.ma_hpf1_reinit;
    pub const ma_hpf2_get_heap_size = __root.ma_hpf2_get_heap_size;
    pub const ma_hpf2_init_preallocated = __root.ma_hpf2_init_preallocated;
    pub const ma_hpf2_init = __root.ma_hpf2_init;
    pub const ma_hpf2_reinit = __root.ma_hpf2_reinit;
    pub const size = __root.ma_hpf1_get_heap_size;
    pub const preallocated = __root.ma_hpf1_init_preallocated;
    pub const init = __root.ma_hpf1_init;
    pub const reinit = __root.ma_hpf1_reinit;
};
pub const ma_hpf2_config = ma_hpf1_config;
pub extern fn ma_hpf1_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64) ma_hpf1_config;
pub extern fn ma_hpf2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, q: f64) ma_hpf2_config;
pub const ma_hpf1 = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    a: ma_biquad_coefficient = @import("std").mem.zeroes(ma_biquad_coefficient),
    pR1: [*c]ma_biquad_coefficient = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_hpf1_uninit = __root.ma_hpf1_uninit;
    pub const ma_hpf1_process_pcm_frames = __root.ma_hpf1_process_pcm_frames;
    pub const ma_hpf1_get_latency = __root.ma_hpf1_get_latency;
    pub const uninit = __root.ma_hpf1_uninit;
    pub const process_pcm_frames = __root.ma_hpf1_process_pcm_frames;
    pub const get_latency = __root.ma_hpf1_get_latency;
};
pub extern fn ma_hpf1_get_heap_size(pConfig: [*c]const ma_hpf1_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_hpf1_init_preallocated(pConfig: [*c]const ma_hpf1_config, pHeap: ?*anyopaque, pLPF: [*c]ma_hpf1) ma_result;
pub extern fn ma_hpf1_init(pConfig: [*c]const ma_hpf1_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pHPF: [*c]ma_hpf1) ma_result;
pub extern fn ma_hpf1_uninit(pHPF: [*c]ma_hpf1, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_hpf1_reinit(pConfig: [*c]const ma_hpf1_config, pHPF: [*c]ma_hpf1) ma_result;
pub extern fn ma_hpf1_process_pcm_frames(pHPF: [*c]ma_hpf1, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_hpf1_get_latency(pHPF: [*c]const ma_hpf1) ma_uint32;
pub const ma_hpf2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_hpf2_uninit = __root.ma_hpf2_uninit;
    pub const ma_hpf2_process_pcm_frames = __root.ma_hpf2_process_pcm_frames;
    pub const ma_hpf2_get_latency = __root.ma_hpf2_get_latency;
    pub const uninit = __root.ma_hpf2_uninit;
    pub const process_pcm_frames = __root.ma_hpf2_process_pcm_frames;
    pub const get_latency = __root.ma_hpf2_get_latency;
};
pub extern fn ma_hpf2_get_heap_size(pConfig: [*c]const ma_hpf2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_hpf2_init_preallocated(pConfig: [*c]const ma_hpf2_config, pHeap: ?*anyopaque, pHPF: [*c]ma_hpf2) ma_result;
pub extern fn ma_hpf2_init(pConfig: [*c]const ma_hpf2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pHPF: [*c]ma_hpf2) ma_result;
pub extern fn ma_hpf2_uninit(pHPF: [*c]ma_hpf2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_hpf2_reinit(pConfig: [*c]const ma_hpf2_config, pHPF: [*c]ma_hpf2) ma_result;
pub extern fn ma_hpf2_process_pcm_frames(pHPF: [*c]ma_hpf2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_hpf2_get_latency(pHPF: [*c]const ma_hpf2) ma_uint32;
pub const ma_hpf_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cutoffFrequency: f64 = 0,
    order: ma_uint32 = 0,
    pub const ma_hpf_get_heap_size = __root.ma_hpf_get_heap_size;
    pub const ma_hpf_init_preallocated = __root.ma_hpf_init_preallocated;
    pub const ma_hpf_init = __root.ma_hpf_init;
    pub const ma_hpf_reinit = __root.ma_hpf_reinit;
    pub const ma_hpf_node_reinit = __root.ma_hpf_node_reinit;
    pub const size = __root.ma_hpf_get_heap_size;
    pub const preallocated = __root.ma_hpf_init_preallocated;
    pub const init = __root.ma_hpf_init;
    pub const reinit = __root.ma_hpf_reinit;
};
pub extern fn ma_hpf_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, order: ma_uint32) ma_hpf_config;
pub const ma_hpf = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    hpf1Count: ma_uint32 = 0,
    hpf2Count: ma_uint32 = 0,
    pHPF1: [*c]ma_hpf1 = null,
    pHPF2: [*c]ma_hpf2 = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_hpf_uninit = __root.ma_hpf_uninit;
    pub const ma_hpf_process_pcm_frames = __root.ma_hpf_process_pcm_frames;
    pub const ma_hpf_get_latency = __root.ma_hpf_get_latency;
    pub const uninit = __root.ma_hpf_uninit;
    pub const process_pcm_frames = __root.ma_hpf_process_pcm_frames;
    pub const get_latency = __root.ma_hpf_get_latency;
};
pub extern fn ma_hpf_get_heap_size(pConfig: [*c]const ma_hpf_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_hpf_init_preallocated(pConfig: [*c]const ma_hpf_config, pHeap: ?*anyopaque, pLPF: [*c]ma_hpf) ma_result;
pub extern fn ma_hpf_init(pConfig: [*c]const ma_hpf_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pHPF: [*c]ma_hpf) ma_result;
pub extern fn ma_hpf_uninit(pHPF: [*c]ma_hpf, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_hpf_reinit(pConfig: [*c]const ma_hpf_config, pHPF: [*c]ma_hpf) ma_result;
pub extern fn ma_hpf_process_pcm_frames(pHPF: [*c]ma_hpf, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_hpf_get_latency(pHPF: [*c]const ma_hpf) ma_uint32;
pub const ma_bpf2_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cutoffFrequency: f64 = 0,
    q: f64 = 0,
    pub const ma_bpf2_get_heap_size = __root.ma_bpf2_get_heap_size;
    pub const ma_bpf2_init_preallocated = __root.ma_bpf2_init_preallocated;
    pub const ma_bpf2_init = __root.ma_bpf2_init;
    pub const ma_bpf2_reinit = __root.ma_bpf2_reinit;
    pub const size = __root.ma_bpf2_get_heap_size;
    pub const preallocated = __root.ma_bpf2_init_preallocated;
    pub const init = __root.ma_bpf2_init;
    pub const reinit = __root.ma_bpf2_reinit;
};
pub extern fn ma_bpf2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, q: f64) ma_bpf2_config;
pub const ma_bpf2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_bpf2_uninit = __root.ma_bpf2_uninit;
    pub const ma_bpf2_process_pcm_frames = __root.ma_bpf2_process_pcm_frames;
    pub const ma_bpf2_get_latency = __root.ma_bpf2_get_latency;
    pub const uninit = __root.ma_bpf2_uninit;
    pub const process_pcm_frames = __root.ma_bpf2_process_pcm_frames;
    pub const get_latency = __root.ma_bpf2_get_latency;
};
pub extern fn ma_bpf2_get_heap_size(pConfig: [*c]const ma_bpf2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_bpf2_init_preallocated(pConfig: [*c]const ma_bpf2_config, pHeap: ?*anyopaque, pBPF: [*c]ma_bpf2) ma_result;
pub extern fn ma_bpf2_init(pConfig: [*c]const ma_bpf2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pBPF: [*c]ma_bpf2) ma_result;
pub extern fn ma_bpf2_uninit(pBPF: [*c]ma_bpf2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_bpf2_reinit(pConfig: [*c]const ma_bpf2_config, pBPF: [*c]ma_bpf2) ma_result;
pub extern fn ma_bpf2_process_pcm_frames(pBPF: [*c]ma_bpf2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_bpf2_get_latency(pBPF: [*c]const ma_bpf2) ma_uint32;
pub const ma_bpf_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cutoffFrequency: f64 = 0,
    order: ma_uint32 = 0,
    pub const ma_bpf_get_heap_size = __root.ma_bpf_get_heap_size;
    pub const ma_bpf_init_preallocated = __root.ma_bpf_init_preallocated;
    pub const ma_bpf_init = __root.ma_bpf_init;
    pub const ma_bpf_reinit = __root.ma_bpf_reinit;
    pub const ma_bpf_node_reinit = __root.ma_bpf_node_reinit;
    pub const size = __root.ma_bpf_get_heap_size;
    pub const preallocated = __root.ma_bpf_init_preallocated;
    pub const init = __root.ma_bpf_init;
    pub const reinit = __root.ma_bpf_reinit;
};
pub extern fn ma_bpf_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, order: ma_uint32) ma_bpf_config;
pub const ma_bpf = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    bpf2Count: ma_uint32 = 0,
    pBPF2: [*c]ma_bpf2 = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_bpf_uninit = __root.ma_bpf_uninit;
    pub const ma_bpf_process_pcm_frames = __root.ma_bpf_process_pcm_frames;
    pub const ma_bpf_get_latency = __root.ma_bpf_get_latency;
    pub const uninit = __root.ma_bpf_uninit;
    pub const process_pcm_frames = __root.ma_bpf_process_pcm_frames;
    pub const get_latency = __root.ma_bpf_get_latency;
};
pub extern fn ma_bpf_get_heap_size(pConfig: [*c]const ma_bpf_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_bpf_init_preallocated(pConfig: [*c]const ma_bpf_config, pHeap: ?*anyopaque, pBPF: [*c]ma_bpf) ma_result;
pub extern fn ma_bpf_init(pConfig: [*c]const ma_bpf_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pBPF: [*c]ma_bpf) ma_result;
pub extern fn ma_bpf_uninit(pBPF: [*c]ma_bpf, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_bpf_reinit(pConfig: [*c]const ma_bpf_config, pBPF: [*c]ma_bpf) ma_result;
pub extern fn ma_bpf_process_pcm_frames(pBPF: [*c]ma_bpf, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_bpf_get_latency(pBPF: [*c]const ma_bpf) ma_uint32;
pub const ma_notch2_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    q: f64 = 0,
    frequency: f64 = 0,
    pub const ma_notch2_get_heap_size = __root.ma_notch2_get_heap_size;
    pub const ma_notch2_init_preallocated = __root.ma_notch2_init_preallocated;
    pub const ma_notch2_init = __root.ma_notch2_init;
    pub const ma_notch2_reinit = __root.ma_notch2_reinit;
    pub const ma_notch_node_reinit = __root.ma_notch_node_reinit;
    pub const size = __root.ma_notch2_get_heap_size;
    pub const preallocated = __root.ma_notch2_init_preallocated;
    pub const init = __root.ma_notch2_init;
    pub const reinit = __root.ma_notch2_reinit;
};
pub const ma_notch_config = ma_notch2_config;
pub extern fn ma_notch2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, q: f64, frequency: f64) ma_notch2_config;
pub const ma_notch2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_notch2_uninit = __root.ma_notch2_uninit;
    pub const ma_notch2_process_pcm_frames = __root.ma_notch2_process_pcm_frames;
    pub const ma_notch2_get_latency = __root.ma_notch2_get_latency;
    pub const uninit = __root.ma_notch2_uninit;
    pub const process_pcm_frames = __root.ma_notch2_process_pcm_frames;
    pub const get_latency = __root.ma_notch2_get_latency;
};
pub extern fn ma_notch2_get_heap_size(pConfig: [*c]const ma_notch2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_notch2_init_preallocated(pConfig: [*c]const ma_notch2_config, pHeap: ?*anyopaque, pFilter: [*c]ma_notch2) ma_result;
pub extern fn ma_notch2_init(pConfig: [*c]const ma_notch2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pFilter: [*c]ma_notch2) ma_result;
pub extern fn ma_notch2_uninit(pFilter: [*c]ma_notch2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_notch2_reinit(pConfig: [*c]const ma_notch2_config, pFilter: [*c]ma_notch2) ma_result;
pub extern fn ma_notch2_process_pcm_frames(pFilter: [*c]ma_notch2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_notch2_get_latency(pFilter: [*c]const ma_notch2) ma_uint32;
pub const ma_peak2_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    gainDB: f64 = 0,
    q: f64 = 0,
    frequency: f64 = 0,
    pub const ma_peak2_get_heap_size = __root.ma_peak2_get_heap_size;
    pub const ma_peak2_init_preallocated = __root.ma_peak2_init_preallocated;
    pub const ma_peak2_init = __root.ma_peak2_init;
    pub const ma_peak2_reinit = __root.ma_peak2_reinit;
    pub const ma_peak_node_reinit = __root.ma_peak_node_reinit;
    pub const size = __root.ma_peak2_get_heap_size;
    pub const preallocated = __root.ma_peak2_init_preallocated;
    pub const init = __root.ma_peak2_init;
    pub const reinit = __root.ma_peak2_reinit;
};
pub const ma_peak_config = ma_peak2_config;
pub extern fn ma_peak2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, gainDB: f64, q: f64, frequency: f64) ma_peak2_config;
pub const ma_peak2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_peak2_uninit = __root.ma_peak2_uninit;
    pub const ma_peak2_process_pcm_frames = __root.ma_peak2_process_pcm_frames;
    pub const ma_peak2_get_latency = __root.ma_peak2_get_latency;
    pub const uninit = __root.ma_peak2_uninit;
    pub const process_pcm_frames = __root.ma_peak2_process_pcm_frames;
    pub const get_latency = __root.ma_peak2_get_latency;
};
pub extern fn ma_peak2_get_heap_size(pConfig: [*c]const ma_peak2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_peak2_init_preallocated(pConfig: [*c]const ma_peak2_config, pHeap: ?*anyopaque, pFilter: [*c]ma_peak2) ma_result;
pub extern fn ma_peak2_init(pConfig: [*c]const ma_peak2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pFilter: [*c]ma_peak2) ma_result;
pub extern fn ma_peak2_uninit(pFilter: [*c]ma_peak2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_peak2_reinit(pConfig: [*c]const ma_peak2_config, pFilter: [*c]ma_peak2) ma_result;
pub extern fn ma_peak2_process_pcm_frames(pFilter: [*c]ma_peak2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_peak2_get_latency(pFilter: [*c]const ma_peak2) ma_uint32;
pub const ma_loshelf2_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    gainDB: f64 = 0,
    shelfSlope: f64 = 0,
    frequency: f64 = 0,
    pub const ma_loshelf2_get_heap_size = __root.ma_loshelf2_get_heap_size;
    pub const ma_loshelf2_init_preallocated = __root.ma_loshelf2_init_preallocated;
    pub const ma_loshelf2_init = __root.ma_loshelf2_init;
    pub const ma_loshelf2_reinit = __root.ma_loshelf2_reinit;
    pub const ma_loshelf_node_reinit = __root.ma_loshelf_node_reinit;
    pub const size = __root.ma_loshelf2_get_heap_size;
    pub const preallocated = __root.ma_loshelf2_init_preallocated;
    pub const init = __root.ma_loshelf2_init;
    pub const reinit = __root.ma_loshelf2_reinit;
};
pub const ma_loshelf_config = ma_loshelf2_config;
pub extern fn ma_loshelf2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, gainDB: f64, shelfSlope: f64, frequency: f64) ma_loshelf2_config;
pub const ma_loshelf2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_loshelf2_uninit = __root.ma_loshelf2_uninit;
    pub const ma_loshelf2_process_pcm_frames = __root.ma_loshelf2_process_pcm_frames;
    pub const ma_loshelf2_get_latency = __root.ma_loshelf2_get_latency;
    pub const uninit = __root.ma_loshelf2_uninit;
    pub const process_pcm_frames = __root.ma_loshelf2_process_pcm_frames;
    pub const get_latency = __root.ma_loshelf2_get_latency;
};
pub extern fn ma_loshelf2_get_heap_size(pConfig: [*c]const ma_loshelf2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_loshelf2_init_preallocated(pConfig: [*c]const ma_loshelf2_config, pHeap: ?*anyopaque, pFilter: [*c]ma_loshelf2) ma_result;
pub extern fn ma_loshelf2_init(pConfig: [*c]const ma_loshelf2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pFilter: [*c]ma_loshelf2) ma_result;
pub extern fn ma_loshelf2_uninit(pFilter: [*c]ma_loshelf2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_loshelf2_reinit(pConfig: [*c]const ma_loshelf2_config, pFilter: [*c]ma_loshelf2) ma_result;
pub extern fn ma_loshelf2_process_pcm_frames(pFilter: [*c]ma_loshelf2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_loshelf2_get_latency(pFilter: [*c]const ma_loshelf2) ma_uint32;
pub const ma_hishelf2_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    gainDB: f64 = 0,
    shelfSlope: f64 = 0,
    frequency: f64 = 0,
    pub const ma_hishelf2_get_heap_size = __root.ma_hishelf2_get_heap_size;
    pub const ma_hishelf2_init_preallocated = __root.ma_hishelf2_init_preallocated;
    pub const ma_hishelf2_init = __root.ma_hishelf2_init;
    pub const ma_hishelf2_reinit = __root.ma_hishelf2_reinit;
    pub const ma_hishelf_node_reinit = __root.ma_hishelf_node_reinit;
    pub const size = __root.ma_hishelf2_get_heap_size;
    pub const preallocated = __root.ma_hishelf2_init_preallocated;
    pub const init = __root.ma_hishelf2_init;
    pub const reinit = __root.ma_hishelf2_reinit;
};
pub const ma_hishelf_config = ma_hishelf2_config;
pub extern fn ma_hishelf2_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32, gainDB: f64, shelfSlope: f64, frequency: f64) ma_hishelf2_config;
pub const ma_hishelf2 = extern struct {
    bq: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_hishelf2_uninit = __root.ma_hishelf2_uninit;
    pub const ma_hishelf2_process_pcm_frames = __root.ma_hishelf2_process_pcm_frames;
    pub const ma_hishelf2_get_latency = __root.ma_hishelf2_get_latency;
    pub const uninit = __root.ma_hishelf2_uninit;
    pub const process_pcm_frames = __root.ma_hishelf2_process_pcm_frames;
    pub const get_latency = __root.ma_hishelf2_get_latency;
};
pub extern fn ma_hishelf2_get_heap_size(pConfig: [*c]const ma_hishelf2_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_hishelf2_init_preallocated(pConfig: [*c]const ma_hishelf2_config, pHeap: ?*anyopaque, pFilter: [*c]ma_hishelf2) ma_result;
pub extern fn ma_hishelf2_init(pConfig: [*c]const ma_hishelf2_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pFilter: [*c]ma_hishelf2) ma_result;
pub extern fn ma_hishelf2_uninit(pFilter: [*c]ma_hishelf2, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_hishelf2_reinit(pConfig: [*c]const ma_hishelf2_config, pFilter: [*c]ma_hishelf2) ma_result;
pub extern fn ma_hishelf2_process_pcm_frames(pFilter: [*c]ma_hishelf2, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_hishelf2_get_latency(pFilter: [*c]const ma_hishelf2) ma_uint32;
pub const ma_delay_config = extern struct {
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    delayInFrames: ma_uint32 = 0,
    delayStart: ma_bool32 = 0,
    wet: f32 = 0,
    dry: f32 = 0,
    decay: f32 = 0,
    pub const ma_delay_init = __root.ma_delay_init;
    pub const init = __root.ma_delay_init;
};
pub extern fn ma_delay_config_init(channels: ma_uint32, sampleRate: ma_uint32, delayInFrames: ma_uint32, decay: f32) ma_delay_config;
pub const ma_delay = extern struct {
    config: ma_delay_config = @import("std").mem.zeroes(ma_delay_config),
    cursor: ma_uint32 = 0,
    bufferSizeInFrames: ma_uint32 = 0,
    pBuffer: [*c]f32 = null,
    pub const ma_delay_uninit = __root.ma_delay_uninit;
    pub const ma_delay_process_pcm_frames = __root.ma_delay_process_pcm_frames;
    pub const ma_delay_set_wet = __root.ma_delay_set_wet;
    pub const ma_delay_get_wet = __root.ma_delay_get_wet;
    pub const ma_delay_set_dry = __root.ma_delay_set_dry;
    pub const ma_delay_get_dry = __root.ma_delay_get_dry;
    pub const ma_delay_set_decay = __root.ma_delay_set_decay;
    pub const ma_delay_get_decay = __root.ma_delay_get_decay;
    pub const uninit = __root.ma_delay_uninit;
    pub const process_pcm_frames = __root.ma_delay_process_pcm_frames;
    pub const set_wet = __root.ma_delay_set_wet;
    pub const get_wet = __root.ma_delay_get_wet;
    pub const set_dry = __root.ma_delay_set_dry;
    pub const get_dry = __root.ma_delay_get_dry;
    pub const set_decay = __root.ma_delay_set_decay;
    pub const get_decay = __root.ma_delay_get_decay;
};
pub extern fn ma_delay_init(pConfig: [*c]const ma_delay_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pDelay: [*c]ma_delay) ma_result;
pub extern fn ma_delay_uninit(pDelay: [*c]ma_delay, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_delay_process_pcm_frames(pDelay: [*c]ma_delay, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint32) ma_result;
pub extern fn ma_delay_set_wet(pDelay: [*c]ma_delay, value: f32) void;
pub extern fn ma_delay_get_wet(pDelay: [*c]const ma_delay) f32;
pub extern fn ma_delay_set_dry(pDelay: [*c]ma_delay, value: f32) void;
pub extern fn ma_delay_get_dry(pDelay: [*c]const ma_delay) f32;
pub extern fn ma_delay_set_decay(pDelay: [*c]ma_delay, value: f32) void;
pub extern fn ma_delay_get_decay(pDelay: [*c]const ma_delay) f32;
pub const ma_gainer_config = extern struct {
    channels: ma_uint32 = 0,
    smoothTimeInFrames: ma_uint32 = 0,
    pub const ma_gainer_get_heap_size = __root.ma_gainer_get_heap_size;
    pub const ma_gainer_init_preallocated = __root.ma_gainer_init_preallocated;
    pub const ma_gainer_init = __root.ma_gainer_init;
    pub const size = __root.ma_gainer_get_heap_size;
    pub const preallocated = __root.ma_gainer_init_preallocated;
    pub const init = __root.ma_gainer_init;
};
pub extern fn ma_gainer_config_init(channels: ma_uint32, smoothTimeInFrames: ma_uint32) ma_gainer_config;
pub const ma_gainer = extern struct {
    config: ma_gainer_config = @import("std").mem.zeroes(ma_gainer_config),
    t: ma_uint32 = 0,
    masterVolume: f32 = 0,
    pOldGains: [*c]f32 = null,
    pNewGains: [*c]f32 = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_gainer_uninit = __root.ma_gainer_uninit;
    pub const ma_gainer_process_pcm_frames = __root.ma_gainer_process_pcm_frames;
    pub const ma_gainer_set_gain = __root.ma_gainer_set_gain;
    pub const ma_gainer_set_gains = __root.ma_gainer_set_gains;
    pub const ma_gainer_set_master_volume = __root.ma_gainer_set_master_volume;
    pub const ma_gainer_get_master_volume = __root.ma_gainer_get_master_volume;
    pub const uninit = __root.ma_gainer_uninit;
    pub const process_pcm_frames = __root.ma_gainer_process_pcm_frames;
    pub const set_gain = __root.ma_gainer_set_gain;
    pub const set_gains = __root.ma_gainer_set_gains;
    pub const set_master_volume = __root.ma_gainer_set_master_volume;
    pub const get_master_volume = __root.ma_gainer_get_master_volume;
};
pub extern fn ma_gainer_get_heap_size(pConfig: [*c]const ma_gainer_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_gainer_init_preallocated(pConfig: [*c]const ma_gainer_config, pHeap: ?*anyopaque, pGainer: [*c]ma_gainer) ma_result;
pub extern fn ma_gainer_init(pConfig: [*c]const ma_gainer_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pGainer: [*c]ma_gainer) ma_result;
pub extern fn ma_gainer_uninit(pGainer: [*c]ma_gainer, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_gainer_process_pcm_frames(pGainer: [*c]ma_gainer, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_gainer_set_gain(pGainer: [*c]ma_gainer, newGain: f32) ma_result;
pub extern fn ma_gainer_set_gains(pGainer: [*c]ma_gainer, pNewGains: [*c]f32) ma_result;
pub extern fn ma_gainer_set_master_volume(pGainer: [*c]ma_gainer, volume: f32) ma_result;
pub extern fn ma_gainer_get_master_volume(pGainer: [*c]const ma_gainer, pVolume: [*c]f32) ma_result;
pub const ma_pan_mode_balance: c_int = 0;
pub const ma_pan_mode_pan: c_int = 1;
pub const ma_pan_mode = c_uint;
pub const ma_panner_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    mode: ma_pan_mode = @import("std").mem.zeroes(ma_pan_mode),
    pan: f32 = 0,
    pub const ma_panner_init = __root.ma_panner_init;
    pub const init = __root.ma_panner_init;
};
pub extern fn ma_panner_config_init(format: ma_format, channels: ma_uint32) ma_panner_config;
pub const ma_panner = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    mode: ma_pan_mode = @import("std").mem.zeroes(ma_pan_mode),
    pan: f32 = 0,
    pub const ma_panner_process_pcm_frames = __root.ma_panner_process_pcm_frames;
    pub const ma_panner_set_mode = __root.ma_panner_set_mode;
    pub const ma_panner_get_mode = __root.ma_panner_get_mode;
    pub const ma_panner_set_pan = __root.ma_panner_set_pan;
    pub const ma_panner_get_pan = __root.ma_panner_get_pan;
    pub const process_pcm_frames = __root.ma_panner_process_pcm_frames;
    pub const set_mode = __root.ma_panner_set_mode;
    pub const get_mode = __root.ma_panner_get_mode;
    pub const set_pan = __root.ma_panner_set_pan;
    pub const get_pan = __root.ma_panner_get_pan;
};
pub extern fn ma_panner_init(pConfig: [*c]const ma_panner_config, pPanner: [*c]ma_panner) ma_result;
pub extern fn ma_panner_process_pcm_frames(pPanner: [*c]ma_panner, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_panner_set_mode(pPanner: [*c]ma_panner, mode: ma_pan_mode) void;
pub extern fn ma_panner_get_mode(pPanner: [*c]const ma_panner) ma_pan_mode;
pub extern fn ma_panner_set_pan(pPanner: [*c]ma_panner, pan: f32) void;
pub extern fn ma_panner_get_pan(pPanner: [*c]const ma_panner) f32;
pub const ma_fader_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    pub const ma_fader_init = __root.ma_fader_init;
    pub const init = __root.ma_fader_init;
};
pub extern fn ma_fader_config_init(format: ma_format, channels: ma_uint32, sampleRate: ma_uint32) ma_fader_config;
pub const ma_fader = extern struct {
    config: ma_fader_config = @import("std").mem.zeroes(ma_fader_config),
    volumeBeg: f32 = 0,
    volumeEnd: f32 = 0,
    lengthInFrames: ma_uint64 = 0,
    cursorInFrames: ma_int64 = 0,
    pub const ma_fader_process_pcm_frames = __root.ma_fader_process_pcm_frames;
    pub const ma_fader_get_data_format = __root.ma_fader_get_data_format;
    pub const ma_fader_set_fade = __root.ma_fader_set_fade;
    pub const ma_fader_set_fade_ex = __root.ma_fader_set_fade_ex;
    pub const ma_fader_get_current_volume = __root.ma_fader_get_current_volume;
    pub const process_pcm_frames = __root.ma_fader_process_pcm_frames;
    pub const get_data_format = __root.ma_fader_get_data_format;
    pub const set_fade = __root.ma_fader_set_fade;
    pub const set_fade_ex = __root.ma_fader_set_fade_ex;
    pub const get_current_volume = __root.ma_fader_get_current_volume;
};
pub extern fn ma_fader_init(pConfig: [*c]const ma_fader_config, pFader: [*c]ma_fader) ma_result;
pub extern fn ma_fader_process_pcm_frames(pFader: [*c]ma_fader, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_fader_get_data_format(pFader: [*c]const ma_fader, pFormat: [*c]ma_format, pChannels: [*c]ma_uint32, pSampleRate: [*c]ma_uint32) void;
pub extern fn ma_fader_set_fade(pFader: [*c]ma_fader, volumeBeg: f32, volumeEnd: f32, lengthInFrames: ma_uint64) void;
pub extern fn ma_fader_set_fade_ex(pFader: [*c]ma_fader, volumeBeg: f32, volumeEnd: f32, lengthInFrames: ma_uint64, startOffsetInFrames: ma_int64) void;
pub extern fn ma_fader_get_current_volume(pFader: [*c]const ma_fader) f32;
pub const ma_vec3f = extern struct {
    x: f32 = 0,
    y: f32 = 0,
    z: f32 = 0,
};
pub const ma_atomic_vec3f = extern struct {
    v: ma_vec3f = @import("std").mem.zeroes(ma_vec3f),
    lock: ma_spinlock = 0,
};
pub const ma_attenuation_model_none: c_int = 0;
pub const ma_attenuation_model_inverse: c_int = 1;
pub const ma_attenuation_model_linear: c_int = 2;
pub const ma_attenuation_model_exponential: c_int = 3;
pub const ma_attenuation_model = c_uint;
pub const ma_positioning_absolute: c_int = 0;
pub const ma_positioning_relative: c_int = 1;
pub const ma_positioning = c_uint;
pub const ma_handedness_right: c_int = 0;
pub const ma_handedness_left: c_int = 1;
pub const ma_handedness = c_uint;
pub const ma_spatializer_listener_config = extern struct {
    channelsOut: ma_uint32 = 0,
    pChannelMapOut: [*c]ma_channel = null,
    handedness: ma_handedness = @import("std").mem.zeroes(ma_handedness),
    coneInnerAngleInRadians: f32 = 0,
    coneOuterAngleInRadians: f32 = 0,
    coneOuterGain: f32 = 0,
    speedOfSound: f32 = 0,
    worldUp: ma_vec3f = @import("std").mem.zeroes(ma_vec3f),
    pub const ma_spatializer_listener_get_heap_size = __root.ma_spatializer_listener_get_heap_size;
    pub const ma_spatializer_listener_init_preallocated = __root.ma_spatializer_listener_init_preallocated;
    pub const ma_spatializer_listener_init = __root.ma_spatializer_listener_init;
    pub const size = __root.ma_spatializer_listener_get_heap_size;
    pub const preallocated = __root.ma_spatializer_listener_init_preallocated;
    pub const init = __root.ma_spatializer_listener_init;
};
pub extern fn ma_spatializer_listener_config_init(channelsOut: ma_uint32) ma_spatializer_listener_config;
pub const ma_spatializer_listener = extern struct {
    config: ma_spatializer_listener_config = @import("std").mem.zeroes(ma_spatializer_listener_config),
    position: ma_atomic_vec3f = @import("std").mem.zeroes(ma_atomic_vec3f),
    direction: ma_atomic_vec3f = @import("std").mem.zeroes(ma_atomic_vec3f),
    velocity: ma_atomic_vec3f = @import("std").mem.zeroes(ma_atomic_vec3f),
    isEnabled: ma_bool32 = 0,
    _ownsHeap: ma_bool32 = 0,
    _pHeap: ?*anyopaque = null,
    pub const ma_spatializer_listener_uninit = __root.ma_spatializer_listener_uninit;
    pub const ma_spatializer_listener_get_channel_map = __root.ma_spatializer_listener_get_channel_map;
    pub const ma_spatializer_listener_set_cone = __root.ma_spatializer_listener_set_cone;
    pub const ma_spatializer_listener_get_cone = __root.ma_spatializer_listener_get_cone;
    pub const ma_spatializer_listener_set_position = __root.ma_spatializer_listener_set_position;
    pub const ma_spatializer_listener_get_position = __root.ma_spatializer_listener_get_position;
    pub const ma_spatializer_listener_set_direction = __root.ma_spatializer_listener_set_direction;
    pub const ma_spatializer_listener_get_direction = __root.ma_spatializer_listener_get_direction;
    pub const ma_spatializer_listener_set_velocity = __root.ma_spatializer_listener_set_velocity;
    pub const ma_spatializer_listener_get_velocity = __root.ma_spatializer_listener_get_velocity;
    pub const ma_spatializer_listener_set_speed_of_sound = __root.ma_spatializer_listener_set_speed_of_sound;
    pub const ma_spatializer_listener_get_speed_of_sound = __root.ma_spatializer_listener_get_speed_of_sound;
    pub const ma_spatializer_listener_set_world_up = __root.ma_spatializer_listener_set_world_up;
    pub const ma_spatializer_listener_get_world_up = __root.ma_spatializer_listener_get_world_up;
    pub const ma_spatializer_listener_set_enabled = __root.ma_spatializer_listener_set_enabled;
    pub const ma_spatializer_listener_is_enabled = __root.ma_spatializer_listener_is_enabled;
    pub const uninit = __root.ma_spatializer_listener_uninit;
    pub const get_channel_map = __root.ma_spatializer_listener_get_channel_map;
    pub const set_cone = __root.ma_spatializer_listener_set_cone;
    pub const get_cone = __root.ma_spatializer_listener_get_cone;
    pub const set_position = __root.ma_spatializer_listener_set_position;
    pub const get_position = __root.ma_spatializer_listener_get_position;
    pub const set_direction = __root.ma_spatializer_listener_set_direction;
    pub const get_direction = __root.ma_spatializer_listener_get_direction;
    pub const set_velocity = __root.ma_spatializer_listener_set_velocity;
    pub const get_velocity = __root.ma_spatializer_listener_get_velocity;
    pub const set_speed_of_sound = __root.ma_spatializer_listener_set_speed_of_sound;
    pub const get_speed_of_sound = __root.ma_spatializer_listener_get_speed_of_sound;
    pub const set_world_up = __root.ma_spatializer_listener_set_world_up;
    pub const get_world_up = __root.ma_spatializer_listener_get_world_up;
    pub const set_enabled = __root.ma_spatializer_listener_set_enabled;
    pub const is_enabled = __root.ma_spatializer_listener_is_enabled;
};
pub extern fn ma_spatializer_listener_get_heap_size(pConfig: [*c]const ma_spatializer_listener_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_spatializer_listener_init_preallocated(pConfig: [*c]const ma_spatializer_listener_config, pHeap: ?*anyopaque, pListener: [*c]ma_spatializer_listener) ma_result;
pub extern fn ma_spatializer_listener_init(pConfig: [*c]const ma_spatializer_listener_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pListener: [*c]ma_spatializer_listener) ma_result;
pub extern fn ma_spatializer_listener_uninit(pListener: [*c]ma_spatializer_listener, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_spatializer_listener_get_channel_map(pListener: [*c]ma_spatializer_listener) [*c]ma_channel;
pub extern fn ma_spatializer_listener_set_cone(pListener: [*c]ma_spatializer_listener, innerAngleInRadians: f32, outerAngleInRadians: f32, outerGain: f32) void;
pub extern fn ma_spatializer_listener_get_cone(pListener: [*c]const ma_spatializer_listener, pInnerAngleInRadians: [*c]f32, pOuterAngleInRadians: [*c]f32, pOuterGain: [*c]f32) void;
pub extern fn ma_spatializer_listener_set_position(pListener: [*c]ma_spatializer_listener, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_listener_get_position(pListener: [*c]const ma_spatializer_listener) ma_vec3f;
pub extern fn ma_spatializer_listener_set_direction(pListener: [*c]ma_spatializer_listener, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_listener_get_direction(pListener: [*c]const ma_spatializer_listener) ma_vec3f;
pub extern fn ma_spatializer_listener_set_velocity(pListener: [*c]ma_spatializer_listener, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_listener_get_velocity(pListener: [*c]const ma_spatializer_listener) ma_vec3f;
pub extern fn ma_spatializer_listener_set_speed_of_sound(pListener: [*c]ma_spatializer_listener, speedOfSound: f32) void;
pub extern fn ma_spatializer_listener_get_speed_of_sound(pListener: [*c]const ma_spatializer_listener) f32;
pub extern fn ma_spatializer_listener_set_world_up(pListener: [*c]ma_spatializer_listener, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_listener_get_world_up(pListener: [*c]const ma_spatializer_listener) ma_vec3f;
pub extern fn ma_spatializer_listener_set_enabled(pListener: [*c]ma_spatializer_listener, isEnabled: ma_bool32) void;
pub extern fn ma_spatializer_listener_is_enabled(pListener: [*c]const ma_spatializer_listener) ma_bool32;
pub const ma_spatializer_config = extern struct {
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    pChannelMapIn: [*c]ma_channel = null,
    attenuationModel: ma_attenuation_model = @import("std").mem.zeroes(ma_attenuation_model),
    positioning: ma_positioning = @import("std").mem.zeroes(ma_positioning),
    handedness: ma_handedness = @import("std").mem.zeroes(ma_handedness),
    minGain: f32 = 0,
    maxGain: f32 = 0,
    minDistance: f32 = 0,
    maxDistance: f32 = 0,
    rolloff: f32 = 0,
    coneInnerAngleInRadians: f32 = 0,
    coneOuterAngleInRadians: f32 = 0,
    coneOuterGain: f32 = 0,
    dopplerFactor: f32 = 0,
    directionalAttenuationFactor: f32 = 0,
    minSpatializationChannelGain: f32 = 0,
    gainSmoothTimeInFrames: ma_uint32 = 0,
    pub const ma_spatializer_get_heap_size = __root.ma_spatializer_get_heap_size;
    pub const ma_spatializer_init_preallocated = __root.ma_spatializer_init_preallocated;
    pub const ma_spatializer_init = __root.ma_spatializer_init;
    pub const size = __root.ma_spatializer_get_heap_size;
    pub const preallocated = __root.ma_spatializer_init_preallocated;
    pub const init = __root.ma_spatializer_init;
};
pub extern fn ma_spatializer_config_init(channelsIn: ma_uint32, channelsOut: ma_uint32) ma_spatializer_config;
pub const ma_spatializer = extern struct {
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    pChannelMapIn: [*c]ma_channel = null,
    attenuationModel: ma_attenuation_model = @import("std").mem.zeroes(ma_attenuation_model),
    positioning: ma_positioning = @import("std").mem.zeroes(ma_positioning),
    handedness: ma_handedness = @import("std").mem.zeroes(ma_handedness),
    minGain: f32 = 0,
    maxGain: f32 = 0,
    minDistance: f32 = 0,
    maxDistance: f32 = 0,
    rolloff: f32 = 0,
    coneInnerAngleInRadians: f32 = 0,
    coneOuterAngleInRadians: f32 = 0,
    coneOuterGain: f32 = 0,
    dopplerFactor: f32 = 0,
    directionalAttenuationFactor: f32 = 0,
    gainSmoothTimeInFrames: ma_uint32 = 0,
    position: ma_atomic_vec3f = @import("std").mem.zeroes(ma_atomic_vec3f),
    direction: ma_atomic_vec3f = @import("std").mem.zeroes(ma_atomic_vec3f),
    velocity: ma_atomic_vec3f = @import("std").mem.zeroes(ma_atomic_vec3f),
    dopplerPitch: f32 = 0,
    minSpatializationChannelGain: f32 = 0,
    gainer: ma_gainer = @import("std").mem.zeroes(ma_gainer),
    pNewChannelGainsOut: [*c]f32 = null,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_spatializer_uninit = __root.ma_spatializer_uninit;
    pub const ma_spatializer_process_pcm_frames = __root.ma_spatializer_process_pcm_frames;
    pub const ma_spatializer_set_master_volume = __root.ma_spatializer_set_master_volume;
    pub const ma_spatializer_get_master_volume = __root.ma_spatializer_get_master_volume;
    pub const ma_spatializer_get_input_channels = __root.ma_spatializer_get_input_channels;
    pub const ma_spatializer_get_output_channels = __root.ma_spatializer_get_output_channels;
    pub const ma_spatializer_set_attenuation_model = __root.ma_spatializer_set_attenuation_model;
    pub const ma_spatializer_get_attenuation_model = __root.ma_spatializer_get_attenuation_model;
    pub const ma_spatializer_set_positioning = __root.ma_spatializer_set_positioning;
    pub const ma_spatializer_get_positioning = __root.ma_spatializer_get_positioning;
    pub const ma_spatializer_set_rolloff = __root.ma_spatializer_set_rolloff;
    pub const ma_spatializer_get_rolloff = __root.ma_spatializer_get_rolloff;
    pub const ma_spatializer_set_min_gain = __root.ma_spatializer_set_min_gain;
    pub const ma_spatializer_get_min_gain = __root.ma_spatializer_get_min_gain;
    pub const ma_spatializer_set_max_gain = __root.ma_spatializer_set_max_gain;
    pub const ma_spatializer_get_max_gain = __root.ma_spatializer_get_max_gain;
    pub const ma_spatializer_set_min_distance = __root.ma_spatializer_set_min_distance;
    pub const ma_spatializer_get_min_distance = __root.ma_spatializer_get_min_distance;
    pub const ma_spatializer_set_max_distance = __root.ma_spatializer_set_max_distance;
    pub const ma_spatializer_get_max_distance = __root.ma_spatializer_get_max_distance;
    pub const ma_spatializer_set_cone = __root.ma_spatializer_set_cone;
    pub const ma_spatializer_get_cone = __root.ma_spatializer_get_cone;
    pub const ma_spatializer_set_doppler_factor = __root.ma_spatializer_set_doppler_factor;
    pub const ma_spatializer_get_doppler_factor = __root.ma_spatializer_get_doppler_factor;
    pub const ma_spatializer_set_directional_attenuation_factor = __root.ma_spatializer_set_directional_attenuation_factor;
    pub const ma_spatializer_get_directional_attenuation_factor = __root.ma_spatializer_get_directional_attenuation_factor;
    pub const ma_spatializer_set_position = __root.ma_spatializer_set_position;
    pub const ma_spatializer_get_position = __root.ma_spatializer_get_position;
    pub const ma_spatializer_set_direction = __root.ma_spatializer_set_direction;
    pub const ma_spatializer_get_direction = __root.ma_spatializer_get_direction;
    pub const ma_spatializer_set_velocity = __root.ma_spatializer_set_velocity;
    pub const ma_spatializer_get_velocity = __root.ma_spatializer_get_velocity;
    pub const ma_spatializer_get_relative_position_and_direction = __root.ma_spatializer_get_relative_position_and_direction;
    pub const uninit = __root.ma_spatializer_uninit;
    pub const process_pcm_frames = __root.ma_spatializer_process_pcm_frames;
    pub const set_master_volume = __root.ma_spatializer_set_master_volume;
    pub const get_master_volume = __root.ma_spatializer_get_master_volume;
    pub const get_input_channels = __root.ma_spatializer_get_input_channels;
    pub const get_output_channels = __root.ma_spatializer_get_output_channels;
    pub const set_attenuation_model = __root.ma_spatializer_set_attenuation_model;
    pub const get_attenuation_model = __root.ma_spatializer_get_attenuation_model;
    pub const set_positioning = __root.ma_spatializer_set_positioning;
    pub const get_positioning = __root.ma_spatializer_get_positioning;
    pub const set_rolloff = __root.ma_spatializer_set_rolloff;
    pub const get_rolloff = __root.ma_spatializer_get_rolloff;
    pub const set_min_gain = __root.ma_spatializer_set_min_gain;
    pub const get_min_gain = __root.ma_spatializer_get_min_gain;
    pub const set_max_gain = __root.ma_spatializer_set_max_gain;
    pub const get_max_gain = __root.ma_spatializer_get_max_gain;
    pub const set_min_distance = __root.ma_spatializer_set_min_distance;
    pub const get_min_distance = __root.ma_spatializer_get_min_distance;
    pub const set_max_distance = __root.ma_spatializer_set_max_distance;
    pub const get_max_distance = __root.ma_spatializer_get_max_distance;
    pub const set_cone = __root.ma_spatializer_set_cone;
    pub const get_cone = __root.ma_spatializer_get_cone;
    pub const set_doppler_factor = __root.ma_spatializer_set_doppler_factor;
    pub const get_doppler_factor = __root.ma_spatializer_get_doppler_factor;
    pub const set_directional_attenuation_factor = __root.ma_spatializer_set_directional_attenuation_factor;
    pub const get_directional_attenuation_factor = __root.ma_spatializer_get_directional_attenuation_factor;
    pub const set_position = __root.ma_spatializer_set_position;
    pub const get_position = __root.ma_spatializer_get_position;
    pub const set_direction = __root.ma_spatializer_set_direction;
    pub const get_direction = __root.ma_spatializer_get_direction;
    pub const set_velocity = __root.ma_spatializer_set_velocity;
    pub const get_velocity = __root.ma_spatializer_get_velocity;
    pub const get_relative_position_and_direction = __root.ma_spatializer_get_relative_position_and_direction;
};
pub extern fn ma_spatializer_get_heap_size(pConfig: [*c]const ma_spatializer_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_spatializer_init_preallocated(pConfig: [*c]const ma_spatializer_config, pHeap: ?*anyopaque, pSpatializer: [*c]ma_spatializer) ma_result;
pub extern fn ma_spatializer_init(pConfig: [*c]const ma_spatializer_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pSpatializer: [*c]ma_spatializer) ma_result;
pub extern fn ma_spatializer_uninit(pSpatializer: [*c]ma_spatializer, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_spatializer_process_pcm_frames(pSpatializer: [*c]ma_spatializer, pListener: [*c]ma_spatializer_listener, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_spatializer_set_master_volume(pSpatializer: [*c]ma_spatializer, volume: f32) ma_result;
pub extern fn ma_spatializer_get_master_volume(pSpatializer: [*c]const ma_spatializer, pVolume: [*c]f32) ma_result;
pub extern fn ma_spatializer_get_input_channels(pSpatializer: [*c]const ma_spatializer) ma_uint32;
pub extern fn ma_spatializer_get_output_channels(pSpatializer: [*c]const ma_spatializer) ma_uint32;
pub extern fn ma_spatializer_set_attenuation_model(pSpatializer: [*c]ma_spatializer, attenuationModel: ma_attenuation_model) void;
pub extern fn ma_spatializer_get_attenuation_model(pSpatializer: [*c]const ma_spatializer) ma_attenuation_model;
pub extern fn ma_spatializer_set_positioning(pSpatializer: [*c]ma_spatializer, positioning: ma_positioning) void;
pub extern fn ma_spatializer_get_positioning(pSpatializer: [*c]const ma_spatializer) ma_positioning;
pub extern fn ma_spatializer_set_rolloff(pSpatializer: [*c]ma_spatializer, rolloff: f32) void;
pub extern fn ma_spatializer_get_rolloff(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_min_gain(pSpatializer: [*c]ma_spatializer, minGain: f32) void;
pub extern fn ma_spatializer_get_min_gain(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_max_gain(pSpatializer: [*c]ma_spatializer, maxGain: f32) void;
pub extern fn ma_spatializer_get_max_gain(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_min_distance(pSpatializer: [*c]ma_spatializer, minDistance: f32) void;
pub extern fn ma_spatializer_get_min_distance(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_max_distance(pSpatializer: [*c]ma_spatializer, maxDistance: f32) void;
pub extern fn ma_spatializer_get_max_distance(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_cone(pSpatializer: [*c]ma_spatializer, innerAngleInRadians: f32, outerAngleInRadians: f32, outerGain: f32) void;
pub extern fn ma_spatializer_get_cone(pSpatializer: [*c]const ma_spatializer, pInnerAngleInRadians: [*c]f32, pOuterAngleInRadians: [*c]f32, pOuterGain: [*c]f32) void;
pub extern fn ma_spatializer_set_doppler_factor(pSpatializer: [*c]ma_spatializer, dopplerFactor: f32) void;
pub extern fn ma_spatializer_get_doppler_factor(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_directional_attenuation_factor(pSpatializer: [*c]ma_spatializer, directionalAttenuationFactor: f32) void;
pub extern fn ma_spatializer_get_directional_attenuation_factor(pSpatializer: [*c]const ma_spatializer) f32;
pub extern fn ma_spatializer_set_position(pSpatializer: [*c]ma_spatializer, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_get_position(pSpatializer: [*c]const ma_spatializer) ma_vec3f;
pub extern fn ma_spatializer_set_direction(pSpatializer: [*c]ma_spatializer, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_get_direction(pSpatializer: [*c]const ma_spatializer) ma_vec3f;
pub extern fn ma_spatializer_set_velocity(pSpatializer: [*c]ma_spatializer, x: f32, y: f32, z: f32) void;
pub extern fn ma_spatializer_get_velocity(pSpatializer: [*c]const ma_spatializer) ma_vec3f;
pub extern fn ma_spatializer_get_relative_position_and_direction(pSpatializer: [*c]const ma_spatializer, pListener: [*c]const ma_spatializer_listener, pRelativePos: [*c]ma_vec3f, pRelativeDir: [*c]ma_vec3f) void;
pub const ma_linear_resampler_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRateIn: ma_uint32 = 0,
    sampleRateOut: ma_uint32 = 0,
    lpfOrder: ma_uint32 = 0,
    lpfNyquistFactor: f64 = 0,
    pub const ma_linear_resampler_get_heap_size = __root.ma_linear_resampler_get_heap_size;
    pub const ma_linear_resampler_init_preallocated = __root.ma_linear_resampler_init_preallocated;
    pub const ma_linear_resampler_init = __root.ma_linear_resampler_init;
    pub const size = __root.ma_linear_resampler_get_heap_size;
    pub const preallocated = __root.ma_linear_resampler_init_preallocated;
    pub const init = __root.ma_linear_resampler_init;
};
pub extern fn ma_linear_resampler_config_init(format: ma_format, channels: ma_uint32, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32) ma_linear_resampler_config;
const union_unnamed_33 = extern union {
    f32: [*c]f32,
    s16: [*c]ma_int16,
};
const union_unnamed_34 = extern union {
    f32: [*c]f32,
    s16: [*c]ma_int16,
};
pub const ma_linear_resampler = extern struct {
    config: ma_linear_resampler_config = @import("std").mem.zeroes(ma_linear_resampler_config),
    inAdvanceInt: ma_uint32 = 0,
    inAdvanceFrac: ma_uint32 = 0,
    inTimeInt: ma_uint32 = 0,
    inTimeFrac: ma_uint32 = 0,
    x0: union_unnamed_33 = @import("std").mem.zeroes(union_unnamed_33),
    x1: union_unnamed_34 = @import("std").mem.zeroes(union_unnamed_34),
    lpf: ma_lpf = @import("std").mem.zeroes(ma_lpf),
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_linear_resampler_uninit = __root.ma_linear_resampler_uninit;
    pub const ma_linear_resampler_process_pcm_frames = __root.ma_linear_resampler_process_pcm_frames;
    pub const ma_linear_resampler_set_rate = __root.ma_linear_resampler_set_rate;
    pub const ma_linear_resampler_set_rate_ratio = __root.ma_linear_resampler_set_rate_ratio;
    pub const ma_linear_resampler_get_input_latency = __root.ma_linear_resampler_get_input_latency;
    pub const ma_linear_resampler_get_output_latency = __root.ma_linear_resampler_get_output_latency;
    pub const ma_linear_resampler_get_required_input_frame_count = __root.ma_linear_resampler_get_required_input_frame_count;
    pub const ma_linear_resampler_get_expected_output_frame_count = __root.ma_linear_resampler_get_expected_output_frame_count;
    pub const ma_linear_resampler_reset = __root.ma_linear_resampler_reset;
    pub const uninit = __root.ma_linear_resampler_uninit;
    pub const process_pcm_frames = __root.ma_linear_resampler_process_pcm_frames;
    pub const set_rate = __root.ma_linear_resampler_set_rate;
    pub const set_rate_ratio = __root.ma_linear_resampler_set_rate_ratio;
    pub const get_input_latency = __root.ma_linear_resampler_get_input_latency;
    pub const get_output_latency = __root.ma_linear_resampler_get_output_latency;
    pub const get_required_input_frame_count = __root.ma_linear_resampler_get_required_input_frame_count;
    pub const get_expected_output_frame_count = __root.ma_linear_resampler_get_expected_output_frame_count;
    pub const reset = __root.ma_linear_resampler_reset;
};
pub extern fn ma_linear_resampler_get_heap_size(pConfig: [*c]const ma_linear_resampler_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_linear_resampler_init_preallocated(pConfig: [*c]const ma_linear_resampler_config, pHeap: ?*anyopaque, pResampler: [*c]ma_linear_resampler) ma_result;
pub extern fn ma_linear_resampler_init(pConfig: [*c]const ma_linear_resampler_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pResampler: [*c]ma_linear_resampler) ma_result;
pub extern fn ma_linear_resampler_uninit(pResampler: [*c]ma_linear_resampler, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_linear_resampler_process_pcm_frames(pResampler: [*c]ma_linear_resampler, pFramesIn: ?*const anyopaque, pFrameCountIn: [*c]ma_uint64, pFramesOut: ?*anyopaque, pFrameCountOut: [*c]ma_uint64) ma_result;
pub extern fn ma_linear_resampler_set_rate(pResampler: [*c]ma_linear_resampler, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32) ma_result;
pub extern fn ma_linear_resampler_set_rate_ratio(pResampler: [*c]ma_linear_resampler, ratioInOut: f32) ma_result;
pub extern fn ma_linear_resampler_get_input_latency(pResampler: [*c]const ma_linear_resampler) ma_uint64;
pub extern fn ma_linear_resampler_get_output_latency(pResampler: [*c]const ma_linear_resampler) ma_uint64;
pub extern fn ma_linear_resampler_get_required_input_frame_count(pResampler: [*c]const ma_linear_resampler, outputFrameCount: ma_uint64, pInputFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_linear_resampler_get_expected_output_frame_count(pResampler: [*c]const ma_linear_resampler, inputFrameCount: ma_uint64, pOutputFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_linear_resampler_reset(pResampler: [*c]ma_linear_resampler) ma_result;
pub const ma_resampling_backend = anyopaque;
pub const ma_resampling_backend_vtable = extern struct {
    onGetHeapSize: ?*const fn (pUserData: ?*anyopaque, pConfig: [*c]const ma_resampler_config, pHeapSizeInBytes: [*c]usize) callconv(.c) ma_result = null,
    onInit: ?*const fn (pUserData: ?*anyopaque, pConfig: [*c]const ma_resampler_config, pHeap: ?*anyopaque, ppBackend: [*c]?*ma_resampling_backend) callconv(.c) ma_result = null,
    onUninit: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*ma_resampling_backend, pAllocationCallbacks: [*c]const ma_allocation_callbacks) callconv(.c) void = null,
    onProcess: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*ma_resampling_backend, pFramesIn: ?*const anyopaque, pFrameCountIn: [*c]ma_uint64, pFramesOut: ?*anyopaque, pFrameCountOut: [*c]ma_uint64) callconv(.c) ma_result = null,
    onSetRate: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*ma_resampling_backend, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32) callconv(.c) ma_result = null,
    onGetInputLatency: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*const ma_resampling_backend) callconv(.c) ma_uint64 = null,
    onGetOutputLatency: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*const ma_resampling_backend) callconv(.c) ma_uint64 = null,
    onGetRequiredInputFrameCount: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*const ma_resampling_backend, outputFrameCount: ma_uint64, pInputFrameCount: [*c]ma_uint64) callconv(.c) ma_result = null,
    onGetExpectedOutputFrameCount: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*const ma_resampling_backend, inputFrameCount: ma_uint64, pOutputFrameCount: [*c]ma_uint64) callconv(.c) ma_result = null,
    onReset: ?*const fn (pUserData: ?*anyopaque, pBackend: ?*ma_resampling_backend) callconv(.c) ma_result = null,
};
pub const ma_resample_algorithm_linear: c_int = 0;
pub const ma_resample_algorithm_custom: c_int = 1;
pub const ma_resample_algorithm = c_uint;
pub extern fn ma_resampler_config_init(format: ma_format, channels: ma_uint32, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32, algorithm: ma_resample_algorithm) ma_resampler_config;
const union_unnamed_35 = extern union {
    linear: ma_linear_resampler,
};
pub const ma_resampler = extern struct {
    pBackend: ?*ma_resampling_backend = null,
    pBackendVTable: [*c]ma_resampling_backend_vtable = null,
    pBackendUserData: ?*anyopaque = null,
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRateIn: ma_uint32 = 0,
    sampleRateOut: ma_uint32 = 0,
    state: union_unnamed_35 = @import("std").mem.zeroes(union_unnamed_35),
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_resampler_uninit = __root.ma_resampler_uninit;
    pub const ma_resampler_process_pcm_frames = __root.ma_resampler_process_pcm_frames;
    pub const ma_resampler_set_rate = __root.ma_resampler_set_rate;
    pub const ma_resampler_set_rate_ratio = __root.ma_resampler_set_rate_ratio;
    pub const ma_resampler_get_input_latency = __root.ma_resampler_get_input_latency;
    pub const ma_resampler_get_output_latency = __root.ma_resampler_get_output_latency;
    pub const ma_resampler_get_required_input_frame_count = __root.ma_resampler_get_required_input_frame_count;
    pub const ma_resampler_get_expected_output_frame_count = __root.ma_resampler_get_expected_output_frame_count;
    pub const ma_resampler_reset = __root.ma_resampler_reset;
    pub const uninit = __root.ma_resampler_uninit;
    pub const process_pcm_frames = __root.ma_resampler_process_pcm_frames;
    pub const set_rate = __root.ma_resampler_set_rate;
    pub const set_rate_ratio = __root.ma_resampler_set_rate_ratio;
    pub const get_input_latency = __root.ma_resampler_get_input_latency;
    pub const get_output_latency = __root.ma_resampler_get_output_latency;
    pub const get_required_input_frame_count = __root.ma_resampler_get_required_input_frame_count;
    pub const get_expected_output_frame_count = __root.ma_resampler_get_expected_output_frame_count;
    pub const reset = __root.ma_resampler_reset;
};
pub extern fn ma_resampler_get_heap_size(pConfig: [*c]const ma_resampler_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_resampler_init_preallocated(pConfig: [*c]const ma_resampler_config, pHeap: ?*anyopaque, pResampler: [*c]ma_resampler) ma_result;
pub extern fn ma_resampler_init(pConfig: [*c]const ma_resampler_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pResampler: [*c]ma_resampler) ma_result;
pub extern fn ma_resampler_uninit(pResampler: [*c]ma_resampler, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_resampler_process_pcm_frames(pResampler: [*c]ma_resampler, pFramesIn: ?*const anyopaque, pFrameCountIn: [*c]ma_uint64, pFramesOut: ?*anyopaque, pFrameCountOut: [*c]ma_uint64) ma_result;
pub extern fn ma_resampler_set_rate(pResampler: [*c]ma_resampler, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32) ma_result;
pub extern fn ma_resampler_set_rate_ratio(pResampler: [*c]ma_resampler, ratio: f32) ma_result;
pub extern fn ma_resampler_get_input_latency(pResampler: [*c]const ma_resampler) ma_uint64;
pub extern fn ma_resampler_get_output_latency(pResampler: [*c]const ma_resampler) ma_uint64;
pub extern fn ma_resampler_get_required_input_frame_count(pResampler: [*c]const ma_resampler, outputFrameCount: ma_uint64, pInputFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_resampler_get_expected_output_frame_count(pResampler: [*c]const ma_resampler, inputFrameCount: ma_uint64, pOutputFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_resampler_reset(pResampler: [*c]ma_resampler) ma_result;
pub const ma_channel_conversion_path_unknown: c_int = 0;
pub const ma_channel_conversion_path_passthrough: c_int = 1;
pub const ma_channel_conversion_path_mono_out: c_int = 2;
pub const ma_channel_conversion_path_mono_in: c_int = 3;
pub const ma_channel_conversion_path_shuffle: c_int = 4;
pub const ma_channel_conversion_path_weights: c_int = 5;
pub const ma_channel_conversion_path = c_uint;
pub const ma_mono_expansion_mode_duplicate: c_int = 0;
pub const ma_mono_expansion_mode_average: c_int = 1;
pub const ma_mono_expansion_mode_stereo_only: c_int = 2;
pub const ma_mono_expansion_mode_default: c_int = 0;
pub const ma_mono_expansion_mode = c_uint;
pub const ma_channel_converter_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    pChannelMapIn: [*c]const ma_channel = null,
    pChannelMapOut: [*c]const ma_channel = null,
    mixingMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    calculateLFEFromSpatialChannels: ma_bool32 = 0,
    ppWeights: [*c][*c]f32 = null,
    pub const ma_channel_converter_get_heap_size = __root.ma_channel_converter_get_heap_size;
    pub const ma_channel_converter_init_preallocated = __root.ma_channel_converter_init_preallocated;
    pub const ma_channel_converter_init = __root.ma_channel_converter_init;
    pub const size = __root.ma_channel_converter_get_heap_size;
    pub const preallocated = __root.ma_channel_converter_init_preallocated;
    pub const init = __root.ma_channel_converter_init;
};
pub extern fn ma_channel_converter_config_init(format: ma_format, channelsIn: ma_uint32, pChannelMapIn: [*c]const ma_channel, channelsOut: ma_uint32, pChannelMapOut: [*c]const ma_channel, mixingMode: ma_channel_mix_mode) ma_channel_converter_config;
const union_unnamed_36 = extern union {
    f32: [*c][*c]f32,
    s16: [*c][*c]ma_int32,
};
pub const ma_channel_converter = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    mixingMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    conversionPath: ma_channel_conversion_path = @import("std").mem.zeroes(ma_channel_conversion_path),
    pChannelMapIn: [*c]ma_channel = null,
    pChannelMapOut: [*c]ma_channel = null,
    pShuffleTable: [*c]ma_uint8 = null,
    weights: union_unnamed_36 = @import("std").mem.zeroes(union_unnamed_36),
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_channel_converter_uninit = __root.ma_channel_converter_uninit;
    pub const ma_channel_converter_process_pcm_frames = __root.ma_channel_converter_process_pcm_frames;
    pub const ma_channel_converter_get_input_channel_map = __root.ma_channel_converter_get_input_channel_map;
    pub const ma_channel_converter_get_output_channel_map = __root.ma_channel_converter_get_output_channel_map;
    pub const uninit = __root.ma_channel_converter_uninit;
    pub const process_pcm_frames = __root.ma_channel_converter_process_pcm_frames;
    pub const get_input_channel_map = __root.ma_channel_converter_get_input_channel_map;
    pub const get_output_channel_map = __root.ma_channel_converter_get_output_channel_map;
};
pub extern fn ma_channel_converter_get_heap_size(pConfig: [*c]const ma_channel_converter_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_channel_converter_init_preallocated(pConfig: [*c]const ma_channel_converter_config, pHeap: ?*anyopaque, pConverter: [*c]ma_channel_converter) ma_result;
pub extern fn ma_channel_converter_init(pConfig: [*c]const ma_channel_converter_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pConverter: [*c]ma_channel_converter) ma_result;
pub extern fn ma_channel_converter_uninit(pConverter: [*c]ma_channel_converter, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_channel_converter_process_pcm_frames(pConverter: [*c]ma_channel_converter, pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64) ma_result;
pub extern fn ma_channel_converter_get_input_channel_map(pConverter: [*c]const ma_channel_converter, pChannelMap: [*c]ma_channel, channelMapCap: usize) ma_result;
pub extern fn ma_channel_converter_get_output_channel_map(pConverter: [*c]const ma_channel_converter, pChannelMap: [*c]ma_channel, channelMapCap: usize) ma_result;
pub const ma_data_converter_config = extern struct {
    formatIn: ma_format = @import("std").mem.zeroes(ma_format),
    formatOut: ma_format = @import("std").mem.zeroes(ma_format),
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    sampleRateIn: ma_uint32 = 0,
    sampleRateOut: ma_uint32 = 0,
    pChannelMapIn: [*c]ma_channel = null,
    pChannelMapOut: [*c]ma_channel = null,
    ditherMode: ma_dither_mode = @import("std").mem.zeroes(ma_dither_mode),
    channelMixMode: ma_channel_mix_mode = @import("std").mem.zeroes(ma_channel_mix_mode),
    calculateLFEFromSpatialChannels: ma_bool32 = 0,
    ppChannelWeights: [*c][*c]f32 = null,
    allowDynamicSampleRate: ma_bool32 = 0,
    resampling: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    pub const ma_data_converter_get_heap_size = __root.ma_data_converter_get_heap_size;
    pub const ma_data_converter_init_preallocated = __root.ma_data_converter_init_preallocated;
    pub const ma_data_converter_init = __root.ma_data_converter_init;
    pub const size = __root.ma_data_converter_get_heap_size;
    pub const preallocated = __root.ma_data_converter_init_preallocated;
    pub const init = __root.ma_data_converter_init;
};
pub extern fn ma_data_converter_config_init_default() ma_data_converter_config;
pub extern fn ma_data_converter_config_init(formatIn: ma_format, formatOut: ma_format, channelsIn: ma_uint32, channelsOut: ma_uint32, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32) ma_data_converter_config;
pub const ma_data_converter_execution_path_passthrough: c_int = 0;
pub const ma_data_converter_execution_path_format_only: c_int = 1;
pub const ma_data_converter_execution_path_channels_only: c_int = 2;
pub const ma_data_converter_execution_path_resample_only: c_int = 3;
pub const ma_data_converter_execution_path_resample_first: c_int = 4;
pub const ma_data_converter_execution_path_channels_first: c_int = 5;
pub const ma_data_converter_execution_path = c_uint;
pub const ma_data_converter = extern struct {
    formatIn: ma_format = @import("std").mem.zeroes(ma_format),
    formatOut: ma_format = @import("std").mem.zeroes(ma_format),
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    sampleRateIn: ma_uint32 = 0,
    sampleRateOut: ma_uint32 = 0,
    ditherMode: ma_dither_mode = @import("std").mem.zeroes(ma_dither_mode),
    executionPath: ma_data_converter_execution_path = @import("std").mem.zeroes(ma_data_converter_execution_path),
    channelConverter: ma_channel_converter = @import("std").mem.zeroes(ma_channel_converter),
    resampler: ma_resampler = @import("std").mem.zeroes(ma_resampler),
    hasPreFormatConversion: ma_bool8 = 0,
    hasPostFormatConversion: ma_bool8 = 0,
    hasChannelConverter: ma_bool8 = 0,
    hasResampler: ma_bool8 = 0,
    isPassthrough: ma_bool8 = 0,
    _ownsHeap: ma_bool8 = 0,
    _pHeap: ?*anyopaque = null,
    pub const ma_data_converter_uninit = __root.ma_data_converter_uninit;
    pub const ma_data_converter_process_pcm_frames = __root.ma_data_converter_process_pcm_frames;
    pub const ma_data_converter_set_rate = __root.ma_data_converter_set_rate;
    pub const ma_data_converter_set_rate_ratio = __root.ma_data_converter_set_rate_ratio;
    pub const ma_data_converter_get_input_latency = __root.ma_data_converter_get_input_latency;
    pub const ma_data_converter_get_output_latency = __root.ma_data_converter_get_output_latency;
    pub const ma_data_converter_get_required_input_frame_count = __root.ma_data_converter_get_required_input_frame_count;
    pub const ma_data_converter_get_expected_output_frame_count = __root.ma_data_converter_get_expected_output_frame_count;
    pub const ma_data_converter_get_input_channel_map = __root.ma_data_converter_get_input_channel_map;
    pub const ma_data_converter_get_output_channel_map = __root.ma_data_converter_get_output_channel_map;
    pub const ma_data_converter_reset = __root.ma_data_converter_reset;
    pub const uninit = __root.ma_data_converter_uninit;
    pub const process_pcm_frames = __root.ma_data_converter_process_pcm_frames;
    pub const set_rate = __root.ma_data_converter_set_rate;
    pub const set_rate_ratio = __root.ma_data_converter_set_rate_ratio;
    pub const get_input_latency = __root.ma_data_converter_get_input_latency;
    pub const get_output_latency = __root.ma_data_converter_get_output_latency;
    pub const get_required_input_frame_count = __root.ma_data_converter_get_required_input_frame_count;
    pub const get_expected_output_frame_count = __root.ma_data_converter_get_expected_output_frame_count;
    pub const get_input_channel_map = __root.ma_data_converter_get_input_channel_map;
    pub const get_output_channel_map = __root.ma_data_converter_get_output_channel_map;
    pub const reset = __root.ma_data_converter_reset;
};
pub extern fn ma_data_converter_get_heap_size(pConfig: [*c]const ma_data_converter_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_data_converter_init_preallocated(pConfig: [*c]const ma_data_converter_config, pHeap: ?*anyopaque, pConverter: [*c]ma_data_converter) ma_result;
pub extern fn ma_data_converter_init(pConfig: [*c]const ma_data_converter_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pConverter: [*c]ma_data_converter) ma_result;
pub extern fn ma_data_converter_uninit(pConverter: [*c]ma_data_converter, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_data_converter_process_pcm_frames(pConverter: [*c]ma_data_converter, pFramesIn: ?*const anyopaque, pFrameCountIn: [*c]ma_uint64, pFramesOut: ?*anyopaque, pFrameCountOut: [*c]ma_uint64) ma_result;
pub extern fn ma_data_converter_set_rate(pConverter: [*c]ma_data_converter, sampleRateIn: ma_uint32, sampleRateOut: ma_uint32) ma_result;
pub extern fn ma_data_converter_set_rate_ratio(pConverter: [*c]ma_data_converter, ratioInOut: f32) ma_result;
pub extern fn ma_data_converter_get_input_latency(pConverter: [*c]const ma_data_converter) ma_uint64;
pub extern fn ma_data_converter_get_output_latency(pConverter: [*c]const ma_data_converter) ma_uint64;
pub extern fn ma_data_converter_get_required_input_frame_count(pConverter: [*c]const ma_data_converter, outputFrameCount: ma_uint64, pInputFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_data_converter_get_expected_output_frame_count(pConverter: [*c]const ma_data_converter, inputFrameCount: ma_uint64, pOutputFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_data_converter_get_input_channel_map(pConverter: [*c]const ma_data_converter, pChannelMap: [*c]ma_channel, channelMapCap: usize) ma_result;
pub extern fn ma_data_converter_get_output_channel_map(pConverter: [*c]const ma_data_converter, pChannelMap: [*c]ma_channel, channelMapCap: usize) ma_result;
pub extern fn ma_data_converter_reset(pConverter: [*c]ma_data_converter) ma_result;
pub extern fn ma_pcm_u8_to_s16(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_u8_to_s24(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_u8_to_s32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_u8_to_f32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s16_to_u8(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s16_to_s24(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s16_to_s32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s16_to_f32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s24_to_u8(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s24_to_s16(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s24_to_s32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s24_to_f32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s32_to_u8(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s32_to_s16(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s32_to_s24(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_s32_to_f32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_f32_to_u8(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_f32_to_s16(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_f32_to_s24(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_f32_to_s32(pOut: ?*anyopaque, pIn: ?*const anyopaque, count: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_pcm_convert(pOut: ?*anyopaque, formatOut: ma_format, pIn: ?*const anyopaque, formatIn: ma_format, sampleCount: ma_uint64, ditherMode: ma_dither_mode) void;
pub extern fn ma_convert_pcm_frames_format(pOut: ?*anyopaque, formatOut: ma_format, pIn: ?*const anyopaque, formatIn: ma_format, frameCount: ma_uint64, channels: ma_uint32, ditherMode: ma_dither_mode) void;
pub extern fn ma_deinterleave_pcm_frames(format: ma_format, channels: ma_uint32, frameCount: ma_uint64, pInterleavedPCMFrames: ?*const anyopaque, ppDeinterleavedPCMFrames: [*c]?*anyopaque) void;
pub extern fn ma_interleave_pcm_frames(format: ma_format, channels: ma_uint32, frameCount: ma_uint64, ppDeinterleavedPCMFrames: [*c]?*const anyopaque, pInterleavedPCMFrames: ?*anyopaque) void;
pub extern fn ma_channel_map_get_channel(pChannelMap: [*c]const ma_channel, channelCount: ma_uint32, channelIndex: ma_uint32) ma_channel;
pub extern fn ma_channel_map_init_blank(pChannelMap: [*c]ma_channel, channels: ma_uint32) void;
pub extern fn ma_channel_map_init_standard(standardChannelMap: ma_standard_channel_map, pChannelMap: [*c]ma_channel, channelMapCap: usize, channels: ma_uint32) void;
pub extern fn ma_channel_map_copy(pOut: [*c]ma_channel, pIn: [*c]const ma_channel, channels: ma_uint32) void;
pub extern fn ma_channel_map_copy_or_default(pOut: [*c]ma_channel, channelMapCapOut: usize, pIn: [*c]const ma_channel, channels: ma_uint32) void;
pub extern fn ma_channel_map_is_valid(pChannelMap: [*c]const ma_channel, channels: ma_uint32) ma_bool32;
pub extern fn ma_channel_map_is_equal(pChannelMapA: [*c]const ma_channel, pChannelMapB: [*c]const ma_channel, channels: ma_uint32) ma_bool32;
pub extern fn ma_channel_map_is_blank(pChannelMap: [*c]const ma_channel, channels: ma_uint32) ma_bool32;
pub extern fn ma_channel_map_contains_channel_position(channels: ma_uint32, pChannelMap: [*c]const ma_channel, channelPosition: ma_channel) ma_bool32;
pub extern fn ma_channel_map_find_channel_position(channels: ma_uint32, pChannelMap: [*c]const ma_channel, channelPosition: ma_channel, pChannelIndex: [*c]ma_uint32) ma_bool32;
pub extern fn ma_channel_map_to_string(pChannelMap: [*c]const ma_channel, channels: ma_uint32, pBufferOut: [*c]u8, bufferCap: usize) usize;
pub extern fn ma_channel_position_to_string(channel: ma_channel) [*c]const u8;
pub extern fn ma_convert_frames(pOut: ?*anyopaque, frameCountOut: ma_uint64, formatOut: ma_format, channelsOut: ma_uint32, sampleRateOut: ma_uint32, pIn: ?*const anyopaque, frameCountIn: ma_uint64, formatIn: ma_format, channelsIn: ma_uint32, sampleRateIn: ma_uint32) ma_uint64;
pub extern fn ma_convert_frames_ex(pOut: ?*anyopaque, frameCountOut: ma_uint64, pIn: ?*const anyopaque, frameCountIn: ma_uint64, pConfig: [*c]const ma_data_converter_config) ma_uint64;
pub const ma_data_source = anyopaque;
pub const ma_data_source_vtable = extern struct {
    onRead: ?*const fn (pDataSource: ?*ma_data_source, pFramesOut: ?*anyopaque, frameCount: ma_uint64, pFramesRead: [*c]ma_uint64) callconv(.c) ma_result = null,
    onSeek: ?*const fn (pDataSource: ?*ma_data_source, frameIndex: ma_uint64) callconv(.c) ma_result = null,
    onGetDataFormat: ?*const fn (pDataSource: ?*ma_data_source, pFormat: [*c]ma_format, pChannels: [*c]ma_uint32, pSampleRate: [*c]ma_uint32, pChannelMap: [*c]ma_channel, channelMapCap: usize) callconv(.c) ma_result = null,
    onGetCursor: ?*const fn (pDataSource: ?*ma_data_source, pCursor: [*c]ma_uint64) callconv(.c) ma_result = null,
    onGetLength: ?*const fn (pDataSource: ?*ma_data_source, pLength: [*c]ma_uint64) callconv(.c) ma_result = null,
    onSetLooping: ?*const fn (pDataSource: ?*ma_data_source, isLooping: ma_bool32) callconv(.c) ma_result = null,
    flags: ma_uint32 = 0,
};
pub const ma_data_source_get_next_proc = ?*const fn (pDataSource: ?*ma_data_source) callconv(.c) ?*ma_data_source;
pub const ma_data_source_config = extern struct {
    vtable: [*c]const ma_data_source_vtable = null,
    pub const ma_data_source_init = __root.ma_data_source_init;
    pub const init = __root.ma_data_source_init;
};
pub extern fn ma_data_source_config_init() ma_data_source_config;
pub const ma_data_source_base = extern struct {
    vtable: [*c]const ma_data_source_vtable = null,
    rangeBegInFrames: ma_uint64 = 0,
    rangeEndInFrames: ma_uint64 = 0,
    loopBegInFrames: ma_uint64 = 0,
    loopEndInFrames: ma_uint64 = 0,
    pCurrent: ?*ma_data_source = null,
    pNext: ?*ma_data_source = null,
    onGetNext: ma_data_source_get_next_proc = null,
    isLooping: ma_bool32 = 0,
};
pub extern fn ma_data_source_init(pConfig: [*c]const ma_data_source_config, pDataSource: ?*ma_data_source) ma_result;
pub extern fn ma_data_source_uninit(pDataSource: ?*ma_data_source) void;
pub extern fn ma_data_source_read_pcm_frames(pDataSource: ?*ma_data_source, pFramesOut: ?*anyopaque, frameCount: ma_uint64, pFramesRead: [*c]ma_uint64) ma_result;
pub extern fn ma_data_source_seek_pcm_frames(pDataSource: ?*ma_data_source, frameCount: ma_uint64, pFramesSeeked: [*c]ma_uint64) ma_result;
pub extern fn ma_data_source_seek_to_pcm_frame(pDataSource: ?*ma_data_source, frameIndex: ma_uint64) ma_result;
pub extern fn ma_data_source_seek_seconds(pDataSource: ?*ma_data_source, secondCount: f32, pSecondsSeeked: [*c]f32) ma_result;
pub extern fn ma_data_source_seek_to_second(pDataSource: ?*ma_data_source, seekPointInSeconds: f32) ma_result;
pub extern fn ma_data_source_get_data_format(pDataSource: ?*ma_data_source, pFormat: [*c]ma_format, pChannels: [*c]ma_uint32, pSampleRate: [*c]ma_uint32, pChannelMap: [*c]ma_channel, channelMapCap: usize) ma_result;
pub extern fn ma_data_source_get_cursor_in_pcm_frames(pDataSource: ?*ma_data_source, pCursor: [*c]ma_uint64) ma_result;
pub extern fn ma_data_source_get_length_in_pcm_frames(pDataSource: ?*ma_data_source, pLength: [*c]ma_uint64) ma_result;
pub extern fn ma_data_source_get_cursor_in_seconds(pDataSource: ?*ma_data_source, pCursor: [*c]f32) ma_result;
pub extern fn ma_data_source_get_length_in_seconds(pDataSource: ?*ma_data_source, pLength: [*c]f32) ma_result;
pub extern fn ma_data_source_set_looping(pDataSource: ?*ma_data_source, isLooping: ma_bool32) ma_result;
pub extern fn ma_data_source_is_looping(pDataSource: ?*const ma_data_source) ma_bool32;
pub extern fn ma_data_source_set_range_in_pcm_frames(pDataSource: ?*ma_data_source, rangeBegInFrames: ma_uint64, rangeEndInFrames: ma_uint64) ma_result;
pub extern fn ma_data_source_get_range_in_pcm_frames(pDataSource: ?*const ma_data_source, pRangeBegInFrames: [*c]ma_uint64, pRangeEndInFrames: [*c]ma_uint64) void;
pub extern fn ma_data_source_set_loop_point_in_pcm_frames(pDataSource: ?*ma_data_source, loopBegInFrames: ma_uint64, loopEndInFrames: ma_uint64) ma_result;
pub extern fn ma_data_source_get_loop_point_in_pcm_frames(pDataSource: ?*const ma_data_source, pLoopBegInFrames: [*c]ma_uint64, pLoopEndInFrames: [*c]ma_uint64) void;
pub extern fn ma_data_source_set_current(pDataSource: ?*ma_data_source, pCurrentDataSource: ?*ma_data_source) ma_result;
pub extern fn ma_data_source_get_current(pDataSource: ?*const ma_data_source) ?*ma_data_source;
pub extern fn ma_data_source_set_next(pDataSource: ?*ma_data_source, pNextDataSource: ?*ma_data_source) ma_result;
pub extern fn ma_data_source_get_next(pDataSource: ?*const ma_data_source) ?*ma_data_source;
pub extern fn ma_data_source_set_next_callback(pDataSource: ?*ma_data_source, onGetNext: ma_data_source_get_next_proc) ma_result;
pub extern fn ma_data_source_get_next_callback(pDataSource: ?*const ma_data_source) ma_data_source_get_next_proc;
pub const ma_audio_buffer_ref = extern struct {
    ds: ma_data_source_base = @import("std").mem.zeroes(ma_data_source_base),
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    cursor: ma_uint64 = 0,
    sizeInFrames: ma_uint64 = 0,
    pData: ?*const anyopaque = null,
    pub const ma_audio_buffer_ref_uninit = __root.ma_audio_buffer_ref_uninit;
    pub const ma_audio_buffer_ref_set_data = __root.ma_audio_buffer_ref_set_data;
    pub const ma_audio_buffer_ref_read_pcm_frames = __root.ma_audio_buffer_ref_read_pcm_frames;
    pub const ma_audio_buffer_ref_seek_to_pcm_frame = __root.ma_audio_buffer_ref_seek_to_pcm_frame;
    pub const ma_audio_buffer_ref_map = __root.ma_audio_buffer_ref_map;
    pub const ma_audio_buffer_ref_unmap = __root.ma_audio_buffer_ref_unmap;
    pub const ma_audio_buffer_ref_at_end = __root.ma_audio_buffer_ref_at_end;
    pub const ma_audio_buffer_ref_get_cursor_in_pcm_frames = __root.ma_audio_buffer_ref_get_cursor_in_pcm_frames;
    pub const ma_audio_buffer_ref_get_length_in_pcm_frames = __root.ma_audio_buffer_ref_get_length_in_pcm_frames;
    pub const ma_audio_buffer_ref_get_available_frames = __root.ma_audio_buffer_ref_get_available_frames;
    pub const uninit = __root.ma_audio_buffer_ref_uninit;
    pub const set_data = __root.ma_audio_buffer_ref_set_data;
    pub const read_pcm_frames = __root.ma_audio_buffer_ref_read_pcm_frames;
    pub const seek_to_pcm_frame = __root.ma_audio_buffer_ref_seek_to_pcm_frame;
    pub const map = __root.ma_audio_buffer_ref_map;
    pub const unmap = __root.ma_audio_buffer_ref_unmap;
    pub const at_end = __root.ma_audio_buffer_ref_at_end;
    pub const get_cursor_in_pcm_frames = __root.ma_audio_buffer_ref_get_cursor_in_pcm_frames;
    pub const get_length_in_pcm_frames = __root.ma_audio_buffer_ref_get_length_in_pcm_frames;
    pub const get_available_frames = __root.ma_audio_buffer_ref_get_available_frames;
};
pub extern fn ma_audio_buffer_ref_init(format: ma_format, channels: ma_uint32, pData: ?*const anyopaque, sizeInFrames: ma_uint64, pAudioBufferRef: [*c]ma_audio_buffer_ref) ma_result;
pub extern fn ma_audio_buffer_ref_uninit(pAudioBufferRef: [*c]ma_audio_buffer_ref) void;
pub extern fn ma_audio_buffer_ref_set_data(pAudioBufferRef: [*c]ma_audio_buffer_ref, pData: ?*const anyopaque, sizeInFrames: ma_uint64) ma_result;
pub extern fn ma_audio_buffer_ref_read_pcm_frames(pAudioBufferRef: [*c]ma_audio_buffer_ref, pFramesOut: ?*anyopaque, frameCount: ma_uint64, loop: ma_bool32) ma_uint64;
pub extern fn ma_audio_buffer_ref_seek_to_pcm_frame(pAudioBufferRef: [*c]ma_audio_buffer_ref, frameIndex: ma_uint64) ma_result;
pub extern fn ma_audio_buffer_ref_map(pAudioBufferRef: [*c]ma_audio_buffer_ref, ppFramesOut: [*c]?*anyopaque, pFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_audio_buffer_ref_unmap(pAudioBufferRef: [*c]ma_audio_buffer_ref, frameCount: ma_uint64) ma_result;
pub extern fn ma_audio_buffer_ref_at_end(pAudioBufferRef: [*c]const ma_audio_buffer_ref) ma_bool32;
pub extern fn ma_audio_buffer_ref_get_cursor_in_pcm_frames(pAudioBufferRef: [*c]const ma_audio_buffer_ref, pCursor: [*c]ma_uint64) ma_result;
pub extern fn ma_audio_buffer_ref_get_length_in_pcm_frames(pAudioBufferRef: [*c]const ma_audio_buffer_ref, pLength: [*c]ma_uint64) ma_result;
pub extern fn ma_audio_buffer_ref_get_available_frames(pAudioBufferRef: [*c]const ma_audio_buffer_ref, pAvailableFrames: [*c]ma_uint64) ma_result;
pub const ma_audio_buffer_config = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    sizeInFrames: ma_uint64 = 0,
    pData: ?*const anyopaque = null,
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    pub const ma_audio_buffer_init = __root.ma_audio_buffer_init;
    pub const ma_audio_buffer_init_copy = __root.ma_audio_buffer_init_copy;
    pub const ma_audio_buffer_alloc_and_init = __root.ma_audio_buffer_alloc_and_init;
    pub const init = __root.ma_audio_buffer_init;
    pub const copy = __root.ma_audio_buffer_init_copy;
};
pub extern fn ma_audio_buffer_config_init(format: ma_format, channels: ma_uint32, sizeInFrames: ma_uint64, pData: ?*const anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ma_audio_buffer_config;
pub const ma_audio_buffer = extern struct {
    ref: ma_audio_buffer_ref = @import("std").mem.zeroes(ma_audio_buffer_ref),
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    ownsData: ma_bool32 = 0,
    _pExtraData: [1]ma_uint8 = @import("std").mem.zeroes([1]ma_uint8),
    pub const ma_audio_buffer_uninit = __root.ma_audio_buffer_uninit;
    pub const ma_audio_buffer_uninit_and_free = __root.ma_audio_buffer_uninit_and_free;
    pub const ma_audio_buffer_read_pcm_frames = __root.ma_audio_buffer_read_pcm_frames;
    pub const ma_audio_buffer_seek_to_pcm_frame = __root.ma_audio_buffer_seek_to_pcm_frame;
    pub const ma_audio_buffer_map = __root.ma_audio_buffer_map;
    pub const ma_audio_buffer_unmap = __root.ma_audio_buffer_unmap;
    pub const ma_audio_buffer_at_end = __root.ma_audio_buffer_at_end;
    pub const ma_audio_buffer_get_cursor_in_pcm_frames = __root.ma_audio_buffer_get_cursor_in_pcm_frames;
    pub const ma_audio_buffer_get_length_in_pcm_frames = __root.ma_audio_buffer_get_length_in_pcm_frames;
    pub const ma_audio_buffer_get_available_frames = __root.ma_audio_buffer_get_available_frames;
    pub const uninit = __root.ma_audio_buffer_uninit;
    pub const uninit_and_free = __root.ma_audio_buffer_uninit_and_free;
    pub const read_pcm_frames = __root.ma_audio_buffer_read_pcm_frames;
    pub const seek_to_pcm_frame = __root.ma_audio_buffer_seek_to_pcm_frame;
    pub const map = __root.ma_audio_buffer_map;
    pub const unmap = __root.ma_audio_buffer_unmap;
    pub const at_end = __root.ma_audio_buffer_at_end;
    pub const get_cursor_in_pcm_frames = __root.ma_audio_buffer_get_cursor_in_pcm_frames;
    pub const get_length_in_pcm_frames = __root.ma_audio_buffer_get_length_in_pcm_frames;
    pub const get_available_frames = __root.ma_audio_buffer_get_available_frames;
};
pub extern fn ma_audio_buffer_init(pConfig: [*c]const ma_audio_buffer_config, pAudioBuffer: [*c]ma_audio_buffer) ma_result;
pub extern fn ma_audio_buffer_init_copy(pConfig: [*c]const ma_audio_buffer_config, pAudioBuffer: [*c]ma_audio_buffer) ma_result;
pub extern fn ma_audio_buffer_alloc_and_init(pConfig: [*c]const ma_audio_buffer_config, ppAudioBuffer: [*c][*c]ma_audio_buffer) ma_result;
pub extern fn ma_audio_buffer_uninit(pAudioBuffer: [*c]ma_audio_buffer) void;
pub extern fn ma_audio_buffer_uninit_and_free(pAudioBuffer: [*c]ma_audio_buffer) void;
pub extern fn ma_audio_buffer_read_pcm_frames(pAudioBuffer: [*c]ma_audio_buffer, pFramesOut: ?*anyopaque, frameCount: ma_uint64, loop: ma_bool32) ma_uint64;
pub extern fn ma_audio_buffer_seek_to_pcm_frame(pAudioBuffer: [*c]ma_audio_buffer, frameIndex: ma_uint64) ma_result;
pub extern fn ma_audio_buffer_map(pAudioBuffer: [*c]ma_audio_buffer, ppFramesOut: [*c]?*anyopaque, pFrameCount: [*c]ma_uint64) ma_result;
pub extern fn ma_audio_buffer_unmap(pAudioBuffer: [*c]ma_audio_buffer, frameCount: ma_uint64) ma_result;
pub extern fn ma_audio_buffer_at_end(pAudioBuffer: [*c]const ma_audio_buffer) ma_bool32;
pub extern fn ma_audio_buffer_get_cursor_in_pcm_frames(pAudioBuffer: [*c]const ma_audio_buffer, pCursor: [*c]ma_uint64) ma_result;
pub extern fn ma_audio_buffer_get_length_in_pcm_frames(pAudioBuffer: [*c]const ma_audio_buffer, pLength: [*c]ma_uint64) ma_result;
pub extern fn ma_audio_buffer_get_available_frames(pAudioBuffer: [*c]const ma_audio_buffer, pAvailableFrames: [*c]ma_uint64) ma_result;
pub const ma_paged_audio_buffer_page = struct_ma_paged_audio_buffer_page;
pub const struct_ma_paged_audio_buffer_page = extern struct {
    pNext: [*c]ma_paged_audio_buffer_page = null,
    sizeInFrames: ma_uint64 = 0,
    pAudioData: [1]ma_uint8 = @import("std").mem.zeroes([1]ma_uint8),
};
pub const ma_paged_audio_buffer_data = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    head: ma_paged_audio_buffer_page = @import("std").mem.zeroes(ma_paged_audio_buffer_page),
    pTail: [*c]ma_paged_audio_buffer_page = null,
    pub const ma_paged_audio_buffer_data_uninit = __root.ma_paged_audio_buffer_data_uninit;
    pub const ma_paged_audio_buffer_data_get_head = __root.ma_paged_audio_buffer_data_get_head;
    pub const ma_paged_audio_buffer_data_get_tail = __root.ma_paged_audio_buffer_data_get_tail;
    pub const ma_paged_audio_buffer_data_get_length_in_pcm_frames = __root.ma_paged_audio_buffer_data_get_length_in_pcm_frames;
    pub const ma_paged_audio_buffer_data_allocate_page = __root.ma_paged_audio_buffer_data_allocate_page;
    pub const ma_paged_audio_buffer_data_free_page = __root.ma_paged_audio_buffer_data_free_page;
    pub const ma_paged_audio_buffer_data_append_page = __root.ma_paged_audio_buffer_data_append_page;
    pub const ma_paged_audio_buffer_data_allocate_and_append_page = __root.ma_paged_audio_buffer_data_allocate_and_append_page;
    pub const ma_paged_audio_buffer_config_init = __root.ma_paged_audio_buffer_config_init;
    pub const uninit = __root.ma_paged_audio_buffer_data_uninit;
    pub const get_head = __root.ma_paged_audio_buffer_data_get_head;
    pub const get_tail = __root.ma_paged_audio_buffer_data_get_tail;
    pub const get_length_in_pcm_frames = __root.ma_paged_audio_buffer_data_get_length_in_pcm_frames;
    pub const allocate_page = __root.ma_paged_audio_buffer_data_allocate_page;
    pub const free_page = __root.ma_paged_audio_buffer_data_free_page;
    pub const append_page = __root.ma_paged_audio_buffer_data_append_page;
    pub const allocate_and_append_page = __root.ma_paged_audio_buffer_data_allocate_and_append_page;
    pub const init = __root.ma_paged_audio_buffer_config_init;
};
pub extern fn ma_paged_audio_buffer_data_init(format: ma_format, channels: ma_uint32, pData: [*c]ma_paged_audio_buffer_data) ma_result;
pub extern fn ma_paged_audio_buffer_data_uninit(pData: [*c]ma_paged_audio_buffer_data, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_paged_audio_buffer_data_get_head(pData: [*c]ma_paged_audio_buffer_data) [*c]ma_paged_audio_buffer_page;
pub extern fn ma_paged_audio_buffer_data_get_tail(pData: [*c]ma_paged_audio_buffer_data) [*c]ma_paged_audio_buffer_page;
pub extern fn ma_paged_audio_buffer_data_get_length_in_pcm_frames(pData: [*c]ma_paged_audio_buffer_data, pLength: [*c]ma_uint64) ma_result;
pub extern fn ma_paged_audio_buffer_data_allocate_page(pData: [*c]ma_paged_audio_buffer_data, pageSizeInFrames: ma_uint64, pInitialData: ?*const anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks, ppPage: [*c][*c]ma_paged_audio_buffer_page) ma_result;
pub extern fn ma_paged_audio_buffer_data_free_page(pData: [*c]ma_paged_audio_buffer_data, pPage: [*c]ma_paged_audio_buffer_page, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ma_result;
pub extern fn ma_paged_audio_buffer_data_append_page(pData: [*c]ma_paged_audio_buffer_data, pPage: [*c]ma_paged_audio_buffer_page) ma_result;
pub extern fn ma_paged_audio_buffer_data_allocate_and_append_page(pData: [*c]ma_paged_audio_buffer_data, pageSizeInFrames: ma_uint32, pInitialData: ?*const anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ma_result;
pub const ma_paged_audio_buffer_config = extern struct {
    pData: [*c]ma_paged_audio_buffer_data = null,
    pub const ma_paged_audio_buffer_init = __root.ma_paged_audio_buffer_init;
    pub const init = __root.ma_paged_audio_buffer_init;
};
pub extern fn ma_paged_audio_buffer_config_init(pData: [*c]ma_paged_audio_buffer_data) ma_paged_audio_buffer_config;
pub const ma_paged_audio_buffer = extern struct {
    ds: ma_data_source_base = @import("std").mem.zeroes(ma_data_source_base),
    pData: [*c]ma_paged_audio_buffer_data = null,
    pCurrent: [*c]ma_paged_audio_buffer_page = null,
    relativeCursor: ma_uint64 = 0,
    absoluteCursor: ma_uint64 = 0,
    pub const ma_paged_audio_buffer_uninit = __root.ma_paged_audio_buffer_uninit;
    pub const ma_paged_audio_buffer_read_pcm_frames = __root.ma_paged_audio_buffer_read_pcm_frames;
    pub const ma_paged_audio_buffer_seek_to_pcm_frame = __root.ma_paged_audio_buffer_seek_to_pcm_frame;
    pub const ma_paged_audio_buffer_get_cursor_in_pcm_frames = __root.ma_paged_audio_buffer_get_cursor_in_pcm_frames;
    pub const ma_paged_audio_buffer_get_length_in_pcm_frames = __root.ma_paged_audio_buffer_get_length_in_pcm_frames;
    pub const uninit = __root.ma_paged_audio_buffer_uninit;
    pub const read_pcm_frames = __root.ma_paged_audio_buffer_read_pcm_frames;
    pub const seek_to_pcm_frame = __root.ma_paged_audio_buffer_seek_to_pcm_frame;
    pub const get_cursor_in_pcm_frames = __root.ma_paged_audio_buffer_get_cursor_in_pcm_frames;
    pub const get_length_in_pcm_frames = __root.ma_paged_audio_buffer_get_length_in_pcm_frames;
};
pub extern fn ma_paged_audio_buffer_init(pConfig: [*c]const ma_paged_audio_buffer_config, pPagedAudioBuffer: [*c]ma_paged_audio_buffer) ma_result;
pub extern fn ma_paged_audio_buffer_uninit(pPagedAudioBuffer: [*c]ma_paged_audio_buffer) void;
pub extern fn ma_paged_audio_buffer_read_pcm_frames(pPagedAudioBuffer: [*c]ma_paged_audio_buffer, pFramesOut: ?*anyopaque, frameCount: ma_uint64, pFramesRead: [*c]ma_uint64) ma_result;
pub extern fn ma_paged_audio_buffer_seek_to_pcm_frame(pPagedAudioBuffer: [*c]ma_paged_audio_buffer, frameIndex: ma_uint64) ma_result;
pub extern fn ma_paged_audio_buffer_get_cursor_in_pcm_frames(pPagedAudioBuffer: [*c]ma_paged_audio_buffer, pCursor: [*c]ma_uint64) ma_result;
pub extern fn ma_paged_audio_buffer_get_length_in_pcm_frames(pPagedAudioBuffer: [*c]ma_paged_audio_buffer, pLength: [*c]ma_uint64) ma_result;
pub const ma_rb = extern struct {
    pBuffer: ?*anyopaque = null,
    subbufferSizeInBytes: ma_uint32 = 0,
    subbufferCount: ma_uint32 = 0,
    subbufferStrideInBytes: ma_uint32 = 0,
    encodedReadOffset: ma_uint32 = 0,
    encodedWriteOffset: ma_uint32 = 0,
    ownsBuffer: ma_bool8 = 0,
    clearOnWriteAcquire: ma_bool8 = 0,
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    pub const ma_rb_uninit = __root.ma_rb_uninit;
    pub const ma_rb_reset = __root.ma_rb_reset;
    pub const ma_rb_acquire_read = __root.ma_rb_acquire_read;
    pub const ma_rb_commit_read = __root.ma_rb_commit_read;
    pub const ma_rb_acquire_write = __root.ma_rb_acquire_write;
    pub const ma_rb_commit_write = __root.ma_rb_commit_write;
    pub const ma_rb_seek_read = __root.ma_rb_seek_read;
    pub const ma_rb_seek_write = __root.ma_rb_seek_write;
    pub const ma_rb_pointer_distance = __root.ma_rb_pointer_distance;
    pub const ma_rb_available_read = __root.ma_rb_available_read;
    pub const ma_rb_available_write = __root.ma_rb_available_write;
    pub const ma_rb_get_subbuffer_size = __root.ma_rb_get_subbuffer_size;
    pub const ma_rb_get_subbuffer_stride = __root.ma_rb_get_subbuffer_stride;
    pub const ma_rb_get_subbuffer_offset = __root.ma_rb_get_subbuffer_offset;
    pub const ma_rb_get_subbuffer_ptr = __root.ma_rb_get_subbuffer_ptr;
    pub const uninit = __root.ma_rb_uninit;
    pub const reset = __root.ma_rb_reset;
    pub const acquire_read = __root.ma_rb_acquire_read;
    pub const commit_read = __root.ma_rb_commit_read;
    pub const acquire_write = __root.ma_rb_acquire_write;
    pub const commit_write = __root.ma_rb_commit_write;
    pub const seek_read = __root.ma_rb_seek_read;
    pub const seek_write = __root.ma_rb_seek_write;
    pub const pointer_distance = __root.ma_rb_pointer_distance;
    pub const available_read = __root.ma_rb_available_read;
    pub const available_write = __root.ma_rb_available_write;
    pub const get_subbuffer_size = __root.ma_rb_get_subbuffer_size;
    pub const get_subbuffer_stride = __root.ma_rb_get_subbuffer_stride;
    pub const get_subbuffer_offset = __root.ma_rb_get_subbuffer_offset;
    pub const get_subbuffer_ptr = __root.ma_rb_get_subbuffer_ptr;
};
pub extern fn ma_rb_init_ex(subbufferSizeInBytes: usize, subbufferCount: usize, subbufferStrideInBytes: usize, pOptionalPreallocatedBuffer: ?*anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pRB: [*c]ma_rb) ma_result;
pub extern fn ma_rb_init(bufferSizeInBytes: usize, pOptionalPreallocatedBuffer: ?*anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pRB: [*c]ma_rb) ma_result;
pub extern fn ma_rb_uninit(pRB: [*c]ma_rb) void;
pub extern fn ma_rb_reset(pRB: [*c]ma_rb) void;
pub extern fn ma_rb_acquire_read(pRB: [*c]ma_rb, pSizeInBytes: [*c]usize, ppBufferOut: [*c]?*anyopaque) ma_result;
pub extern fn ma_rb_commit_read(pRB: [*c]ma_rb, sizeInBytes: usize) ma_result;
pub extern fn ma_rb_acquire_write(pRB: [*c]ma_rb, pSizeInBytes: [*c]usize, ppBufferOut: [*c]?*anyopaque) ma_result;
pub extern fn ma_rb_commit_write(pRB: [*c]ma_rb, sizeInBytes: usize) ma_result;
pub extern fn ma_rb_seek_read(pRB: [*c]ma_rb, offsetInBytes: usize) ma_result;
pub extern fn ma_rb_seek_write(pRB: [*c]ma_rb, offsetInBytes: usize) ma_result;
pub extern fn ma_rb_pointer_distance(pRB: [*c]ma_rb) ma_int32;
pub extern fn ma_rb_available_read(pRB: [*c]ma_rb) ma_uint32;
pub extern fn ma_rb_available_write(pRB: [*c]ma_rb) ma_uint32;
pub extern fn ma_rb_get_subbuffer_size(pRB: [*c]ma_rb) usize;
pub extern fn ma_rb_get_subbuffer_stride(pRB: [*c]ma_rb) usize;
pub extern fn ma_rb_get_subbuffer_offset(pRB: [*c]ma_rb, subbufferIndex: usize) usize;
pub extern fn ma_rb_get_subbuffer_ptr(pRB: [*c]ma_rb, subbufferIndex: usize, pBuffer: ?*anyopaque) ?*anyopaque;
pub const ma_pcm_rb = extern struct {
    ds: ma_data_source_base = @import("std").mem.zeroes(ma_data_source_base),
    rb: ma_rb = @import("std").mem.zeroes(ma_rb),
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    pub const ma_pcm_rb_uninit = __root.ma_pcm_rb_uninit;
    pub const ma_pcm_rb_reset = __root.ma_pcm_rb_reset;
    pub const ma_pcm_rb_acquire_read = __root.ma_pcm_rb_acquire_read;
    pub const ma_pcm_rb_commit_read = __root.ma_pcm_rb_commit_read;
    pub const ma_pcm_rb_acquire_write = __root.ma_pcm_rb_acquire_write;
    pub const ma_pcm_rb_commit_write = __root.ma_pcm_rb_commit_write;
    pub const ma_pcm_rb_seek_read = __root.ma_pcm_rb_seek_read;
    pub const ma_pcm_rb_seek_write = __root.ma_pcm_rb_seek_write;
    pub const ma_pcm_rb_pointer_distance = __root.ma_pcm_rb_pointer_distance;
    pub const ma_pcm_rb_available_read = __root.ma_pcm_rb_available_read;
    pub const ma_pcm_rb_available_write = __root.ma_pcm_rb_available_write;
    pub const ma_pcm_rb_get_subbuffer_size = __root.ma_pcm_rb_get_subbuffer_size;
    pub const ma_pcm_rb_get_subbuffer_stride = __root.ma_pcm_rb_get_subbuffer_stride;
    pub const ma_pcm_rb_get_subbuffer_offset = __root.ma_pcm_rb_get_subbuffer_offset;
    pub const ma_pcm_rb_get_subbuffer_ptr = __root.ma_pcm_rb_get_subbuffer_ptr;
    pub const ma_pcm_rb_get_format = __root.ma_pcm_rb_get_format;
    pub const ma_pcm_rb_get_channels = __root.ma_pcm_rb_get_channels;
    pub const ma_pcm_rb_get_sample_rate = __root.ma_pcm_rb_get_sample_rate;
    pub const ma_pcm_rb_set_sample_rate = __root.ma_pcm_rb_set_sample_rate;
    pub const uninit = __root.ma_pcm_rb_uninit;
    pub const reset = __root.ma_pcm_rb_reset;
    pub const acquire_read = __root.ma_pcm_rb_acquire_read;
    pub const commit_read = __root.ma_pcm_rb_commit_read;
    pub const acquire_write = __root.ma_pcm_rb_acquire_write;
    pub const commit_write = __root.ma_pcm_rb_commit_write;
    pub const seek_read = __root.ma_pcm_rb_seek_read;
    pub const seek_write = __root.ma_pcm_rb_seek_write;
    pub const pointer_distance = __root.ma_pcm_rb_pointer_distance;
    pub const available_read = __root.ma_pcm_rb_available_read;
    pub const available_write = __root.ma_pcm_rb_available_write;
    pub const get_subbuffer_size = __root.ma_pcm_rb_get_subbuffer_size;
    pub const get_subbuffer_stride = __root.ma_pcm_rb_get_subbuffer_stride;
    pub const get_subbuffer_offset = __root.ma_pcm_rb_get_subbuffer_offset;
    pub const get_subbuffer_ptr = __root.ma_pcm_rb_get_subbuffer_ptr;
    pub const get_format = __root.ma_pcm_rb_get_format;
    pub const get_channels = __root.ma_pcm_rb_get_channels;
    pub const get_sample_rate = __root.ma_pcm_rb_get_sample_rate;
    pub const set_sample_rate = __root.ma_pcm_rb_set_sample_rate;
};
pub extern fn ma_pcm_rb_init_ex(format: ma_format, channels: ma_uint32, subbufferSizeInFrames: ma_uint32, subbufferCount: ma_uint32, subbufferStrideInFrames: ma_uint32, pOptionalPreallocatedBuffer: ?*anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pRB: [*c]ma_pcm_rb) ma_result;
pub extern fn ma_pcm_rb_init(format: ma_format, channels: ma_uint32, bufferSizeInFrames: ma_uint32, pOptionalPreallocatedBuffer: ?*anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pRB: [*c]ma_pcm_rb) ma_result;
pub extern fn ma_pcm_rb_uninit(pRB: [*c]ma_pcm_rb) void;
pub extern fn ma_pcm_rb_reset(pRB: [*c]ma_pcm_rb) void;
pub extern fn ma_pcm_rb_acquire_read(pRB: [*c]ma_pcm_rb, pSizeInFrames: [*c]ma_uint32, ppBufferOut: [*c]?*anyopaque) ma_result;
pub extern fn ma_pcm_rb_commit_read(pRB: [*c]ma_pcm_rb, sizeInFrames: ma_uint32) ma_result;
pub extern fn ma_pcm_rb_acquire_write(pRB: [*c]ma_pcm_rb, pSizeInFrames: [*c]ma_uint32, ppBufferOut: [*c]?*anyopaque) ma_result;
pub extern fn ma_pcm_rb_commit_write(pRB: [*c]ma_pcm_rb, sizeInFrames: ma_uint32) ma_result;
pub extern fn ma_pcm_rb_seek_read(pRB: [*c]ma_pcm_rb, offsetInFrames: ma_uint32) ma_result;
pub extern fn ma_pcm_rb_seek_write(pRB: [*c]ma_pcm_rb, offsetInFrames: ma_uint32) ma_result;
pub extern fn ma_pcm_rb_pointer_distance(pRB: [*c]ma_pcm_rb) ma_int32;
pub extern fn ma_pcm_rb_available_read(pRB: [*c]ma_pcm_rb) ma_uint32;
pub extern fn ma_pcm_rb_available_write(pRB: [*c]ma_pcm_rb) ma_uint32;
pub extern fn ma_pcm_rb_get_subbuffer_size(pRB: [*c]ma_pcm_rb) ma_uint32;
pub extern fn ma_pcm_rb_get_subbuffer_stride(pRB: [*c]ma_pcm_rb) ma_uint32;
pub extern fn ma_pcm_rb_get_subbuffer_offset(pRB: [*c]ma_pcm_rb, subbufferIndex: ma_uint32) ma_uint32;
pub extern fn ma_pcm_rb_get_subbuffer_ptr(pRB: [*c]ma_pcm_rb, subbufferIndex: ma_uint32, pBuffer: ?*anyopaque) ?*anyopaque;
pub extern fn ma_pcm_rb_get_format(pRB: [*c]const ma_pcm_rb) ma_format;
pub extern fn ma_pcm_rb_get_channels(pRB: [*c]const ma_pcm_rb) ma_uint32;
pub extern fn ma_pcm_rb_get_sample_rate(pRB: [*c]const ma_pcm_rb) ma_uint32;
pub extern fn ma_pcm_rb_set_sample_rate(pRB: [*c]ma_pcm_rb, sampleRate: ma_uint32) void;
pub const ma_duplex_rb = extern struct {
    rb: ma_pcm_rb = @import("std").mem.zeroes(ma_pcm_rb),
    pub const ma_duplex_rb_uninit = __root.ma_duplex_rb_uninit;
    pub const uninit = __root.ma_duplex_rb_uninit;
};
pub extern fn ma_duplex_rb_init(captureFormat: ma_format, captureChannels: ma_uint32, sampleRate: ma_uint32, captureInternalSampleRate: ma_uint32, captureInternalPeriodSizeInFrames: ma_uint32, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pRB: [*c]ma_duplex_rb) ma_result;
pub extern fn ma_duplex_rb_uninit(pRB: [*c]ma_duplex_rb) ma_result;
pub extern fn ma_result_description(result: ma_result) [*c]const u8;
pub extern fn ma_malloc(sz: usize, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ?*anyopaque;
pub extern fn ma_calloc(sz: usize, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ?*anyopaque;
pub extern fn ma_realloc(p: ?*anyopaque, sz: usize, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ?*anyopaque;
pub extern fn ma_free(p: ?*anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_aligned_malloc(sz: usize, alignment: usize, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ?*anyopaque;
pub extern fn ma_aligned_free(p: ?*anyopaque, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_get_format_name(format: ma_format) [*c]const u8;
pub extern fn ma_blend_f32(pOut: [*c]f32, pInA: [*c]f32, pInB: [*c]f32, factor: f32, channels: ma_uint32) void;
pub extern fn ma_get_bytes_per_sample(format: ma_format) ma_uint32;
pub inline fn ma_get_bytes_per_frame(arg_format: ma_format, arg_channels: ma_uint32) ma_uint32 {
    var format = arg_format;
    _ = &format;
    var channels = arg_channels;
    _ = &channels;
    return ma_get_bytes_per_sample(format) *% channels;
}
pub extern fn ma_log_level_to_string(logLevel: ma_uint32) [*c]const u8;
pub extern fn ma_spinlock_lock(pSpinlock: [*c]volatile ma_spinlock) ma_result;
pub extern fn ma_spinlock_lock_noyield(pSpinlock: [*c]volatile ma_spinlock) ma_result;
pub extern fn ma_spinlock_unlock(pSpinlock: [*c]volatile ma_spinlock) ma_result;
pub extern fn ma_mutex_init(pMutex: [*c]ma_mutex) ma_result;
pub extern fn ma_mutex_uninit(pMutex: [*c]ma_mutex) void;
pub extern fn ma_mutex_lock(pMutex: [*c]ma_mutex) void;
pub extern fn ma_mutex_unlock(pMutex: [*c]ma_mutex) void;
pub extern fn ma_event_init(pEvent: [*c]ma_event) ma_result;
pub extern fn ma_event_uninit(pEvent: [*c]ma_event) void;
pub extern fn ma_event_wait(pEvent: [*c]ma_event) ma_result;
pub extern fn ma_event_signal(pEvent: [*c]ma_event) ma_result;
pub extern fn ma_semaphore_init(initialValue: c_int, pSemaphore: [*c]ma_semaphore) ma_result;
pub extern fn ma_semaphore_uninit(pSemaphore: [*c]ma_semaphore) void;
pub extern fn ma_semaphore_wait(pSemaphore: [*c]ma_semaphore) ma_result;
pub extern fn ma_semaphore_release(pSemaphore: [*c]ma_semaphore) ma_result;
pub const ma_fence = extern struct {
    e: ma_event = null,
    counter: ma_uint32 = 0,
    pub const ma_fence_init = __root.ma_fence_init;
    pub const ma_fence_uninit = __root.ma_fence_uninit;
    pub const ma_fence_acquire = __root.ma_fence_acquire;
    pub const ma_fence_release = __root.ma_fence_release;
    pub const ma_fence_wait = __root.ma_fence_wait;
    pub const init = __root.ma_fence_init;
    pub const uninit = __root.ma_fence_uninit;
    pub const acquire = __root.ma_fence_acquire;
    pub const release = __root.ma_fence_release;
    pub const wait = __root.ma_fence_wait;
};
pub extern fn ma_fence_init(pFence: [*c]ma_fence) ma_result;
pub extern fn ma_fence_uninit(pFence: [*c]ma_fence) void;
pub extern fn ma_fence_acquire(pFence: [*c]ma_fence) ma_result;
pub extern fn ma_fence_release(pFence: [*c]ma_fence) ma_result;
pub extern fn ma_fence_wait(pFence: [*c]ma_fence) ma_result;
pub const ma_async_notification = anyopaque;
pub const ma_async_notification_callbacks = extern struct {
    onSignal: ?*const fn (pNotification: ?*ma_async_notification) callconv(.c) void = null,
};
pub extern fn ma_async_notification_signal(pNotification: ?*ma_async_notification) ma_result;
pub const ma_async_notification_poll = extern struct {
    cb: ma_async_notification_callbacks = @import("std").mem.zeroes(ma_async_notification_callbacks),
    signalled: ma_bool32 = 0,
    pub const ma_async_notification_poll_init = __root.ma_async_notification_poll_init;
    pub const ma_async_notification_poll_is_signalled = __root.ma_async_notification_poll_is_signalled;
    pub const init = __root.ma_async_notification_poll_init;
    pub const is_signalled = __root.ma_async_notification_poll_is_signalled;
};
pub extern fn ma_async_notification_poll_init(pNotificationPoll: [*c]ma_async_notification_poll) ma_result;
pub extern fn ma_async_notification_poll_is_signalled(pNotificationPoll: [*c]const ma_async_notification_poll) ma_bool32;
pub const ma_async_notification_event = extern struct {
    cb: ma_async_notification_callbacks = @import("std").mem.zeroes(ma_async_notification_callbacks),
    e: ma_event = null,
    pub const ma_async_notification_event_init = __root.ma_async_notification_event_init;
    pub const ma_async_notification_event_uninit = __root.ma_async_notification_event_uninit;
    pub const ma_async_notification_event_wait = __root.ma_async_notification_event_wait;
    pub const ma_async_notification_event_signal = __root.ma_async_notification_event_signal;
    pub const init = __root.ma_async_notification_event_init;
    pub const uninit = __root.ma_async_notification_event_uninit;
    pub const wait = __root.ma_async_notification_event_wait;
    pub const signal = __root.ma_async_notification_event_signal;
};
pub extern fn ma_async_notification_event_init(pNotificationEvent: [*c]ma_async_notification_event) ma_result;
pub extern fn ma_async_notification_event_uninit(pNotificationEvent: [*c]ma_async_notification_event) ma_result;
pub extern fn ma_async_notification_event_wait(pNotificationEvent: [*c]ma_async_notification_event) ma_result;
pub extern fn ma_async_notification_event_signal(pNotificationEvent: [*c]ma_async_notification_event) ma_result;
pub const ma_slot_allocator_config = extern struct {
    capacity: ma_uint32 = 0,
    pub const ma_slot_allocator_get_heap_size = __root.ma_slot_allocator_get_heap_size;
    pub const ma_slot_allocator_init_preallocated = __root.ma_slot_allocator_init_preallocated;
    pub const ma_slot_allocator_init = __root.ma_slot_allocator_init;
    pub const size = __root.ma_slot_allocator_get_heap_size;
    pub const preallocated = __root.ma_slot_allocator_init_preallocated;
    pub const init = __root.ma_slot_allocator_init;
};
pub extern fn ma_slot_allocator_config_init(capacity: ma_uint32) ma_slot_allocator_config;
pub const ma_slot_allocator_group = extern struct {
    bitfield: ma_uint32 = 0,
};
pub const ma_slot_allocator = extern struct {
    pGroups: [*c]ma_slot_allocator_group = null,
    pSlots: [*c]ma_uint32 = null,
    count: ma_uint32 = 0,
    capacity: ma_uint32 = 0,
    _ownsHeap: ma_bool32 = 0,
    _pHeap: ?*anyopaque = null,
    pub const ma_slot_allocator_uninit = __root.ma_slot_allocator_uninit;
    pub const ma_slot_allocator_alloc = __root.ma_slot_allocator_alloc;
    pub const ma_slot_allocator_free = __root.ma_slot_allocator_free;
    pub const uninit = __root.ma_slot_allocator_uninit;
    pub const alloc = __root.ma_slot_allocator_alloc;
    pub const free = __root.ma_slot_allocator_free;
};
pub extern fn ma_slot_allocator_get_heap_size(pConfig: [*c]const ma_slot_allocator_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_slot_allocator_init_preallocated(pConfig: [*c]const ma_slot_allocator_config, pHeap: ?*anyopaque, pAllocator: [*c]ma_slot_allocator) ma_result;
pub extern fn ma_slot_allocator_init(pConfig: [*c]const ma_slot_allocator_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pAllocator: [*c]ma_slot_allocator) ma_result;
pub extern fn ma_slot_allocator_uninit(pAllocator: [*c]ma_slot_allocator, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_slot_allocator_alloc(pAllocator: [*c]ma_slot_allocator, pSlot: [*c]ma_uint64) ma_result;
pub extern fn ma_slot_allocator_free(pAllocator: [*c]ma_slot_allocator, slot: ma_uint64) ma_result;
const struct_unnamed_38 = extern struct {
    code: ma_uint16 = 0,
    slot: ma_uint16 = 0,
    refcount: ma_uint32 = 0,
};
const union_unnamed_37 = extern union {
    breakup: struct_unnamed_38,
    allocation: ma_uint64,
};
pub const ma_job = struct_ma_job;
pub const ma_job_proc = ?*const fn (pJob: [*c]ma_job) callconv(.c) ma_result;
const struct_unnamed_40 = extern struct {
    proc: ma_job_proc = null,
    data0: ma_uintptr = 0,
    data1: ma_uintptr = 0,
};
const struct_unnamed_42 = extern struct {
    pResourceManager: ?*anyopaque = null,
    pDataBufferNode: ?*anyopaque = null,
    pFilePath: [*c]u8 = null,
    pFilePathW: [*c]wchar_t = null,
    flags: ma_uint32 = 0,
    pInitNotification: ?*ma_async_notification = null,
    pDoneNotification: ?*ma_async_notification = null,
    pInitFence: [*c]ma_fence = null,
    pDoneFence: [*c]ma_fence = null,
};
const struct_unnamed_43 = extern struct {
    pResourceManager: ?*anyopaque = null,
    pDataBufferNode: ?*anyopaque = null,
    pDoneNotification: ?*ma_async_notification = null,
    pDoneFence: [*c]ma_fence = null,
};
const struct_unnamed_44 = extern struct {
    pResourceManager: ?*anyopaque = null,
    pDataBufferNode: ?*anyopaque = null,
    pDecoder: ?*anyopaque = null,
    pDoneNotification: ?*ma_async_notification = null,
    pDoneFence: [*c]ma_fence = null,
};
const struct_unnamed_45 = extern struct {
    pDataBuffer: ?*anyopaque = null,
    pInitNotification: ?*ma_async_notification = null,
    pDoneNotification: ?*ma_async_notification = null,
    pInitFence: [*c]ma_fence = null,
    pDoneFence: [*c]ma_fence = null,
    rangeBegInPCMFrames: ma_uint64 = 0,
    rangeEndInPCMFrames: ma_uint64 = 0,
    loopPointBegInPCMFrames: ma_uint64 = 0,
    loopPointEndInPCMFrames: ma_uint64 = 0,
    isLooping: ma_uint32 = 0,
};
const struct_unnamed_46 = extern struct {
    pDataBuffer: ?*anyopaque = null,
    pDoneNotification: ?*ma_async_notification = null,
    pDoneFence: [*c]ma_fence = null,
};
const struct_unnamed_47 = extern struct {
    pDataStream: ?*anyopaque = null,
    pFilePath: [*c]u8 = null,
    pFilePathW: [*c]wchar_t = null,
    initialSeekPoint: ma_uint64 = 0,
    pInitNotification: ?*ma_async_notification = null,
    pInitFence: [*c]ma_fence = null,
};
const struct_unnamed_48 = extern struct {
    pDataStream: ?*anyopaque = null,
    pDoneNotification: ?*ma_async_notification = null,
    pDoneFence: [*c]ma_fence = null,
};
const struct_unnamed_49 = extern struct {
    pDataStream: ?*anyopaque = null,
    pageIndex: ma_uint32 = 0,
};
const struct_unnamed_50 = extern struct {
    pDataStream: ?*anyopaque = null,
    frameIndex: ma_uint64 = 0,
};
const union_unnamed_41 = extern union {
    loadDataBufferNode: struct_unnamed_42,
    freeDataBufferNode: struct_unnamed_43,
    pageDataBufferNode: struct_unnamed_44,
    loadDataBuffer: struct_unnamed_45,
    freeDataBuffer: struct_unnamed_46,
    loadDataStream: struct_unnamed_47,
    freeDataStream: struct_unnamed_48,
    pageDataStream: struct_unnamed_49,
    seekDataStream: struct_unnamed_50,
};
const struct_unnamed_53 = extern struct {
    pDevice: ?*anyopaque = null,
    deviceType: ma_uint32 = 0,
};
const union_unnamed_52 = extern union {
    reroute: struct_unnamed_53,
};
const union_unnamed_51 = extern union {
    aaudio: union_unnamed_52,
};
const union_unnamed_39 = extern union {
    custom: struct_unnamed_40,
    resourceManager: union_unnamed_41,
    device: union_unnamed_51,
};
pub const struct_ma_job = extern struct {
    toc: union_unnamed_37 = @import("std").mem.zeroes(union_unnamed_37),
    next: ma_uint64 = 0,
    order: ma_uint32 = 0,
    data: union_unnamed_39 = @import("std").mem.zeroes(union_unnamed_39),
    pub const ma_job_process = __root.ma_job_process;
    pub const process = __root.ma_job_process;
};
pub const MA_JOB_TYPE_QUIT: c_int = 0;
pub const MA_JOB_TYPE_CUSTOM: c_int = 1;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_LOAD_DATA_BUFFER_NODE: c_int = 2;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_FREE_DATA_BUFFER_NODE: c_int = 3;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_PAGE_DATA_BUFFER_NODE: c_int = 4;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_LOAD_DATA_BUFFER: c_int = 5;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_FREE_DATA_BUFFER: c_int = 6;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_LOAD_DATA_STREAM: c_int = 7;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_FREE_DATA_STREAM: c_int = 8;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_PAGE_DATA_STREAM: c_int = 9;
pub const MA_JOB_TYPE_RESOURCE_MANAGER_SEEK_DATA_STREAM: c_int = 10;
pub const MA_JOB_TYPE_DEVICE_AAUDIO_REROUTE: c_int = 11;
pub const MA_JOB_TYPE_COUNT: c_int = 12;
pub const ma_job_type = c_uint;
pub extern fn ma_job_init(code: ma_uint16) ma_job;
pub extern fn ma_job_process(pJob: [*c]ma_job) ma_result;
pub const MA_JOB_QUEUE_FLAG_NON_BLOCKING: c_int = 1;
pub const ma_job_queue_flags = c_uint;
pub const ma_job_queue_config = extern struct {
    flags: ma_uint32 = 0,
    capacity: ma_uint32 = 0,
    pub const ma_job_queue_get_heap_size = __root.ma_job_queue_get_heap_size;
    pub const ma_job_queue_init_preallocated = __root.ma_job_queue_init_preallocated;
    pub const ma_job_queue_init = __root.ma_job_queue_init;
    pub const size = __root.ma_job_queue_get_heap_size;
    pub const preallocated = __root.ma_job_queue_init_preallocated;
    pub const init = __root.ma_job_queue_init;
};
pub extern fn ma_job_queue_config_init(flags: ma_uint32, capacity: ma_uint32) ma_job_queue_config;
pub const ma_job_queue = extern struct {
    flags: ma_uint32 = 0,
    capacity: ma_uint32 = 0,
    head: ma_uint64 = 0,
    tail: ma_uint64 = 0,
    sem: ma_semaphore = null,
    allocator: ma_slot_allocator = @import("std").mem.zeroes(ma_slot_allocator),
    pJobs: [*c]ma_job = null,
    lock: ma_spinlock = 0,
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
    pub const ma_job_queue_uninit = __root.ma_job_queue_uninit;
    pub const ma_job_queue_post = __root.ma_job_queue_post;
    pub const ma_job_queue_next = __root.ma_job_queue_next;
    pub const uninit = __root.ma_job_queue_uninit;
    pub const post = __root.ma_job_queue_post;
    pub const next = __root.ma_job_queue_next;
};
pub extern fn ma_job_queue_get_heap_size(pConfig: [*c]const ma_job_queue_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_job_queue_init_preallocated(pConfig: [*c]const ma_job_queue_config, pHeap: ?*anyopaque, pQueue: [*c]ma_job_queue) ma_result;
pub extern fn ma_job_queue_init(pConfig: [*c]const ma_job_queue_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pQueue: [*c]ma_job_queue) ma_result;
pub extern fn ma_job_queue_uninit(pQueue: [*c]ma_job_queue, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_job_queue_post(pQueue: [*c]ma_job_queue, pJob: [*c]const ma_job) ma_result;
pub extern fn ma_job_queue_next(pQueue: [*c]ma_job_queue, pJob: [*c]ma_job) ma_result;
pub const ma_device_state_uninitialized: c_int = 0;
pub const ma_device_state_stopped: c_int = 1;
pub const ma_device_state_started: c_int = 2;
pub const ma_device_state_starting: c_int = 3;
pub const ma_device_state_stopping: c_int = 4;
pub const ma_device_state = c_uint;
pub const ma_atomic_device_state = extern struct {
    value: ma_device_state = @import("std").mem.zeroes(ma_device_state),
};
pub const ma_IMMNotificationClient = extern struct {
    lpVtbl: ?*anyopaque = null,
    counter: ma_uint32 = 0,
    pDevice: [*c]ma_device = null,
};
pub const ma_backend_wasapi: c_int = 0;
pub const ma_backend_dsound: c_int = 1;
pub const ma_backend_winmm: c_int = 2;
pub const ma_backend_coreaudio: c_int = 3;
pub const ma_backend_sndio: c_int = 4;
pub const ma_backend_audio4: c_int = 5;
pub const ma_backend_oss: c_int = 6;
pub const ma_backend_pulseaudio: c_int = 7;
pub const ma_backend_alsa: c_int = 8;
pub const ma_backend_jack: c_int = 9;
pub const ma_backend_aaudio: c_int = 10;
pub const ma_backend_opensl: c_int = 11;
pub const ma_backend_webaudio: c_int = 12;
pub const ma_backend_custom: c_int = 13;
pub const ma_backend_null: c_int = 14;
pub const ma_backend = c_uint;
pub const ma_device_job_thread_config = extern struct {
    noThread: ma_bool32 = 0,
    jobQueueCapacity: ma_uint32 = 0,
    jobQueueFlags: ma_uint32 = 0,
    pub const ma_device_job_thread_init = __root.ma_device_job_thread_init;
    pub const init = __root.ma_device_job_thread_init;
};
pub extern fn ma_device_job_thread_config_init() ma_device_job_thread_config;
pub const ma_device_job_thread = extern struct {
    thread: ma_thread = null,
    jobQueue: ma_job_queue = @import("std").mem.zeroes(ma_job_queue),
    _hasThread: ma_bool32 = 0,
    pub const ma_device_job_thread_uninit = __root.ma_device_job_thread_uninit;
    pub const ma_device_job_thread_post = __root.ma_device_job_thread_post;
    pub const ma_device_job_thread_next = __root.ma_device_job_thread_next;
    pub const uninit = __root.ma_device_job_thread_uninit;
    pub const post = __root.ma_device_job_thread_post;
    pub const next = __root.ma_device_job_thread_next;
};
pub extern fn ma_device_job_thread_init(pConfig: [*c]const ma_device_job_thread_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pJobThread: [*c]ma_device_job_thread) ma_result;
pub extern fn ma_device_job_thread_uninit(pJobThread: [*c]ma_device_job_thread, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_device_job_thread_post(pJobThread: [*c]ma_device_job_thread, pJob: [*c]const ma_job) ma_result;
pub extern fn ma_device_job_thread_next(pJobThread: [*c]ma_device_job_thread, pJob: [*c]ma_job) ma_result;
pub const ma_device_notification_type_started: c_int = 0;
pub const ma_device_notification_type_stopped: c_int = 1;
pub const ma_device_notification_type_rerouted: c_int = 2;
pub const ma_device_notification_type_interruption_began: c_int = 3;
pub const ma_device_notification_type_interruption_ended: c_int = 4;
pub const ma_device_notification_type_unlocked: c_int = 5;
pub const ma_device_notification_type = c_uint;
const struct_unnamed_55 = extern struct {
    _unused: c_int = 0,
};
const struct_unnamed_56 = extern struct {
    _unused: c_int = 0,
};
const struct_unnamed_57 = extern struct {
    _unused: c_int = 0,
};
const struct_unnamed_58 = extern struct {
    _unused: c_int = 0,
};
const union_unnamed_54 = extern union {
    started: struct_unnamed_55,
    stopped: struct_unnamed_56,
    rerouted: struct_unnamed_57,
    interruption: struct_unnamed_58,
};
pub const ma_device_notification = extern struct {
    pDevice: [*c]ma_device = null,
    type: ma_device_notification_type = @import("std").mem.zeroes(ma_device_notification_type),
    data: union_unnamed_54 = @import("std").mem.zeroes(union_unnamed_54),
};
pub const ma_device_type_playback: c_int = 1;
pub const ma_device_type_capture: c_int = 2;
pub const ma_device_type_duplex: c_int = 3;
pub const ma_device_type_loopback: c_int = 4;
pub const ma_device_type = c_uint;
pub const ma_share_mode_shared: c_int = 0;
pub const ma_share_mode_exclusive: c_int = 1;
pub const ma_share_mode = c_uint;
pub const ma_ios_session_category_default: c_int = 0;
pub const ma_ios_session_category_none: c_int = 1;
pub const ma_ios_session_category_ambient: c_int = 2;
pub const ma_ios_session_category_solo_ambient: c_int = 3;
pub const ma_ios_session_category_playback: c_int = 4;
pub const ma_ios_session_category_record: c_int = 5;
pub const ma_ios_session_category_play_and_record: c_int = 6;
pub const ma_ios_session_category_multi_route: c_int = 7;
pub const ma_ios_session_category = c_uint;
pub const ma_ios_session_category_option_mix_with_others: c_int = 1;
pub const ma_ios_session_category_option_duck_others: c_int = 2;
pub const ma_ios_session_category_option_allow_bluetooth: c_int = 4;
pub const ma_ios_session_category_option_default_to_speaker: c_int = 8;
pub const ma_ios_session_category_option_interrupt_spoken_audio_and_mix_with_others: c_int = 17;
pub const ma_ios_session_category_option_allow_bluetooth_a2dp: c_int = 32;
pub const ma_ios_session_category_option_allow_air_play: c_int = 64;
pub const ma_ios_session_category_option = c_uint;
pub const ma_opensl_stream_type_default: c_int = 0;
pub const ma_opensl_stream_type_voice: c_int = 1;
pub const ma_opensl_stream_type_system: c_int = 2;
pub const ma_opensl_stream_type_ring: c_int = 3;
pub const ma_opensl_stream_type_media: c_int = 4;
pub const ma_opensl_stream_type_alarm: c_int = 5;
pub const ma_opensl_stream_type_notification: c_int = 6;
pub const ma_opensl_stream_type = c_uint;
pub const ma_opensl_recording_preset_default: c_int = 0;
pub const ma_opensl_recording_preset_generic: c_int = 1;
pub const ma_opensl_recording_preset_camcorder: c_int = 2;
pub const ma_opensl_recording_preset_voice_recognition: c_int = 3;
pub const ma_opensl_recording_preset_voice_communication: c_int = 4;
pub const ma_opensl_recording_preset_voice_unprocessed: c_int = 5;
pub const ma_opensl_recording_preset = c_uint;
pub const ma_wasapi_usage_default: c_int = 0;
pub const ma_wasapi_usage_games: c_int = 1;
pub const ma_wasapi_usage_pro_audio: c_int = 2;
pub const ma_wasapi_usage = c_uint;
pub const ma_aaudio_usage_default: c_int = 0;
pub const ma_aaudio_usage_media: c_int = 1;
pub const ma_aaudio_usage_voice_communication: c_int = 2;
pub const ma_aaudio_usage_voice_communication_signalling: c_int = 3;
pub const ma_aaudio_usage_alarm: c_int = 4;
pub const ma_aaudio_usage_notification: c_int = 5;
pub const ma_aaudio_usage_notification_ringtone: c_int = 6;
pub const ma_aaudio_usage_notification_event: c_int = 7;
pub const ma_aaudio_usage_assistance_accessibility: c_int = 8;
pub const ma_aaudio_usage_assistance_navigation_guidance: c_int = 9;
pub const ma_aaudio_usage_assistance_sonification: c_int = 10;
pub const ma_aaudio_usage_game: c_int = 11;
pub const ma_aaudio_usage_assitant: c_int = 12;
pub const ma_aaudio_usage_emergency: c_int = 13;
pub const ma_aaudio_usage_safety: c_int = 14;
pub const ma_aaudio_usage_vehicle_status: c_int = 15;
pub const ma_aaudio_usage_announcement: c_int = 16;
pub const ma_aaudio_usage = c_uint;
pub const ma_aaudio_content_type_default: c_int = 0;
pub const ma_aaudio_content_type_speech: c_int = 1;
pub const ma_aaudio_content_type_music: c_int = 2;
pub const ma_aaudio_content_type_movie: c_int = 3;
pub const ma_aaudio_content_type_sonification: c_int = 4;
pub const ma_aaudio_content_type = c_uint;
pub const ma_aaudio_input_preset_default: c_int = 0;
pub const ma_aaudio_input_preset_generic: c_int = 1;
pub const ma_aaudio_input_preset_camcorder: c_int = 2;
pub const ma_aaudio_input_preset_voice_recognition: c_int = 3;
pub const ma_aaudio_input_preset_voice_communication: c_int = 4;
pub const ma_aaudio_input_preset_unprocessed: c_int = 5;
pub const ma_aaudio_input_preset_voice_performance: c_int = 6;
pub const ma_aaudio_input_preset = c_uint;
pub const ma_aaudio_allow_capture_default: c_int = 0;
pub const ma_aaudio_allow_capture_by_all: c_int = 1;
pub const ma_aaudio_allow_capture_by_system: c_int = 2;
pub const ma_aaudio_allow_capture_by_none: c_int = 3;
pub const ma_aaudio_allowed_capture_policy = c_uint;
pub const ma_timer = extern union {
    counter: ma_int64,
    counterD: f64,
};
const union_unnamed_59 = extern union {
    i: c_int,
    s: [256]u8,
    p: ?*anyopaque,
};
pub const ma_device_id = extern union {
    wasapi: [64]ma_wchar_win32,
    dsound: [16]ma_uint8,
    winmm: ma_uint32,
    alsa: [256]u8,
    pulse: [256]u8,
    jack: c_int,
    coreaudio: [256]u8,
    sndio: [256]u8,
    audio4: [256]u8,
    oss: [64]u8,
    aaudio: ma_int32,
    opensl: ma_uint32,
    webaudio: [32]u8,
    custom: union_unnamed_59,
    nullbackend: c_int,
    pub const ma_device_id_equal = __root.ma_device_id_equal;
    pub const equal = __root.ma_device_id_equal;
};
pub extern fn ma_device_id_equal(pA: [*c]const ma_device_id, pB: [*c]const ma_device_id) ma_bool32;
const struct_unnamed_60 = extern struct {
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    flags: ma_uint32 = 0,
};
pub const ma_device_info = extern struct {
    id: ma_device_id = @import("std").mem.zeroes(ma_device_id),
    name: [256]u8 = @import("std").mem.zeroes([256]u8),
    isDefault: ma_bool32 = 0,
    nativeDataFormatCount: ma_uint32 = 0,
    nativeDataFormats: [64]struct_unnamed_60 = @import("std").mem.zeroes([64]struct_unnamed_60),
};
pub const ma_device_descriptor = extern struct {
    pDeviceID: [*c]const ma_device_id = null,
    shareMode: ma_share_mode = @import("std").mem.zeroes(ma_share_mode),
    format: ma_format = @import("std").mem.zeroes(ma_format),
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    channelMap: [254]ma_channel = @import("std").mem.zeroes([254]ma_channel),
    periodSizeInFrames: ma_uint32 = 0,
    periodSizeInMilliseconds: ma_uint32 = 0,
    periodCount: ma_uint32 = 0,
    pub const ma_calculate_buffer_size_in_frames_from_descriptor = __root.ma_calculate_buffer_size_in_frames_from_descriptor;
    pub const descriptor = __root.ma_calculate_buffer_size_in_frames_from_descriptor;
};
const struct_unnamed_62 = extern struct {
    _unused: c_int = 0,
};
const struct_unnamed_63 = extern struct {
    deviceType: ma_device_type = @import("std").mem.zeroes(ma_device_type),
    pAudioClient: ?*anyopaque = null,
    ppAudioClientService: [*c]?*anyopaque = null,
    pResult: [*c]ma_result = null,
};
const struct_unnamed_64 = extern struct {
    pDevice: [*c]ma_device = null,
    deviceType: ma_device_type = @import("std").mem.zeroes(ma_device_type),
};
const union_unnamed_61 = extern union {
    quit: struct_unnamed_62,
    createAudioClient: struct_unnamed_63,
    releaseAudioClient: struct_unnamed_64,
};
pub const ma_context_command__wasapi = extern struct {
    code: c_int = 0,
    pEvent: [*c]ma_event = null,
    data: union_unnamed_61 = @import("std").mem.zeroes(union_unnamed_61),
};
pub extern fn ma_context_config_init() ma_context_config;
pub extern fn ma_context_init(backends: [*c]const ma_backend, backendCount: ma_uint32, pConfig: [*c]const ma_context_config, pContext: [*c]ma_context) ma_result;
pub extern fn ma_context_uninit(pContext: [*c]ma_context) ma_result;
pub extern fn ma_context_sizeof() usize;
pub extern fn ma_context_get_log(pContext: [*c]ma_context) [*c]ma_log;
pub extern fn ma_context_enumerate_devices(pContext: [*c]ma_context, callback: ma_enum_devices_callback_proc, pUserData: ?*anyopaque) ma_result;
pub extern fn ma_context_get_devices(pContext: [*c]ma_context, ppPlaybackDeviceInfos: [*c][*c]ma_device_info, pPlaybackDeviceCount: [*c]ma_uint32, ppCaptureDeviceInfos: [*c][*c]ma_device_info, pCaptureDeviceCount: [*c]ma_uint32) ma_result;
pub extern fn ma_context_get_device_info(pContext: [*c]ma_context, deviceType: ma_device_type, pDeviceID: [*c]const ma_device_id, pDeviceInfo: [*c]ma_device_info) ma_result;
pub extern fn ma_context_is_loopback_supported(pContext: [*c]ma_context) ma_bool32;
pub extern fn ma_device_config_init(deviceType: ma_device_type) ma_device_config;
pub extern fn ma_device_init(pContext: [*c]ma_context, pConfig: [*c]const ma_device_config, pDevice: [*c]ma_device) ma_result;
pub extern fn ma_device_init_ex(backends: [*c]const ma_backend, backendCount: ma_uint32, pContextConfig: [*c]const ma_context_config, pConfig: [*c]const ma_device_config, pDevice: [*c]ma_device) ma_result;
pub extern fn ma_device_uninit(pDevice: [*c]ma_device) void;
pub extern fn ma_device_get_context(pDevice: [*c]ma_device) [*c]ma_context;
pub extern fn ma_device_get_log(pDevice: [*c]ma_device) [*c]ma_log;
pub extern fn ma_device_get_info(pDevice: [*c]ma_device, @"type": ma_device_type, pDeviceInfo: [*c]ma_device_info) ma_result;
pub extern fn ma_device_get_name(pDevice: [*c]ma_device, @"type": ma_device_type, pName: [*c]u8, nameCap: usize, pLengthNotIncludingNullTerminator: [*c]usize) ma_result;
pub extern fn ma_device_start(pDevice: [*c]ma_device) ma_result;
pub extern fn ma_device_stop(pDevice: [*c]ma_device) ma_result;
pub extern fn ma_device_is_started(pDevice: [*c]const ma_device) ma_bool32;
pub extern fn ma_device_get_state(pDevice: [*c]const ma_device) ma_device_state;
pub extern fn ma_device_post_init(pDevice: [*c]ma_device, deviceType: ma_device_type, pPlaybackDescriptor: [*c]const ma_device_descriptor, pCaptureDescriptor: [*c]const ma_device_descriptor) ma_result;
pub extern fn ma_device_set_master_volume(pDevice: [*c]ma_device, volume: f32) ma_result;
pub extern fn ma_device_get_master_volume(pDevice: [*c]ma_device, pVolume: [*c]f32) ma_result;
pub extern fn ma_device_set_master_volume_db(pDevice: [*c]ma_device, gainDB: f32) ma_result;
pub extern fn ma_device_get_master_volume_db(pDevice: [*c]ma_device, pGainDB: [*c]f32) ma_result;
pub extern fn ma_device_handle_backend_data_callback(pDevice: [*c]ma_device, pOutput: ?*anyopaque, pInput: ?*const anyopaque, frameCount: ma_uint32) ma_result;
pub extern fn ma_calculate_buffer_size_in_frames_from_descriptor(pDescriptor: [*c]const ma_device_descriptor, nativeSampleRate: ma_uint32, performanceProfile: ma_performance_profile) ma_uint32;
pub extern fn ma_get_backend_name(backend: ma_backend) [*c]const u8;
pub extern fn ma_get_backend_from_name(pBackendName: [*c]const u8, pBackend: [*c]ma_backend) ma_result;
pub extern fn ma_is_backend_enabled(backend: ma_backend) ma_bool32;
pub extern fn ma_get_enabled_backends(pBackends: [*c]ma_backend, backendCap: usize, pBackendCount: [*c]usize) ma_result;
pub extern fn ma_is_loopback_supported(backend: ma_backend) ma_bool32;
pub extern fn ma_calculate_buffer_size_in_milliseconds_from_frames(bufferSizeInFrames: ma_uint32, sampleRate: ma_uint32) ma_uint32;
pub extern fn ma_calculate_buffer_size_in_frames_from_milliseconds(bufferSizeInMilliseconds: ma_uint32, sampleRate: ma_uint32) ma_uint32;
pub extern fn ma_copy_pcm_frames(dst: ?*anyopaque, src: ?*const anyopaque, frameCount: ma_uint64, format: ma_format, channels: ma_uint32) void;
pub extern fn ma_silence_pcm_frames(p: ?*anyopaque, frameCount: ma_uint64, format: ma_format, channels: ma_uint32) void;
pub extern fn ma_offset_pcm_frames_ptr(p: ?*anyopaque, offsetInFrames: ma_uint64, format: ma_format, channels: ma_uint32) ?*anyopaque;
pub extern fn ma_offset_pcm_frames_const_ptr(p: ?*const anyopaque, offsetInFrames: ma_uint64, format: ma_format, channels: ma_uint32) ?*const anyopaque;
pub inline fn ma_offset_pcm_frames_ptr_f32(arg_p: [*c]f32, arg_offsetInFrames: ma_uint64, arg_channels: ma_uint32) [*c]f32 {
    var p = arg_p;
    _ = &p;
    var offsetInFrames = arg_offsetInFrames;
    _ = &offsetInFrames;
    var channels = arg_channels;
    _ = &channels;
    return @ptrCast(@alignCast(ma_offset_pcm_frames_ptr(@ptrCast(@alignCast(p)), offsetInFrames, ma_format_f32, channels)));
}
pub inline fn ma_offset_pcm_frames_const_ptr_f32(arg_p: [*c]const f32, arg_offsetInFrames: ma_uint64, arg_channels: ma_uint32) [*c]const f32 {
    var p = arg_p;
    _ = &p;
    var offsetInFrames = arg_offsetInFrames;
    _ = &offsetInFrames;
    var channels = arg_channels;
    _ = &channels;
    return @ptrCast(@alignCast(ma_offset_pcm_frames_const_ptr(@ptrCast(@alignCast(p)), offsetInFrames, ma_format_f32, channels)));
}
pub extern fn ma_clip_samples_u8(pDst: [*c]ma_uint8, pSrc: [*c]const ma_int16, count: ma_uint64) void;
pub extern fn ma_clip_samples_s16(pDst: [*c]ma_int16, pSrc: [*c]const ma_int32, count: ma_uint64) void;
pub extern fn ma_clip_samples_s24(pDst: [*c]ma_uint8, pSrc: [*c]const ma_int64, count: ma_uint64) void;
pub extern fn ma_clip_samples_s32(pDst: [*c]ma_int32, pSrc: [*c]const ma_int64, count: ma_uint64) void;
pub extern fn ma_clip_samples_f32(pDst: [*c]f32, pSrc: [*c]const f32, count: ma_uint64) void;
pub extern fn ma_clip_pcm_frames(pDst: ?*anyopaque, pSrc: ?*const anyopaque, frameCount: ma_uint64, format: ma_format, channels: ma_uint32) void;
pub extern fn ma_copy_and_apply_volume_factor_u8(pSamplesOut: [*c]ma_uint8, pSamplesIn: [*c]const ma_uint8, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_s16(pSamplesOut: [*c]ma_int16, pSamplesIn: [*c]const ma_int16, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_s24(pSamplesOut: ?*anyopaque, pSamplesIn: ?*const anyopaque, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_s32(pSamplesOut: [*c]ma_int32, pSamplesIn: [*c]const ma_int32, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_f32(pSamplesOut: [*c]f32, pSamplesIn: [*c]const f32, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_apply_volume_factor_u8(pSamples: [*c]ma_uint8, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_apply_volume_factor_s16(pSamples: [*c]ma_int16, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_apply_volume_factor_s24(pSamples: ?*anyopaque, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_apply_volume_factor_s32(pSamples: [*c]ma_int32, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_apply_volume_factor_f32(pSamples: [*c]f32, sampleCount: ma_uint64, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_pcm_frames_u8(pFramesOut: [*c]ma_uint8, pFramesIn: [*c]const ma_uint8, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_pcm_frames_s16(pFramesOut: [*c]ma_int16, pFramesIn: [*c]const ma_int16, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_pcm_frames_s24(pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_pcm_frames_s32(pFramesOut: [*c]ma_int32, pFramesIn: [*c]const ma_int32, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_pcm_frames_f32(pFramesOut: [*c]f32, pFramesIn: [*c]const f32, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_pcm_frames(pFramesOut: ?*anyopaque, pFramesIn: ?*const anyopaque, frameCount: ma_uint64, format: ma_format, channels: ma_uint32, factor: f32) void;
pub extern fn ma_apply_volume_factor_pcm_frames_u8(pFrames: [*c]ma_uint8, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_apply_volume_factor_pcm_frames_s16(pFrames: [*c]ma_int16, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_apply_volume_factor_pcm_frames_s24(pFrames: ?*anyopaque, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_apply_volume_factor_pcm_frames_s32(pFrames: [*c]ma_int32, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_apply_volume_factor_pcm_frames_f32(pFrames: [*c]f32, frameCount: ma_uint64, channels: ma_uint32, factor: f32) void;
pub extern fn ma_apply_volume_factor_pcm_frames(pFrames: ?*anyopaque, frameCount: ma_uint64, format: ma_format, channels: ma_uint32, factor: f32) void;
pub extern fn ma_copy_and_apply_volume_factor_per_channel_f32(pFramesOut: [*c]f32, pFramesIn: [*c]const f32, frameCount: ma_uint64, channels: ma_uint32, pChannelGains: [*c]f32) void;
pub extern fn ma_copy_and_apply_volume_and_clip_samples_u8(pDst: [*c]ma_uint8, pSrc: [*c]const ma_int16, count: ma_uint64, volume: f32) void;
pub extern fn ma_copy_and_apply_volume_and_clip_samples_s16(pDst: [*c]ma_int16, pSrc: [*c]const ma_int32, count: ma_uint64, volume: f32) void;
pub extern fn ma_copy_and_apply_volume_and_clip_samples_s24(pDst: [*c]ma_uint8, pSrc: [*c]const ma_int64, count: ma_uint64, volume: f32) void;
pub extern fn ma_copy_and_apply_volume_and_clip_samples_s32(pDst: [*c]ma_int32, pSrc: [*c]const ma_int64, count: ma_uint64, volume: f32) void;
pub extern fn ma_copy_and_apply_volume_and_clip_samples_f32(pDst: [*c]f32, pSrc: [*c]const f32, count: ma_uint64, volume: f32) void;
pub extern fn ma_copy_and_apply_volume_and_clip_pcm_frames(pDst: ?*anyopaque, pSrc: ?*const anyopaque, frameCount: ma_uint64, format: ma_format, channels: ma_uint32, volume: f32) void;
pub extern fn ma_volume_linear_to_db(factor: f32) f32;
pub extern fn ma_volume_db_to_linear(gain: f32) f32;
pub extern fn ma_mix_pcm_frames_f32(pDst: [*c]f32, pSrc: [*c]const f32, frameCount: ma_uint64, channels: ma_uint32, volume: f32) ma_result;
pub const ma_vfs = anyopaque;
pub const ma_vfs_file = ma_handle;
pub const MA_OPEN_MODE_READ: c_int = 1;
pub const MA_OPEN_MODE_WRITE: c_int = 2;
pub const ma_open_mode_flags = c_uint;
pub const ma_seek_origin_start: c_int = 0;
pub const ma_seek_origin_current: c_int = 1;
pub const ma_seek_origin_end: c_int = 2;
pub const ma_seek_origin = c_uint;
pub const ma_file_info = extern struct {
    sizeInBytes: ma_uint64 = 0,
};
pub const ma_vfs_callbacks = extern struct {
    onOpen: ?*const fn (pVFS: ?*ma_vfs, pFilePath: [*c]const u8, openMode: ma_uint32, pFile: [*c]ma_vfs_file) callconv(.c) ma_result = null,
    onOpenW: ?*const fn (pVFS: ?*ma_vfs, pFilePath: [*c]const wchar_t, openMode: ma_uint32, pFile: [*c]ma_vfs_file) callconv(.c) ma_result = null,
    onClose: ?*const fn (pVFS: ?*ma_vfs, file: ma_vfs_file) callconv(.c) ma_result = null,
    onRead: ?*const fn (pVFS: ?*ma_vfs, file: ma_vfs_file, pDst: ?*anyopaque, sizeInBytes: usize, pBytesRead: [*c]usize) callconv(.c) ma_result = null,
    onWrite: ?*const fn (pVFS: ?*ma_vfs, file: ma_vfs_file, pSrc: ?*const anyopaque, sizeInBytes: usize, pBytesWritten: [*c]usize) callconv(.c) ma_result = null,
    onSeek: ?*const fn (pVFS: ?*ma_vfs, file: ma_vfs_file, offset: ma_int64, origin: ma_seek_origin) callconv(.c) ma_result = null,
    onTell: ?*const fn (pVFS: ?*ma_vfs, file: ma_vfs_file, pCursor: [*c]ma_int64) callconv(.c) ma_result = null,
    onInfo: ?*const fn (pVFS: ?*ma_vfs, file: ma_vfs_file, pInfo: [*c]ma_file_info) callconv(.c) ma_result = null,
};
pub extern fn ma_vfs_open(pVFS: ?*ma_vfs, pFilePath: [*c]const u8, openMode: ma_uint32, pFile: [*c]ma_vfs_file) ma_result;
pub extern fn ma_vfs_open_w(pVFS: ?*ma_vfs, pFilePath: [*c]const wchar_t, openMode: ma_uint32, pFile: [*c]ma_vfs_file) ma_result;
pub extern fn ma_vfs_close(pVFS: ?*ma_vfs, file: ma_vfs_file) ma_result;
pub extern fn ma_vfs_read(pVFS: ?*ma_vfs, file: ma_vfs_file, pDst: ?*anyopaque, sizeInBytes: usize, pBytesRead: [*c]usize) ma_result;
pub extern fn ma_vfs_write(pVFS: ?*ma_vfs, file: ma_vfs_file, pSrc: ?*const anyopaque, sizeInBytes: usize, pBytesWritten: [*c]usize) ma_result;
pub extern fn ma_vfs_seek(pVFS: ?*ma_vfs, file: ma_vfs_file, offset: ma_int64, origin: ma_seek_origin) ma_result;
pub extern fn ma_vfs_tell(pVFS: ?*ma_vfs, file: ma_vfs_file, pCursor: [*c]ma_int64) ma_result;
pub extern fn ma_vfs_info(pVFS: ?*ma_vfs, file: ma_vfs_file, pInfo: [*c]ma_file_info) ma_result;
pub extern fn ma_vfs_open_and_read_file(pVFS: ?*ma_vfs, pFilePath: [*c]const u8, ppData: [*c]?*anyopaque, pSize: [*c]usize, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ma_result;
pub const ma_default_vfs = extern struct {
    cb: ma_vfs_callbacks = @import("std").mem.zeroes(ma_vfs_callbacks),
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    pub const ma_default_vfs_init = __root.ma_default_vfs_init;
    pub const init = __root.ma_default_vfs_init;
};
pub extern fn ma_default_vfs_init(pVFS: [*c]ma_default_vfs, pAllocationCallbacks: [*c]const ma_allocation_callbacks) ma_result;
pub const ma_read_proc = ?*const fn (pUserData: ?*anyopaque, pBufferOut: ?*anyopaque, bytesToRead: usize, pBytesRead: [*c]usize) callconv(.c) ma_result;
pub const ma_seek_proc = ?*const fn (pUserData: ?*anyopaque, offset: ma_int64, origin: ma_seek_origin) callconv(.c) ma_result;
pub const ma_tell_proc = ?*const fn (pUserData: ?*anyopaque, pCursor: [*c]ma_int64) callconv(.c) ma_result;
pub const ma_stack = extern struct {
    offset: usize = 0,
    sizeInBytes: usize = 0,
    _data: [1]u8 = @import("std").mem.zeroes([1]u8),
};
pub const ma_node_graph = struct_ma_node_graph;
pub const ma_node = anyopaque;
pub const struct_ma_node_output_bus = extern struct {
    pNode: ?*ma_node = null,
    outputBusIndex: ma_uint8 = 0,
    channels: ma_uint8 = 0,
    inputNodeInputBusIndex: ma_uint8 = 0,
    flags: ma_uint32 = 0,
    refCount: ma_uint32 = 0,
    isAttached: ma_bool32 = 0,
    lock: ma_spinlock = 0,
    volume: f32 = 0,
    pNext: [*c]ma_node_output_bus = null,
    pPrev: [*c]ma_node_output_bus = null,
    pInputNode: ?*ma_node = null,
};
pub const ma_node_output_bus = struct_ma_node_output_bus;
pub const struct_ma_node_input_bus = extern struct {
    head: ma_node_output_bus = @import("std").mem.zeroes(ma_node_output_bus),
    nextCounter: ma_uint32 = 0,
    lock: ma_spinlock = 0,
    channels: ma_uint8 = 0,
};
pub const ma_node_input_bus = struct_ma_node_input_bus;
pub const struct_ma_node_base = extern struct {
    pNodeGraph: [*c]ma_node_graph = null,
    vtable: [*c]const ma_node_vtable = null,
    inputBusCount: ma_uint32 = 0,
    outputBusCount: ma_uint32 = 0,
    pInputBuses: [*c]ma_node_input_bus = null,
    pOutputBuses: [*c]ma_node_output_bus = null,
    pCachedData: [*c]f32 = null,
    cachedDataCapInFramesPerBus: ma_uint16 = 0,
    cachedFrameCountOut: ma_uint16 = 0,
    cachedFrameCountIn: ma_uint16 = 0,
    consumedFrameCountIn: ma_uint16 = 0,
    state: ma_node_state = @import("std").mem.zeroes(ma_node_state),
    stateTimes: [2]ma_uint64 = @import("std").mem.zeroes([2]ma_uint64),
    localTime: ma_uint64 = 0,
    _inputBuses: [2]ma_node_input_bus = @import("std").mem.zeroes([2]ma_node_input_bus),
    _outputBuses: [2]ma_node_output_bus = @import("std").mem.zeroes([2]ma_node_output_bus),
    _pHeap: ?*anyopaque = null,
    _ownsHeap: ma_bool32 = 0,
};
pub const ma_node_base = struct_ma_node_base;
pub const struct_ma_node_graph = extern struct {
    base: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    endpoint: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    pProcessingCache: [*c]f32 = null,
    processingCacheFramesRemaining: ma_uint32 = 0,
    processingSizeInFrames: ma_uint32 = 0,
    isReading: ma_bool32 = 0,
    pPreMixStack: [*c]ma_stack = null,
    pub const ma_node_get_heap_size = __root.ma_node_get_heap_size;
    pub const ma_node_init_preallocated = __root.ma_node_init_preallocated;
    pub const ma_node_init = __root.ma_node_init;
    pub const ma_node_graph_uninit = __root.ma_node_graph_uninit;
    pub const ma_node_graph_get_endpoint = __root.ma_node_graph_get_endpoint;
    pub const ma_node_graph_read_pcm_frames = __root.ma_node_graph_read_pcm_frames;
    pub const ma_node_graph_get_channels = __root.ma_node_graph_get_channels;
    pub const ma_node_graph_get_time = __root.ma_node_graph_get_time;
    pub const ma_node_graph_set_time = __root.ma_node_graph_set_time;
    pub const ma_node_graph_get_processing_size_in_frames = __root.ma_node_graph_get_processing_size_in_frames;
    pub const ma_data_source_node_init = __root.ma_data_source_node_init;
    pub const ma_splitter_node_init = __root.ma_splitter_node_init;
    pub const ma_biquad_node_init = __root.ma_biquad_node_init;
    pub const ma_lpf_node_init = __root.ma_lpf_node_init;
    pub const ma_hpf_node_init = __root.ma_hpf_node_init;
    pub const ma_bpf_node_init = __root.ma_bpf_node_init;
    pub const ma_notch_node_init = __root.ma_notch_node_init;
    pub const ma_peak_node_init = __root.ma_peak_node_init;
    pub const ma_loshelf_node_init = __root.ma_loshelf_node_init;
    pub const ma_hishelf_node_init = __root.ma_hishelf_node_init;
    pub const ma_delay_node_init = __root.ma_delay_node_init;
    pub const size = __root.ma_node_get_heap_size;
    pub const preallocated = __root.ma_node_init_preallocated;
    pub const init = __root.ma_node_init;
    pub const uninit = __root.ma_node_graph_uninit;
    pub const get_endpoint = __root.ma_node_graph_get_endpoint;
    pub const read_pcm_frames = __root.ma_node_graph_read_pcm_frames;
    pub const get_channels = __root.ma_node_graph_get_channels;
    pub const get_time = __root.ma_node_graph_get_time;
    pub const set_time = __root.ma_node_graph_set_time;
    pub const get_processing_size_in_frames = __root.ma_node_graph_get_processing_size_in_frames;
};
pub const MA_NODE_FLAG_PASSTHROUGH: c_int = 1;
pub const MA_NODE_FLAG_CONTINUOUS_PROCESSING: c_int = 2;
pub const MA_NODE_FLAG_ALLOW_NULL_INPUT: c_int = 4;
pub const MA_NODE_FLAG_DIFFERENT_PROCESSING_RATES: c_int = 8;
pub const MA_NODE_FLAG_SILENT_OUTPUT: c_int = 16;
pub const ma_node_flags = c_uint;
pub const ma_node_state_started: c_int = 0;
pub const ma_node_state_stopped: c_int = 1;
pub const ma_node_state = c_uint;
pub const ma_node_vtable = extern struct {
    onProcess: ?*const fn (pNode: ?*ma_node, ppFramesIn: [*c][*c]const f32, pFrameCountIn: [*c]ma_uint32, ppFramesOut: [*c][*c]f32, pFrameCountOut: [*c]ma_uint32) callconv(.c) void = null,
    onGetRequiredInputFrameCount: ?*const fn (pNode: ?*ma_node, outputFrameCount: ma_uint32, pInputFrameCount: [*c]ma_uint32) callconv(.c) ma_result = null,
    inputBusCount: ma_uint8 = 0,
    outputBusCount: ma_uint8 = 0,
    flags: ma_uint32 = 0,
};
pub const ma_node_config = extern struct {
    vtable: [*c]const ma_node_vtable = null,
    initialState: ma_node_state = @import("std").mem.zeroes(ma_node_state),
    inputBusCount: ma_uint32 = 0,
    outputBusCount: ma_uint32 = 0,
    pInputChannels: [*c]const ma_uint32 = null,
    pOutputChannels: [*c]const ma_uint32 = null,
};
pub extern fn ma_node_config_init() ma_node_config;
pub extern fn ma_node_get_heap_size(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_node_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_node_init_preallocated(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_node_config, pHeap: ?*anyopaque, pNode: ?*ma_node) ma_result;
pub extern fn ma_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: ?*ma_node) ma_result;
pub extern fn ma_node_uninit(pNode: ?*ma_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_node_get_node_graph(pNode: ?*const ma_node) [*c]ma_node_graph;
pub extern fn ma_node_get_input_bus_count(pNode: ?*const ma_node) ma_uint32;
pub extern fn ma_node_get_output_bus_count(pNode: ?*const ma_node) ma_uint32;
pub extern fn ma_node_get_input_channels(pNode: ?*const ma_node, inputBusIndex: ma_uint32) ma_uint32;
pub extern fn ma_node_get_output_channels(pNode: ?*const ma_node, outputBusIndex: ma_uint32) ma_uint32;
pub extern fn ma_node_attach_output_bus(pNode: ?*ma_node, outputBusIndex: ma_uint32, pOtherNode: ?*ma_node, otherNodeInputBusIndex: ma_uint32) ma_result;
pub extern fn ma_node_detach_output_bus(pNode: ?*ma_node, outputBusIndex: ma_uint32) ma_result;
pub extern fn ma_node_detach_all_output_buses(pNode: ?*ma_node) ma_result;
pub extern fn ma_node_set_output_bus_volume(pNode: ?*ma_node, outputBusIndex: ma_uint32, volume: f32) ma_result;
pub extern fn ma_node_get_output_bus_volume(pNode: ?*const ma_node, outputBusIndex: ma_uint32) f32;
pub extern fn ma_node_set_state(pNode: ?*ma_node, state: ma_node_state) ma_result;
pub extern fn ma_node_get_state(pNode: ?*const ma_node) ma_node_state;
pub extern fn ma_node_set_state_time(pNode: ?*ma_node, state: ma_node_state, globalTime: ma_uint64) ma_result;
pub extern fn ma_node_get_state_time(pNode: ?*const ma_node, state: ma_node_state) ma_uint64;
pub extern fn ma_node_get_state_by_time(pNode: ?*const ma_node, globalTime: ma_uint64) ma_node_state;
pub extern fn ma_node_get_state_by_time_range(pNode: ?*const ma_node, globalTimeBeg: ma_uint64, globalTimeEnd: ma_uint64) ma_node_state;
pub extern fn ma_node_get_time(pNode: ?*const ma_node) ma_uint64;
pub extern fn ma_node_set_time(pNode: ?*ma_node, localTime: ma_uint64) ma_result;
pub const ma_node_graph_config = extern struct {
    channels: ma_uint32 = 0,
    processingSizeInFrames: ma_uint32 = 0,
    preMixStackSizeInBytes: usize = 0,
    pub const ma_node_graph_init = __root.ma_node_graph_init;
    pub const init = __root.ma_node_graph_init;
};
pub extern fn ma_node_graph_config_init(channels: ma_uint32) ma_node_graph_config;
pub extern fn ma_node_graph_init(pConfig: [*c]const ma_node_graph_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNodeGraph: [*c]ma_node_graph) ma_result;
pub extern fn ma_node_graph_uninit(pNodeGraph: [*c]ma_node_graph, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_node_graph_get_endpoint(pNodeGraph: [*c]ma_node_graph) ?*ma_node;
pub extern fn ma_node_graph_read_pcm_frames(pNodeGraph: [*c]ma_node_graph, pFramesOut: ?*anyopaque, frameCount: ma_uint64, pFramesRead: [*c]ma_uint64) ma_result;
pub extern fn ma_node_graph_get_channels(pNodeGraph: [*c]const ma_node_graph) ma_uint32;
pub extern fn ma_node_graph_get_time(pNodeGraph: [*c]const ma_node_graph) ma_uint64;
pub extern fn ma_node_graph_set_time(pNodeGraph: [*c]ma_node_graph, globalTime: ma_uint64) ma_result;
pub extern fn ma_node_graph_get_processing_size_in_frames(pNodeGraph: [*c]const ma_node_graph) ma_uint32;
pub const ma_data_source_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    pDataSource: ?*ma_data_source = null,
};
pub extern fn ma_data_source_node_config_init(pDataSource: ?*ma_data_source) ma_data_source_node_config;
pub const ma_data_source_node = extern struct {
    base: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    pDataSource: ?*ma_data_source = null,
    pub const ma_data_source_node_uninit = __root.ma_data_source_node_uninit;
    pub const ma_data_source_node_set_looping = __root.ma_data_source_node_set_looping;
    pub const ma_data_source_node_is_looping = __root.ma_data_source_node_is_looping;
    pub const uninit = __root.ma_data_source_node_uninit;
    pub const set_looping = __root.ma_data_source_node_set_looping;
    pub const is_looping = __root.ma_data_source_node_is_looping;
};
pub extern fn ma_data_source_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_data_source_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pDataSourceNode: [*c]ma_data_source_node) ma_result;
pub extern fn ma_data_source_node_uninit(pDataSourceNode: [*c]ma_data_source_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_data_source_node_set_looping(pDataSourceNode: [*c]ma_data_source_node, isLooping: ma_bool32) ma_result;
pub extern fn ma_data_source_node_is_looping(pDataSourceNode: [*c]ma_data_source_node) ma_bool32;
pub const ma_splitter_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    channels: ma_uint32 = 0,
    outputBusCount: ma_uint32 = 0,
};
pub extern fn ma_splitter_node_config_init(channels: ma_uint32) ma_splitter_node_config;
pub const ma_splitter_node = extern struct {
    base: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    pub const ma_splitter_node_uninit = __root.ma_splitter_node_uninit;
    pub const uninit = __root.ma_splitter_node_uninit;
};
pub extern fn ma_splitter_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_splitter_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pSplitterNode: [*c]ma_splitter_node) ma_result;
pub extern fn ma_splitter_node_uninit(pSplitterNode: [*c]ma_splitter_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_biquad_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    biquad: ma_biquad_config = @import("std").mem.zeroes(ma_biquad_config),
};
pub extern fn ma_biquad_node_config_init(channels: ma_uint32, b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) ma_biquad_node_config;
pub const ma_biquad_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    biquad: ma_biquad = @import("std").mem.zeroes(ma_biquad),
    pub const ma_biquad_node_uninit = __root.ma_biquad_node_uninit;
    pub const uninit = __root.ma_biquad_node_uninit;
};
pub extern fn ma_biquad_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_biquad_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_biquad_node) ma_result;
pub extern fn ma_biquad_node_reinit(pConfig: [*c]const ma_biquad_config, pNode: [*c]ma_biquad_node) ma_result;
pub extern fn ma_biquad_node_uninit(pNode: [*c]ma_biquad_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_lpf_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    lpf: ma_lpf_config = @import("std").mem.zeroes(ma_lpf_config),
};
pub extern fn ma_lpf_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, order: ma_uint32) ma_lpf_node_config;
pub const ma_lpf_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    lpf: ma_lpf = @import("std").mem.zeroes(ma_lpf),
    pub const ma_lpf_node_uninit = __root.ma_lpf_node_uninit;
    pub const uninit = __root.ma_lpf_node_uninit;
};
pub extern fn ma_lpf_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_lpf_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_lpf_node) ma_result;
pub extern fn ma_lpf_node_reinit(pConfig: [*c]const ma_lpf_config, pNode: [*c]ma_lpf_node) ma_result;
pub extern fn ma_lpf_node_uninit(pNode: [*c]ma_lpf_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_hpf_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    hpf: ma_hpf_config = @import("std").mem.zeroes(ma_hpf_config),
};
pub extern fn ma_hpf_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, order: ma_uint32) ma_hpf_node_config;
pub const ma_hpf_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    hpf: ma_hpf = @import("std").mem.zeroes(ma_hpf),
    pub const ma_hpf_node_uninit = __root.ma_hpf_node_uninit;
    pub const uninit = __root.ma_hpf_node_uninit;
};
pub extern fn ma_hpf_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_hpf_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_hpf_node) ma_result;
pub extern fn ma_hpf_node_reinit(pConfig: [*c]const ma_hpf_config, pNode: [*c]ma_hpf_node) ma_result;
pub extern fn ma_hpf_node_uninit(pNode: [*c]ma_hpf_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_bpf_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    bpf: ma_bpf_config = @import("std").mem.zeroes(ma_bpf_config),
};
pub extern fn ma_bpf_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, cutoffFrequency: f64, order: ma_uint32) ma_bpf_node_config;
pub const ma_bpf_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    bpf: ma_bpf = @import("std").mem.zeroes(ma_bpf),
    pub const ma_bpf_node_uninit = __root.ma_bpf_node_uninit;
    pub const uninit = __root.ma_bpf_node_uninit;
};
pub extern fn ma_bpf_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_bpf_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_bpf_node) ma_result;
pub extern fn ma_bpf_node_reinit(pConfig: [*c]const ma_bpf_config, pNode: [*c]ma_bpf_node) ma_result;
pub extern fn ma_bpf_node_uninit(pNode: [*c]ma_bpf_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_notch_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    notch: ma_notch_config = @import("std").mem.zeroes(ma_notch_config),
};
pub extern fn ma_notch_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, q: f64, frequency: f64) ma_notch_node_config;
pub const ma_notch_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    notch: ma_notch2 = @import("std").mem.zeroes(ma_notch2),
    pub const ma_notch_node_uninit = __root.ma_notch_node_uninit;
    pub const uninit = __root.ma_notch_node_uninit;
};
pub extern fn ma_notch_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_notch_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_notch_node) ma_result;
pub extern fn ma_notch_node_reinit(pConfig: [*c]const ma_notch_config, pNode: [*c]ma_notch_node) ma_result;
pub extern fn ma_notch_node_uninit(pNode: [*c]ma_notch_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_peak_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    peak: ma_peak_config = @import("std").mem.zeroes(ma_peak_config),
};
pub extern fn ma_peak_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, gainDB: f64, q: f64, frequency: f64) ma_peak_node_config;
pub const ma_peak_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    peak: ma_peak2 = @import("std").mem.zeroes(ma_peak2),
    pub const ma_peak_node_uninit = __root.ma_peak_node_uninit;
    pub const uninit = __root.ma_peak_node_uninit;
};
pub extern fn ma_peak_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_peak_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_peak_node) ma_result;
pub extern fn ma_peak_node_reinit(pConfig: [*c]const ma_peak_config, pNode: [*c]ma_peak_node) ma_result;
pub extern fn ma_peak_node_uninit(pNode: [*c]ma_peak_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_loshelf_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    loshelf: ma_loshelf_config = @import("std").mem.zeroes(ma_loshelf_config),
};
pub extern fn ma_loshelf_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, gainDB: f64, q: f64, frequency: f64) ma_loshelf_node_config;
pub const ma_loshelf_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    loshelf: ma_loshelf2 = @import("std").mem.zeroes(ma_loshelf2),
    pub const ma_loshelf_node_uninit = __root.ma_loshelf_node_uninit;
    pub const uninit = __root.ma_loshelf_node_uninit;
};
pub extern fn ma_loshelf_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_loshelf_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_loshelf_node) ma_result;
pub extern fn ma_loshelf_node_reinit(pConfig: [*c]const ma_loshelf_config, pNode: [*c]ma_loshelf_node) ma_result;
pub extern fn ma_loshelf_node_uninit(pNode: [*c]ma_loshelf_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_hishelf_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    hishelf: ma_hishelf_config = @import("std").mem.zeroes(ma_hishelf_config),
};
pub extern fn ma_hishelf_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, gainDB: f64, q: f64, frequency: f64) ma_hishelf_node_config;
pub const ma_hishelf_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    hishelf: ma_hishelf2 = @import("std").mem.zeroes(ma_hishelf2),
    pub const ma_hishelf_node_uninit = __root.ma_hishelf_node_uninit;
    pub const uninit = __root.ma_hishelf_node_uninit;
};
pub extern fn ma_hishelf_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_hishelf_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pNode: [*c]ma_hishelf_node) ma_result;
pub extern fn ma_hishelf_node_reinit(pConfig: [*c]const ma_hishelf_config, pNode: [*c]ma_hishelf_node) ma_result;
pub extern fn ma_hishelf_node_uninit(pNode: [*c]ma_hishelf_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_delay_node_config = extern struct {
    nodeConfig: ma_node_config = @import("std").mem.zeroes(ma_node_config),
    delay: ma_delay_config = @import("std").mem.zeroes(ma_delay_config),
};
pub extern fn ma_delay_node_config_init(channels: ma_uint32, sampleRate: ma_uint32, delayInFrames: ma_uint32, decay: f32) ma_delay_node_config;
pub const ma_delay_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    delay: ma_delay = @import("std").mem.zeroes(ma_delay),
    pub const ma_delay_node_uninit = __root.ma_delay_node_uninit;
    pub const ma_delay_node_set_wet = __root.ma_delay_node_set_wet;
    pub const ma_delay_node_get_wet = __root.ma_delay_node_get_wet;
    pub const ma_delay_node_set_dry = __root.ma_delay_node_set_dry;
    pub const ma_delay_node_get_dry = __root.ma_delay_node_get_dry;
    pub const ma_delay_node_set_decay = __root.ma_delay_node_set_decay;
    pub const ma_delay_node_get_decay = __root.ma_delay_node_get_decay;
    pub const uninit = __root.ma_delay_node_uninit;
    pub const set_wet = __root.ma_delay_node_set_wet;
    pub const get_wet = __root.ma_delay_node_get_wet;
    pub const set_dry = __root.ma_delay_node_set_dry;
    pub const get_dry = __root.ma_delay_node_get_dry;
    pub const set_decay = __root.ma_delay_node_set_decay;
    pub const get_decay = __root.ma_delay_node_get_decay;
};
pub extern fn ma_delay_node_init(pNodeGraph: [*c]ma_node_graph, pConfig: [*c]const ma_delay_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pDelayNode: [*c]ma_delay_node) ma_result;
pub extern fn ma_delay_node_uninit(pDelayNode: [*c]ma_delay_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub extern fn ma_delay_node_set_wet(pDelayNode: [*c]ma_delay_node, value: f32) void;
pub extern fn ma_delay_node_get_wet(pDelayNode: [*c]const ma_delay_node) f32;
pub extern fn ma_delay_node_set_dry(pDelayNode: [*c]ma_delay_node, value: f32) void;
pub extern fn ma_delay_node_get_dry(pDelayNode: [*c]const ma_delay_node) f32;
pub extern fn ma_delay_node_set_decay(pDelayNode: [*c]ma_delay_node, value: f32) void;
pub extern fn ma_delay_node_get_decay(pDelayNode: [*c]const ma_delay_node) f32;
pub const ma_sound_end_proc = ?*const fn (pUserData: ?*anyopaque, pSound: [*c]ma_sound) callconv(.c) void;
pub const struct_ma_sound = extern struct {
    engineNode: ma_engine_node = @import("std").mem.zeroes(ma_engine_node),
    pDataSource: ?*ma_data_source = null,
    seekTarget: ma_uint64 = 0,
    atEnd: ma_bool32 = 0,
    endCallback: ma_sound_end_proc = null,
    pEndCallbackUserData: ?*anyopaque = null,
    pProcessingCache: [*c]f32 = null,
    processingCacheFramesRemaining: ma_uint32 = 0,
    processingCacheCap: ma_uint32 = 0,
    ownsDataSource: ma_bool8 = 0,
    pub const ma_sound_uninit = __root.ma_sound_uninit;
    pub const ma_sound_get_engine = __root.ma_sound_get_engine;
    pub const ma_sound_get_data_source = __root.ma_sound_get_data_source;
    pub const ma_sound_start = __root.ma_sound_start;
    pub const ma_sound_stop = __root.ma_sound_stop;
    pub const ma_sound_stop_with_fade_in_pcm_frames = __root.ma_sound_stop_with_fade_in_pcm_frames;
    pub const ma_sound_stop_with_fade_in_milliseconds = __root.ma_sound_stop_with_fade_in_milliseconds;
    pub const ma_sound_reset_start_time = __root.ma_sound_reset_start_time;
    pub const ma_sound_reset_stop_time = __root.ma_sound_reset_stop_time;
    pub const ma_sound_reset_fade = __root.ma_sound_reset_fade;
    pub const ma_sound_reset_stop_time_and_fade = __root.ma_sound_reset_stop_time_and_fade;
    pub const ma_sound_set_volume = __root.ma_sound_set_volume;
    pub const ma_sound_get_volume = __root.ma_sound_get_volume;
    pub const ma_sound_set_pan = __root.ma_sound_set_pan;
    pub const ma_sound_get_pan = __root.ma_sound_get_pan;
    pub const ma_sound_set_pan_mode = __root.ma_sound_set_pan_mode;
    pub const ma_sound_get_pan_mode = __root.ma_sound_get_pan_mode;
    pub const ma_sound_set_pitch = __root.ma_sound_set_pitch;
    pub const ma_sound_get_pitch = __root.ma_sound_get_pitch;
    pub const ma_sound_set_spatialization_enabled = __root.ma_sound_set_spatialization_enabled;
    pub const ma_sound_is_spatialization_enabled = __root.ma_sound_is_spatialization_enabled;
    pub const ma_sound_set_pinned_listener_index = __root.ma_sound_set_pinned_listener_index;
    pub const ma_sound_get_pinned_listener_index = __root.ma_sound_get_pinned_listener_index;
    pub const ma_sound_get_listener_index = __root.ma_sound_get_listener_index;
    pub const ma_sound_get_direction_to_listener = __root.ma_sound_get_direction_to_listener;
    pub const ma_sound_set_position = __root.ma_sound_set_position;
    pub const ma_sound_get_position = __root.ma_sound_get_position;
    pub const ma_sound_set_direction = __root.ma_sound_set_direction;
    pub const ma_sound_get_direction = __root.ma_sound_get_direction;
    pub const ma_sound_set_velocity = __root.ma_sound_set_velocity;
    pub const ma_sound_get_velocity = __root.ma_sound_get_velocity;
    pub const ma_sound_set_attenuation_model = __root.ma_sound_set_attenuation_model;
    pub const ma_sound_get_attenuation_model = __root.ma_sound_get_attenuation_model;
    pub const ma_sound_set_positioning = __root.ma_sound_set_positioning;
    pub const ma_sound_get_positioning = __root.ma_sound_get_positioning;
    pub const ma_sound_set_rolloff = __root.ma_sound_set_rolloff;
    pub const ma_sound_get_rolloff = __root.ma_sound_get_rolloff;
    pub const ma_sound_set_min_gain = __root.ma_sound_set_min_gain;
    pub const ma_sound_get_min_gain = __root.ma_sound_get_min_gain;
    pub const ma_sound_set_max_gain = __root.ma_sound_set_max_gain;
    pub const ma_sound_get_max_gain = __root.ma_sound_get_max_gain;
    pub const ma_sound_set_min_distance = __root.ma_sound_set_min_distance;
    pub const ma_sound_get_min_distance = __root.ma_sound_get_min_distance;
    pub const ma_sound_set_max_distance = __root.ma_sound_set_max_distance;
    pub const ma_sound_get_max_distance = __root.ma_sound_get_max_distance;
    pub const ma_sound_set_cone = __root.ma_sound_set_cone;
    pub const ma_sound_get_cone = __root.ma_sound_get_cone;
    pub const ma_sound_set_doppler_factor = __root.ma_sound_set_doppler_factor;
    pub const ma_sound_get_doppler_factor = __root.ma_sound_get_doppler_factor;
    pub const ma_sound_set_directional_attenuation_factor = __root.ma_sound_set_directional_attenuation_factor;
    pub const ma_sound_get_directional_attenuation_factor = __root.ma_sound_get_directional_attenuation_factor;
    pub const ma_sound_set_fade_in_pcm_frames = __root.ma_sound_set_fade_in_pcm_frames;
    pub const ma_sound_set_fade_in_milliseconds = __root.ma_sound_set_fade_in_milliseconds;
    pub const ma_sound_set_fade_start_in_pcm_frames = __root.ma_sound_set_fade_start_in_pcm_frames;
    pub const ma_sound_set_fade_start_in_milliseconds = __root.ma_sound_set_fade_start_in_milliseconds;
    pub const ma_sound_get_current_fade_volume = __root.ma_sound_get_current_fade_volume;
    pub const ma_sound_set_start_time_in_pcm_frames = __root.ma_sound_set_start_time_in_pcm_frames;
    pub const ma_sound_set_start_time_in_milliseconds = __root.ma_sound_set_start_time_in_milliseconds;
    pub const ma_sound_set_stop_time_in_pcm_frames = __root.ma_sound_set_stop_time_in_pcm_frames;
    pub const ma_sound_set_stop_time_in_milliseconds = __root.ma_sound_set_stop_time_in_milliseconds;
    pub const ma_sound_set_stop_time_with_fade_in_pcm_frames = __root.ma_sound_set_stop_time_with_fade_in_pcm_frames;
    pub const ma_sound_set_stop_time_with_fade_in_milliseconds = __root.ma_sound_set_stop_time_with_fade_in_milliseconds;
    pub const ma_sound_is_playing = __root.ma_sound_is_playing;
    pub const ma_sound_get_time_in_pcm_frames = __root.ma_sound_get_time_in_pcm_frames;
    pub const ma_sound_get_time_in_milliseconds = __root.ma_sound_get_time_in_milliseconds;
    pub const ma_sound_set_looping = __root.ma_sound_set_looping;
    pub const ma_sound_is_looping = __root.ma_sound_is_looping;
    pub const ma_sound_at_end = __root.ma_sound_at_end;
    pub const ma_sound_seek_to_pcm_frame = __root.ma_sound_seek_to_pcm_frame;
    pub const ma_sound_seek_to_second = __root.ma_sound_seek_to_second;
    pub const ma_sound_get_data_format = __root.ma_sound_get_data_format;
    pub const ma_sound_get_cursor_in_pcm_frames = __root.ma_sound_get_cursor_in_pcm_frames;
    pub const ma_sound_get_length_in_pcm_frames = __root.ma_sound_get_length_in_pcm_frames;
    pub const ma_sound_get_cursor_in_seconds = __root.ma_sound_get_cursor_in_seconds;
    pub const ma_sound_get_length_in_seconds = __root.ma_sound_get_length_in_seconds;
    pub const ma_sound_set_end_callback = __root.ma_sound_set_end_callback;
    pub const ma_sound_group_uninit = __root.ma_sound_group_uninit;
    pub const ma_sound_group_get_engine = __root.ma_sound_group_get_engine;
    pub const ma_sound_group_start = __root.ma_sound_group_start;
    pub const ma_sound_group_stop = __root.ma_sound_group_stop;
    pub const ma_sound_group_set_volume = __root.ma_sound_group_set_volume;
    pub const ma_sound_group_get_volume = __root.ma_sound_group_get_volume;
    pub const ma_sound_group_set_pan = __root.ma_sound_group_set_pan;
    pub const ma_sound_group_get_pan = __root.ma_sound_group_get_pan;
    pub const ma_sound_group_set_pan_mode = __root.ma_sound_group_set_pan_mode;
    pub const ma_sound_group_get_pan_mode = __root.ma_sound_group_get_pan_mode;
    pub const ma_sound_group_set_pitch = __root.ma_sound_group_set_pitch;
    pub const ma_sound_group_get_pitch = __root.ma_sound_group_get_pitch;
    pub const ma_sound_group_set_spatialization_enabled = __root.ma_sound_group_set_spatialization_enabled;
    pub const ma_sound_group_is_spatialization_enabled = __root.ma_sound_group_is_spatialization_enabled;
    pub const ma_sound_group_set_pinned_listener_index = __root.ma_sound_group_set_pinned_listener_index;
    pub const ma_sound_group_get_pinned_listener_index = __root.ma_sound_group_get_pinned_listener_index;
    pub const ma_sound_group_get_listener_index = __root.ma_sound_group_get_listener_index;
    pub const ma_sound_group_get_direction_to_listener = __root.ma_sound_group_get_direction_to_listener;
    pub const ma_sound_group_set_position = __root.ma_sound_group_set_position;
    pub const ma_sound_group_get_position = __root.ma_sound_group_get_position;
    pub const ma_sound_group_set_direction = __root.ma_sound_group_set_direction;
    pub const ma_sound_group_get_direction = __root.ma_sound_group_get_direction;
    pub const ma_sound_group_set_velocity = __root.ma_sound_group_set_velocity;
    pub const ma_sound_group_get_velocity = __root.ma_sound_group_get_velocity;
    pub const ma_sound_group_set_attenuation_model = __root.ma_sound_group_set_attenuation_model;
    pub const ma_sound_group_get_attenuation_model = __root.ma_sound_group_get_attenuation_model;
    pub const ma_sound_group_set_positioning = __root.ma_sound_group_set_positioning;
    pub const ma_sound_group_get_positioning = __root.ma_sound_group_get_positioning;
    pub const ma_sound_group_set_rolloff = __root.ma_sound_group_set_rolloff;
    pub const ma_sound_group_get_rolloff = __root.ma_sound_group_get_rolloff;
    pub const ma_sound_group_set_min_gain = __root.ma_sound_group_set_min_gain;
    pub const ma_sound_group_get_min_gain = __root.ma_sound_group_get_min_gain;
    pub const ma_sound_group_set_max_gain = __root.ma_sound_group_set_max_gain;
    pub const ma_sound_group_get_max_gain = __root.ma_sound_group_get_max_gain;
    pub const ma_sound_group_set_min_distance = __root.ma_sound_group_set_min_distance;
    pub const ma_sound_group_get_min_distance = __root.ma_sound_group_get_min_distance;
    pub const ma_sound_group_set_max_distance = __root.ma_sound_group_set_max_distance;
    pub const ma_sound_group_get_max_distance = __root.ma_sound_group_get_max_distance;
    pub const ma_sound_group_set_cone = __root.ma_sound_group_set_cone;
    pub const ma_sound_group_get_cone = __root.ma_sound_group_get_cone;
    pub const ma_sound_group_set_doppler_factor = __root.ma_sound_group_set_doppler_factor;
    pub const ma_sound_group_get_doppler_factor = __root.ma_sound_group_get_doppler_factor;
    pub const ma_sound_group_set_directional_attenuation_factor = __root.ma_sound_group_set_directional_attenuation_factor;
    pub const ma_sound_group_get_directional_attenuation_factor = __root.ma_sound_group_get_directional_attenuation_factor;
    pub const ma_sound_group_set_fade_in_pcm_frames = __root.ma_sound_group_set_fade_in_pcm_frames;
    pub const ma_sound_group_set_fade_in_milliseconds = __root.ma_sound_group_set_fade_in_milliseconds;
    pub const ma_sound_group_get_current_fade_volume = __root.ma_sound_group_get_current_fade_volume;
    pub const ma_sound_group_set_start_time_in_pcm_frames = __root.ma_sound_group_set_start_time_in_pcm_frames;
    pub const ma_sound_group_set_start_time_in_milliseconds = __root.ma_sound_group_set_start_time_in_milliseconds;
    pub const ma_sound_group_set_stop_time_in_pcm_frames = __root.ma_sound_group_set_stop_time_in_pcm_frames;
    pub const ma_sound_group_set_stop_time_in_milliseconds = __root.ma_sound_group_set_stop_time_in_milliseconds;
    pub const ma_sound_group_is_playing = __root.ma_sound_group_is_playing;
    pub const ma_sound_group_get_time_in_pcm_frames = __root.ma_sound_group_get_time_in_pcm_frames;
    pub const uninit = __root.ma_sound_uninit;
    pub const get_engine = __root.ma_sound_get_engine;
    pub const get_data_source = __root.ma_sound_get_data_source;
    pub const start = __root.ma_sound_start;
    pub const stop = __root.ma_sound_stop;
    pub const stop_with_fade_in_pcm_frames = __root.ma_sound_stop_with_fade_in_pcm_frames;
    pub const stop_with_fade_in_milliseconds = __root.ma_sound_stop_with_fade_in_milliseconds;
    pub const reset_start_time = __root.ma_sound_reset_start_time;
    pub const reset_stop_time = __root.ma_sound_reset_stop_time;
    pub const reset_fade = __root.ma_sound_reset_fade;
    pub const reset_stop_time_and_fade = __root.ma_sound_reset_stop_time_and_fade;
    pub const set_volume = __root.ma_sound_set_volume;
    pub const get_volume = __root.ma_sound_get_volume;
    pub const set_pan = __root.ma_sound_set_pan;
    pub const get_pan = __root.ma_sound_get_pan;
    pub const set_pan_mode = __root.ma_sound_set_pan_mode;
    pub const get_pan_mode = __root.ma_sound_get_pan_mode;
    pub const set_pitch = __root.ma_sound_set_pitch;
    pub const get_pitch = __root.ma_sound_get_pitch;
    pub const set_spatialization_enabled = __root.ma_sound_set_spatialization_enabled;
    pub const is_spatialization_enabled = __root.ma_sound_is_spatialization_enabled;
    pub const set_pinned_listener_index = __root.ma_sound_set_pinned_listener_index;
    pub const get_pinned_listener_index = __root.ma_sound_get_pinned_listener_index;
    pub const get_listener_index = __root.ma_sound_get_listener_index;
    pub const get_direction_to_listener = __root.ma_sound_get_direction_to_listener;
    pub const set_position = __root.ma_sound_set_position;
    pub const get_position = __root.ma_sound_get_position;
    pub const set_direction = __root.ma_sound_set_direction;
    pub const get_direction = __root.ma_sound_get_direction;
    pub const set_velocity = __root.ma_sound_set_velocity;
    pub const get_velocity = __root.ma_sound_get_velocity;
    pub const set_attenuation_model = __root.ma_sound_set_attenuation_model;
    pub const get_attenuation_model = __root.ma_sound_get_attenuation_model;
    pub const set_positioning = __root.ma_sound_set_positioning;
    pub const get_positioning = __root.ma_sound_get_positioning;
    pub const set_rolloff = __root.ma_sound_set_rolloff;
    pub const get_rolloff = __root.ma_sound_get_rolloff;
    pub const set_min_gain = __root.ma_sound_set_min_gain;
    pub const get_min_gain = __root.ma_sound_get_min_gain;
    pub const set_max_gain = __root.ma_sound_set_max_gain;
    pub const get_max_gain = __root.ma_sound_get_max_gain;
    pub const set_min_distance = __root.ma_sound_set_min_distance;
    pub const get_min_distance = __root.ma_sound_get_min_distance;
    pub const set_max_distance = __root.ma_sound_set_max_distance;
    pub const get_max_distance = __root.ma_sound_get_max_distance;
    pub const set_cone = __root.ma_sound_set_cone;
    pub const get_cone = __root.ma_sound_get_cone;
    pub const set_doppler_factor = __root.ma_sound_set_doppler_factor;
    pub const get_doppler_factor = __root.ma_sound_get_doppler_factor;
    pub const set_directional_attenuation_factor = __root.ma_sound_set_directional_attenuation_factor;
    pub const get_directional_attenuation_factor = __root.ma_sound_get_directional_attenuation_factor;
    pub const set_fade_in_pcm_frames = __root.ma_sound_set_fade_in_pcm_frames;
    pub const set_fade_in_milliseconds = __root.ma_sound_set_fade_in_milliseconds;
    pub const set_fade_start_in_pcm_frames = __root.ma_sound_set_fade_start_in_pcm_frames;
    pub const set_fade_start_in_milliseconds = __root.ma_sound_set_fade_start_in_milliseconds;
    pub const get_current_fade_volume = __root.ma_sound_get_current_fade_volume;
    pub const set_start_time_in_pcm_frames = __root.ma_sound_set_start_time_in_pcm_frames;
    pub const set_start_time_in_milliseconds = __root.ma_sound_set_start_time_in_milliseconds;
    pub const set_stop_time_in_pcm_frames = __root.ma_sound_set_stop_time_in_pcm_frames;
    pub const set_stop_time_in_milliseconds = __root.ma_sound_set_stop_time_in_milliseconds;
    pub const set_stop_time_with_fade_in_pcm_frames = __root.ma_sound_set_stop_time_with_fade_in_pcm_frames;
    pub const set_stop_time_with_fade_in_milliseconds = __root.ma_sound_set_stop_time_with_fade_in_milliseconds;
    pub const is_playing = __root.ma_sound_is_playing;
    pub const get_time_in_pcm_frames = __root.ma_sound_get_time_in_pcm_frames;
    pub const get_time_in_milliseconds = __root.ma_sound_get_time_in_milliseconds;
    pub const set_looping = __root.ma_sound_set_looping;
    pub const is_looping = __root.ma_sound_is_looping;
    pub const at_end = __root.ma_sound_at_end;
    pub const seek_to_pcm_frame = __root.ma_sound_seek_to_pcm_frame;
    pub const seek_to_second = __root.ma_sound_seek_to_second;
    pub const get_data_format = __root.ma_sound_get_data_format;
    pub const get_cursor_in_pcm_frames = __root.ma_sound_get_cursor_in_pcm_frames;
    pub const get_length_in_pcm_frames = __root.ma_sound_get_length_in_pcm_frames;
    pub const get_cursor_in_seconds = __root.ma_sound_get_cursor_in_seconds;
    pub const get_length_in_seconds = __root.ma_sound_get_length_in_seconds;
    pub const set_end_callback = __root.ma_sound_set_end_callback;
    pub const group_uninit = __root.ma_sound_group_uninit;
    pub const group_get_engine = __root.ma_sound_group_get_engine;
    pub const group_start = __root.ma_sound_group_start;
    pub const group_stop = __root.ma_sound_group_stop;
    pub const group_set_volume = __root.ma_sound_group_set_volume;
    pub const group_get_volume = __root.ma_sound_group_get_volume;
    pub const group_set_pan = __root.ma_sound_group_set_pan;
    pub const group_get_pan = __root.ma_sound_group_get_pan;
    pub const group_set_pan_mode = __root.ma_sound_group_set_pan_mode;
    pub const group_get_pan_mode = __root.ma_sound_group_get_pan_mode;
    pub const group_set_pitch = __root.ma_sound_group_set_pitch;
    pub const group_get_pitch = __root.ma_sound_group_get_pitch;
    pub const group_set_spatialization_enabled = __root.ma_sound_group_set_spatialization_enabled;
    pub const group_is_spatialization_enabled = __root.ma_sound_group_is_spatialization_enabled;
    pub const group_set_pinned_listener_index = __root.ma_sound_group_set_pinned_listener_index;
    pub const group_get_pinned_listener_index = __root.ma_sound_group_get_pinned_listener_index;
    pub const group_get_listener_index = __root.ma_sound_group_get_listener_index;
    pub const group_get_direction_to_listener = __root.ma_sound_group_get_direction_to_listener;
    pub const group_set_position = __root.ma_sound_group_set_position;
    pub const group_get_position = __root.ma_sound_group_get_position;
    pub const group_set_direction = __root.ma_sound_group_set_direction;
    pub const group_get_direction = __root.ma_sound_group_get_direction;
    pub const group_set_velocity = __root.ma_sound_group_set_velocity;
    pub const group_get_velocity = __root.ma_sound_group_get_velocity;
    pub const group_set_attenuation_model = __root.ma_sound_group_set_attenuation_model;
    pub const group_get_attenuation_model = __root.ma_sound_group_get_attenuation_model;
    pub const group_set_positioning = __root.ma_sound_group_set_positioning;
    pub const group_get_positioning = __root.ma_sound_group_get_positioning;
    pub const group_set_rolloff = __root.ma_sound_group_set_rolloff;
    pub const group_get_rolloff = __root.ma_sound_group_get_rolloff;
    pub const group_set_min_gain = __root.ma_sound_group_set_min_gain;
    pub const group_get_min_gain = __root.ma_sound_group_get_min_gain;
    pub const group_set_max_gain = __root.ma_sound_group_set_max_gain;
    pub const group_get_max_gain = __root.ma_sound_group_get_max_gain;
    pub const group_set_min_distance = __root.ma_sound_group_set_min_distance;
    pub const group_get_min_distance = __root.ma_sound_group_get_min_distance;
    pub const group_set_max_distance = __root.ma_sound_group_set_max_distance;
    pub const group_get_max_distance = __root.ma_sound_group_get_max_distance;
    pub const group_set_cone = __root.ma_sound_group_set_cone;
    pub const group_get_cone = __root.ma_sound_group_get_cone;
    pub const group_set_doppler_factor = __root.ma_sound_group_set_doppler_factor;
    pub const group_get_doppler_factor = __root.ma_sound_group_get_doppler_factor;
    pub const group_set_directional_attenuation_factor = __root.ma_sound_group_set_directional_attenuation_factor;
    pub const group_get_directional_attenuation_factor = __root.ma_sound_group_get_directional_attenuation_factor;
    pub const group_set_fade_in_pcm_frames = __root.ma_sound_group_set_fade_in_pcm_frames;
    pub const group_set_fade_in_milliseconds = __root.ma_sound_group_set_fade_in_milliseconds;
    pub const group_get_current_fade_volume = __root.ma_sound_group_get_current_fade_volume;
    pub const group_set_start_time_in_pcm_frames = __root.ma_sound_group_set_start_time_in_pcm_frames;
    pub const group_set_start_time_in_milliseconds = __root.ma_sound_group_set_start_time_in_milliseconds;
    pub const group_set_stop_time_in_pcm_frames = __root.ma_sound_group_set_stop_time_in_pcm_frames;
    pub const group_set_stop_time_in_milliseconds = __root.ma_sound_group_set_stop_time_in_milliseconds;
    pub const group_is_playing = __root.ma_sound_group_is_playing;
    pub const group_get_time_in_pcm_frames = __root.ma_sound_group_get_time_in_pcm_frames;
};
pub const ma_sound = struct_ma_sound;
pub const struct_ma_sound_inlined = extern struct {
    sound: ma_sound = @import("std").mem.zeroes(ma_sound),
    pNext: [*c]ma_sound_inlined = null,
    pPrev: [*c]ma_sound_inlined = null,
};
pub const ma_sound_inlined = struct_ma_sound_inlined;
pub const ma_engine_process_proc = ?*const fn (pUserData: ?*anyopaque, pFramesOut: [*c]f32, frameCount: ma_uint64) callconv(.c) void;
pub const struct_ma_engine = extern struct {
    nodeGraph: ma_node_graph = @import("std").mem.zeroes(ma_node_graph),
    pDevice: [*c]ma_device = null,
    pLog: [*c]ma_log = null,
    sampleRate: ma_uint32 = 0,
    listenerCount: ma_uint32 = 0,
    listeners: [4]ma_spatializer_listener = @import("std").mem.zeroes([4]ma_spatializer_listener),
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    ownsResourceManager: ma_bool8 = 0,
    ownsDevice: ma_bool8 = 0,
    inlinedSoundLock: ma_spinlock = 0,
    pInlinedSoundHead: [*c]ma_sound_inlined = null,
    inlinedSoundCount: ma_uint32 = 0,
    gainSmoothTimeInFrames: ma_uint32 = 0,
    defaultVolumeSmoothTimeInPCMFrames: ma_uint32 = 0,
    monoExpansionMode: ma_mono_expansion_mode = @import("std").mem.zeroes(ma_mono_expansion_mode),
    onProcess: ma_engine_process_proc = null,
    pProcessUserData: ?*anyopaque = null,
    pitchResamplingConfig: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    pub const ma_engine_node_config_init = __root.ma_engine_node_config_init;
    pub const ma_sound_config_init_2 = __root.ma_sound_config_init_2;
    pub const ma_sound_group_config_init_2 = __root.ma_sound_group_config_init_2;
    pub const ma_engine_uninit = __root.ma_engine_uninit;
    pub const ma_engine_read_pcm_frames = __root.ma_engine_read_pcm_frames;
    pub const ma_engine_get_node_graph = __root.ma_engine_get_node_graph;
    pub const ma_engine_get_device = __root.ma_engine_get_device;
    pub const ma_engine_get_log = __root.ma_engine_get_log;
    pub const ma_engine_get_endpoint = __root.ma_engine_get_endpoint;
    pub const ma_engine_get_time_in_pcm_frames = __root.ma_engine_get_time_in_pcm_frames;
    pub const ma_engine_get_time_in_milliseconds = __root.ma_engine_get_time_in_milliseconds;
    pub const ma_engine_set_time_in_pcm_frames = __root.ma_engine_set_time_in_pcm_frames;
    pub const ma_engine_set_time_in_milliseconds = __root.ma_engine_set_time_in_milliseconds;
    pub const ma_engine_get_time = __root.ma_engine_get_time;
    pub const ma_engine_set_time = __root.ma_engine_set_time;
    pub const ma_engine_get_channels = __root.ma_engine_get_channels;
    pub const ma_engine_get_sample_rate = __root.ma_engine_get_sample_rate;
    pub const ma_engine_start = __root.ma_engine_start;
    pub const ma_engine_stop = __root.ma_engine_stop;
    pub const ma_engine_set_volume = __root.ma_engine_set_volume;
    pub const ma_engine_get_volume = __root.ma_engine_get_volume;
    pub const ma_engine_set_gain_db = __root.ma_engine_set_gain_db;
    pub const ma_engine_get_gain_db = __root.ma_engine_get_gain_db;
    pub const ma_engine_get_listener_count = __root.ma_engine_get_listener_count;
    pub const ma_engine_find_closest_listener = __root.ma_engine_find_closest_listener;
    pub const ma_engine_listener_set_position = __root.ma_engine_listener_set_position;
    pub const ma_engine_listener_get_position = __root.ma_engine_listener_get_position;
    pub const ma_engine_listener_set_direction = __root.ma_engine_listener_set_direction;
    pub const ma_engine_listener_get_direction = __root.ma_engine_listener_get_direction;
    pub const ma_engine_listener_set_velocity = __root.ma_engine_listener_set_velocity;
    pub const ma_engine_listener_get_velocity = __root.ma_engine_listener_get_velocity;
    pub const ma_engine_listener_set_cone = __root.ma_engine_listener_set_cone;
    pub const ma_engine_listener_get_cone = __root.ma_engine_listener_get_cone;
    pub const ma_engine_listener_set_world_up = __root.ma_engine_listener_set_world_up;
    pub const ma_engine_listener_get_world_up = __root.ma_engine_listener_get_world_up;
    pub const ma_engine_listener_set_enabled = __root.ma_engine_listener_set_enabled;
    pub const ma_engine_listener_is_enabled = __root.ma_engine_listener_is_enabled;
    pub const ma_sound_init_from_data_source = __root.ma_sound_init_from_data_source;
    pub const ma_sound_init_ex = __root.ma_sound_init_ex;
    pub const ma_sound_group_init = __root.ma_sound_group_init;
    pub const ma_sound_group_init_ex = __root.ma_sound_group_init_ex;
    pub const node_config_init = __root.ma_engine_node_config_init;
    pub const @"2" = __root.ma_sound_config_init_2;
    pub const uninit = __root.ma_engine_uninit;
    pub const read_pcm_frames = __root.ma_engine_read_pcm_frames;
    pub const get_node_graph = __root.ma_engine_get_node_graph;
    pub const get_device = __root.ma_engine_get_device;
    pub const get_log = __root.ma_engine_get_log;
    pub const get_endpoint = __root.ma_engine_get_endpoint;
    pub const get_time_in_pcm_frames = __root.ma_engine_get_time_in_pcm_frames;
    pub const get_time_in_milliseconds = __root.ma_engine_get_time_in_milliseconds;
    pub const set_time_in_pcm_frames = __root.ma_engine_set_time_in_pcm_frames;
    pub const set_time_in_milliseconds = __root.ma_engine_set_time_in_milliseconds;
    pub const get_time = __root.ma_engine_get_time;
    pub const set_time = __root.ma_engine_set_time;
    pub const get_channels = __root.ma_engine_get_channels;
    pub const get_sample_rate = __root.ma_engine_get_sample_rate;
    pub const start = __root.ma_engine_start;
    pub const stop = __root.ma_engine_stop;
    pub const set_volume = __root.ma_engine_set_volume;
    pub const get_volume = __root.ma_engine_get_volume;
    pub const set_gain_db = __root.ma_engine_set_gain_db;
    pub const get_gain_db = __root.ma_engine_get_gain_db;
    pub const get_listener_count = __root.ma_engine_get_listener_count;
    pub const find_closest_listener = __root.ma_engine_find_closest_listener;
    pub const listener_set_position = __root.ma_engine_listener_set_position;
    pub const listener_get_position = __root.ma_engine_listener_get_position;
    pub const listener_set_direction = __root.ma_engine_listener_set_direction;
    pub const listener_get_direction = __root.ma_engine_listener_get_direction;
    pub const listener_set_velocity = __root.ma_engine_listener_set_velocity;
    pub const listener_get_velocity = __root.ma_engine_listener_get_velocity;
    pub const listener_set_cone = __root.ma_engine_listener_set_cone;
    pub const listener_get_cone = __root.ma_engine_listener_get_cone;
    pub const listener_set_world_up = __root.ma_engine_listener_set_world_up;
    pub const listener_get_world_up = __root.ma_engine_listener_get_world_up;
    pub const listener_set_enabled = __root.ma_engine_listener_set_enabled;
    pub const listener_is_enabled = __root.ma_engine_listener_is_enabled;
    pub const source = __root.ma_sound_init_from_data_source;
    pub const ex = __root.ma_sound_init_ex;
    pub const init = __root.ma_sound_group_init;
};
pub const ma_engine = struct_ma_engine;
pub const MA_SOUND_FLAG_STREAM: c_int = 1;
pub const MA_SOUND_FLAG_DECODE: c_int = 2;
pub const MA_SOUND_FLAG_ASYNC: c_int = 4;
pub const MA_SOUND_FLAG_WAIT_INIT: c_int = 8;
pub const MA_SOUND_FLAG_UNKNOWN_LENGTH: c_int = 16;
pub const MA_SOUND_FLAG_LOOPING: c_int = 32;
pub const MA_SOUND_FLAG_NO_DEFAULT_ATTACHMENT: c_int = 4096;
pub const MA_SOUND_FLAG_NO_PITCH: c_int = 8192;
pub const MA_SOUND_FLAG_NO_SPATIALIZATION: c_int = 16384;
pub const ma_sound_flags = c_uint;
pub const ma_engine_node_type_sound: c_int = 0;
pub const ma_engine_node_type_group: c_int = 1;
pub const ma_engine_node_type = c_uint;
pub const ma_engine_node_config = extern struct {
    pEngine: [*c]ma_engine = null,
    type: ma_engine_node_type = @import("std").mem.zeroes(ma_engine_node_type),
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    volumeSmoothTimeInPCMFrames: ma_uint32 = 0,
    monoExpansionMode: ma_mono_expansion_mode = @import("std").mem.zeroes(ma_mono_expansion_mode),
    isPitchDisabled: ma_bool8 = 0,
    isSpatializationDisabled: ma_bool8 = 0,
    pinnedListenerIndex: ma_uint8 = 0,
    resampling: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    pub const ma_engine_node_get_heap_size = __root.ma_engine_node_get_heap_size;
    pub const ma_engine_node_init_preallocated = __root.ma_engine_node_init_preallocated;
    pub const ma_engine_node_init = __root.ma_engine_node_init;
    pub const size = __root.ma_engine_node_get_heap_size;
    pub const preallocated = __root.ma_engine_node_init_preallocated;
    pub const init = __root.ma_engine_node_init;
};
pub extern fn ma_engine_node_config_init(pEngine: [*c]ma_engine, @"type": ma_engine_node_type, flags: ma_uint32) ma_engine_node_config;
const struct_unnamed_65 = extern struct {
    volumeBeg: ma_atomic_float = @import("std").mem.zeroes(ma_atomic_float),
    volumeEnd: ma_atomic_float = @import("std").mem.zeroes(ma_atomic_float),
    fadeLengthInFrames: ma_atomic_uint64 = @import("std").mem.zeroes(ma_atomic_uint64),
    absoluteGlobalTimeInFrames: ma_atomic_uint64 = @import("std").mem.zeroes(ma_atomic_uint64),
};
pub const ma_engine_node = extern struct {
    baseNode: ma_node_base = @import("std").mem.zeroes(ma_node_base),
    pEngine: [*c]ma_engine = null,
    sampleRate: ma_uint32 = 0,
    volumeSmoothTimeInPCMFrames: ma_uint32 = 0,
    monoExpansionMode: ma_mono_expansion_mode = @import("std").mem.zeroes(ma_mono_expansion_mode),
    fader: ma_fader = @import("std").mem.zeroes(ma_fader),
    resampler: ma_resampler = @import("std").mem.zeroes(ma_resampler),
    spatializer: ma_spatializer = @import("std").mem.zeroes(ma_spatializer),
    panner: ma_panner = @import("std").mem.zeroes(ma_panner),
    volumeGainer: ma_gainer = @import("std").mem.zeroes(ma_gainer),
    volume: ma_atomic_float = @import("std").mem.zeroes(ma_atomic_float),
    pitch: f32 = 0,
    oldPitch: f32 = 0,
    oldDopplerPitch: f32 = 0,
    isPitchDisabled: ma_bool32 = 0,
    isSpatializationDisabled: ma_bool32 = 0,
    pinnedListenerIndex: ma_uint32 = 0,
    fadeSettings: struct_unnamed_65 = @import("std").mem.zeroes(struct_unnamed_65),
    _ownsHeap: ma_bool8 = 0,
    _pHeap: ?*anyopaque = null,
    pub const ma_engine_node_uninit = __root.ma_engine_node_uninit;
    pub const uninit = __root.ma_engine_node_uninit;
};
pub extern fn ma_engine_node_get_heap_size(pConfig: [*c]const ma_engine_node_config, pHeapSizeInBytes: [*c]usize) ma_result;
pub extern fn ma_engine_node_init_preallocated(pConfig: [*c]const ma_engine_node_config, pHeap: ?*anyopaque, pEngineNode: [*c]ma_engine_node) ma_result;
pub extern fn ma_engine_node_init(pConfig: [*c]const ma_engine_node_config, pAllocationCallbacks: [*c]const ma_allocation_callbacks, pEngineNode: [*c]ma_engine_node) ma_result;
pub extern fn ma_engine_node_uninit(pEngineNode: [*c]ma_engine_node, pAllocationCallbacks: [*c]const ma_allocation_callbacks) void;
pub const ma_sound_config = extern struct {
    pFilePath: [*c]const u8 = null,
    pFilePathW: [*c]const wchar_t = null,
    pDataSource: ?*ma_data_source = null,
    pInitialAttachment: ?*ma_node = null,
    initialAttachmentInputBusIndex: ma_uint32 = 0,
    channelsIn: ma_uint32 = 0,
    channelsOut: ma_uint32 = 0,
    monoExpansionMode: ma_mono_expansion_mode = @import("std").mem.zeroes(ma_mono_expansion_mode),
    flags: ma_uint32 = 0,
    volumeSmoothTimeInPCMFrames: ma_uint32 = 0,
    initialSeekPointInPCMFrames: ma_uint64 = 0,
    rangeBegInPCMFrames: ma_uint64 = 0,
    rangeEndInPCMFrames: ma_uint64 = 0,
    loopPointBegInPCMFrames: ma_uint64 = 0,
    loopPointEndInPCMFrames: ma_uint64 = 0,
    endCallback: ma_sound_end_proc = null,
    pEndCallbackUserData: ?*anyopaque = null,
    pitchResampling: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    pDoneFence: [*c]ma_fence = null,
    isLooping: ma_bool32 = 0,
};
pub extern fn ma_sound_config_init() ma_sound_config;
pub extern fn ma_sound_config_init_2(pEngine: [*c]ma_engine) ma_sound_config;
pub const ma_sound_group_config = ma_sound_config;
pub const ma_sound_group = ma_sound;
pub extern fn ma_sound_group_config_init() ma_sound_group_config;
pub extern fn ma_sound_group_config_init_2(pEngine: [*c]ma_engine) ma_sound_group_config;
pub const ma_engine_config = extern struct {
    pContext: [*c]ma_context = null,
    pDevice: [*c]ma_device = null,
    pPlaybackDeviceID: [*c]ma_device_id = null,
    dataCallback: ma_device_data_proc = null,
    notificationCallback: ma_device_notification_proc = null,
    pLog: [*c]ma_log = null,
    listenerCount: ma_uint32 = 0,
    channels: ma_uint32 = 0,
    sampleRate: ma_uint32 = 0,
    periodSizeInFrames: ma_uint32 = 0,
    periodSizeInMilliseconds: ma_uint32 = 0,
    gainSmoothTimeInFrames: ma_uint32 = 0,
    gainSmoothTimeInMilliseconds: ma_uint32 = 0,
    defaultVolumeSmoothTimeInPCMFrames: ma_uint32 = 0,
    preMixStackSizeInBytes: ma_uint32 = 0,
    allocationCallbacks: ma_allocation_callbacks = @import("std").mem.zeroes(ma_allocation_callbacks),
    noAutoStart: ma_bool32 = 0,
    noDevice: ma_bool32 = 0,
    monoExpansionMode: ma_mono_expansion_mode = @import("std").mem.zeroes(ma_mono_expansion_mode),
    pResourceManagerVFS: ?*ma_vfs = null,
    onProcess: ma_engine_process_proc = null,
    pProcessUserData: ?*anyopaque = null,
    resourceManagerResampling: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    pitchResampling: ma_resampler_config = @import("std").mem.zeroes(ma_resampler_config),
    pub const ma_engine_init = __root.ma_engine_init;
    pub const init = __root.ma_engine_init;
};
pub extern fn ma_engine_config_init() ma_engine_config;
pub extern fn ma_engine_init(pConfig: [*c]const ma_engine_config, pEngine: [*c]ma_engine) ma_result;
pub extern fn ma_engine_uninit(pEngine: [*c]ma_engine) void;
pub extern fn ma_engine_read_pcm_frames(pEngine: [*c]ma_engine, pFramesOut: ?*anyopaque, frameCount: ma_uint64, pFramesRead: [*c]ma_uint64) ma_result;
pub extern fn ma_engine_get_node_graph(pEngine: [*c]ma_engine) [*c]ma_node_graph;
pub extern fn ma_engine_get_device(pEngine: [*c]ma_engine) [*c]ma_device;
pub extern fn ma_engine_get_log(pEngine: [*c]ma_engine) [*c]ma_log;
pub extern fn ma_engine_get_endpoint(pEngine: [*c]ma_engine) ?*ma_node;
pub extern fn ma_engine_get_time_in_pcm_frames(pEngine: [*c]const ma_engine) ma_uint64;
pub extern fn ma_engine_get_time_in_milliseconds(pEngine: [*c]const ma_engine) ma_uint64;
pub extern fn ma_engine_set_time_in_pcm_frames(pEngine: [*c]ma_engine, globalTime: ma_uint64) ma_result;
pub extern fn ma_engine_set_time_in_milliseconds(pEngine: [*c]ma_engine, globalTime: ma_uint64) ma_result;
pub extern fn ma_engine_get_time(pEngine: [*c]const ma_engine) ma_uint64;
pub extern fn ma_engine_set_time(pEngine: [*c]ma_engine, globalTime: ma_uint64) ma_result;
pub extern fn ma_engine_get_channels(pEngine: [*c]const ma_engine) ma_uint32;
pub extern fn ma_engine_get_sample_rate(pEngine: [*c]const ma_engine) ma_uint32;
pub extern fn ma_engine_start(pEngine: [*c]ma_engine) ma_result;
pub extern fn ma_engine_stop(pEngine: [*c]ma_engine) ma_result;
pub extern fn ma_engine_set_volume(pEngine: [*c]ma_engine, volume: f32) ma_result;
pub extern fn ma_engine_get_volume(pEngine: [*c]ma_engine) f32;
pub extern fn ma_engine_set_gain_db(pEngine: [*c]ma_engine, gainDB: f32) ma_result;
pub extern fn ma_engine_get_gain_db(pEngine: [*c]ma_engine) f32;
pub extern fn ma_engine_get_listener_count(pEngine: [*c]const ma_engine) ma_uint32;
pub extern fn ma_engine_find_closest_listener(pEngine: [*c]const ma_engine, absolutePosX: f32, absolutePosY: f32, absolutePosZ: f32) ma_uint32;
pub extern fn ma_engine_listener_set_position(pEngine: [*c]ma_engine, listenerIndex: ma_uint32, x: f32, y: f32, z: f32) void;
pub extern fn ma_engine_listener_get_position(pEngine: [*c]const ma_engine, listenerIndex: ma_uint32) ma_vec3f;
pub extern fn ma_engine_listener_set_direction(pEngine: [*c]ma_engine, listenerIndex: ma_uint32, x: f32, y: f32, z: f32) void;
pub extern fn ma_engine_listener_get_direction(pEngine: [*c]const ma_engine, listenerIndex: ma_uint32) ma_vec3f;
pub extern fn ma_engine_listener_set_velocity(pEngine: [*c]ma_engine, listenerIndex: ma_uint32, x: f32, y: f32, z: f32) void;
pub extern fn ma_engine_listener_get_velocity(pEngine: [*c]const ma_engine, listenerIndex: ma_uint32) ma_vec3f;
pub extern fn ma_engine_listener_set_cone(pEngine: [*c]ma_engine, listenerIndex: ma_uint32, innerAngleInRadians: f32, outerAngleInRadians: f32, outerGain: f32) void;
pub extern fn ma_engine_listener_get_cone(pEngine: [*c]const ma_engine, listenerIndex: ma_uint32, pInnerAngleInRadians: [*c]f32, pOuterAngleInRadians: [*c]f32, pOuterGain: [*c]f32) void;
pub extern fn ma_engine_listener_set_world_up(pEngine: [*c]ma_engine, listenerIndex: ma_uint32, x: f32, y: f32, z: f32) void;
pub extern fn ma_engine_listener_get_world_up(pEngine: [*c]const ma_engine, listenerIndex: ma_uint32) ma_vec3f;
pub extern fn ma_engine_listener_set_enabled(pEngine: [*c]ma_engine, listenerIndex: ma_uint32, isEnabled: ma_bool32) void;
pub extern fn ma_engine_listener_is_enabled(pEngine: [*c]const ma_engine, listenerIndex: ma_uint32) ma_bool32;
pub extern fn ma_sound_init_from_data_source(pEngine: [*c]ma_engine, pDataSource: ?*ma_data_source, flags: ma_uint32, pGroup: [*c]ma_sound_group, pSound: [*c]ma_sound) ma_result;
pub extern fn ma_sound_init_ex(pEngine: [*c]ma_engine, pConfig: [*c]const ma_sound_config, pSound: [*c]ma_sound) ma_result;
pub extern fn ma_sound_uninit(pSound: [*c]ma_sound) void;
pub extern fn ma_sound_get_engine(pSound: [*c]const ma_sound) [*c]ma_engine;
pub extern fn ma_sound_get_data_source(pSound: [*c]const ma_sound) ?*ma_data_source;
pub extern fn ma_sound_start(pSound: [*c]ma_sound) ma_result;
pub extern fn ma_sound_stop(pSound: [*c]ma_sound) ma_result;
pub extern fn ma_sound_stop_with_fade_in_pcm_frames(pSound: [*c]ma_sound, fadeLengthInFrames: ma_uint64) ma_result;
pub extern fn ma_sound_stop_with_fade_in_milliseconds(pSound: [*c]ma_sound, fadeLengthInFrames: ma_uint64) ma_result;
pub extern fn ma_sound_reset_start_time(pSound: [*c]ma_sound) void;
pub extern fn ma_sound_reset_stop_time(pSound: [*c]ma_sound) void;
pub extern fn ma_sound_reset_fade(pSound: [*c]ma_sound) void;
pub extern fn ma_sound_reset_stop_time_and_fade(pSound: [*c]ma_sound) void;
pub extern fn ma_sound_set_volume(pSound: [*c]ma_sound, volume: f32) void;
pub extern fn ma_sound_get_volume(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_pan(pSound: [*c]ma_sound, pan: f32) void;
pub extern fn ma_sound_get_pan(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_pan_mode(pSound: [*c]ma_sound, panMode: ma_pan_mode) void;
pub extern fn ma_sound_get_pan_mode(pSound: [*c]const ma_sound) ma_pan_mode;
pub extern fn ma_sound_set_pitch(pSound: [*c]ma_sound, pitch: f32) void;
pub extern fn ma_sound_get_pitch(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_spatialization_enabled(pSound: [*c]ma_sound, enabled: ma_bool32) void;
pub extern fn ma_sound_is_spatialization_enabled(pSound: [*c]const ma_sound) ma_bool32;
pub extern fn ma_sound_set_pinned_listener_index(pSound: [*c]ma_sound, listenerIndex: ma_uint32) void;
pub extern fn ma_sound_get_pinned_listener_index(pSound: [*c]const ma_sound) ma_uint32;
pub extern fn ma_sound_get_listener_index(pSound: [*c]const ma_sound) ma_uint32;
pub extern fn ma_sound_get_direction_to_listener(pSound: [*c]const ma_sound) ma_vec3f;
pub extern fn ma_sound_set_position(pSound: [*c]ma_sound, x: f32, y: f32, z: f32) void;
pub extern fn ma_sound_get_position(pSound: [*c]const ma_sound) ma_vec3f;
pub extern fn ma_sound_set_direction(pSound: [*c]ma_sound, x: f32, y: f32, z: f32) void;
pub extern fn ma_sound_get_direction(pSound: [*c]const ma_sound) ma_vec3f;
pub extern fn ma_sound_set_velocity(pSound: [*c]ma_sound, x: f32, y: f32, z: f32) void;
pub extern fn ma_sound_get_velocity(pSound: [*c]const ma_sound) ma_vec3f;
pub extern fn ma_sound_set_attenuation_model(pSound: [*c]ma_sound, attenuationModel: ma_attenuation_model) void;
pub extern fn ma_sound_get_attenuation_model(pSound: [*c]const ma_sound) ma_attenuation_model;
pub extern fn ma_sound_set_positioning(pSound: [*c]ma_sound, positioning: ma_positioning) void;
pub extern fn ma_sound_get_positioning(pSound: [*c]const ma_sound) ma_positioning;
pub extern fn ma_sound_set_rolloff(pSound: [*c]ma_sound, rolloff: f32) void;
pub extern fn ma_sound_get_rolloff(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_min_gain(pSound: [*c]ma_sound, minGain: f32) void;
pub extern fn ma_sound_get_min_gain(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_max_gain(pSound: [*c]ma_sound, maxGain: f32) void;
pub extern fn ma_sound_get_max_gain(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_min_distance(pSound: [*c]ma_sound, minDistance: f32) void;
pub extern fn ma_sound_get_min_distance(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_max_distance(pSound: [*c]ma_sound, maxDistance: f32) void;
pub extern fn ma_sound_get_max_distance(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_cone(pSound: [*c]ma_sound, innerAngleInRadians: f32, outerAngleInRadians: f32, outerGain: f32) void;
pub extern fn ma_sound_get_cone(pSound: [*c]const ma_sound, pInnerAngleInRadians: [*c]f32, pOuterAngleInRadians: [*c]f32, pOuterGain: [*c]f32) void;
pub extern fn ma_sound_set_doppler_factor(pSound: [*c]ma_sound, dopplerFactor: f32) void;
pub extern fn ma_sound_get_doppler_factor(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_directional_attenuation_factor(pSound: [*c]ma_sound, directionalAttenuationFactor: f32) void;
pub extern fn ma_sound_get_directional_attenuation_factor(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_fade_in_pcm_frames(pSound: [*c]ma_sound, volumeBeg: f32, volumeEnd: f32, fadeLengthInFrames: ma_uint64) void;
pub extern fn ma_sound_set_fade_in_milliseconds(pSound: [*c]ma_sound, volumeBeg: f32, volumeEnd: f32, fadeLengthInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_set_fade_start_in_pcm_frames(pSound: [*c]ma_sound, volumeBeg: f32, volumeEnd: f32, fadeLengthInFrames: ma_uint64, absoluteGlobalTimeInFrames: ma_uint64) void;
pub extern fn ma_sound_set_fade_start_in_milliseconds(pSound: [*c]ma_sound, volumeBeg: f32, volumeEnd: f32, fadeLengthInMilliseconds: ma_uint64, absoluteGlobalTimeInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_get_current_fade_volume(pSound: [*c]const ma_sound) f32;
pub extern fn ma_sound_set_start_time_in_pcm_frames(pSound: [*c]ma_sound, absoluteGlobalTimeInFrames: ma_uint64) void;
pub extern fn ma_sound_set_start_time_in_milliseconds(pSound: [*c]ma_sound, absoluteGlobalTimeInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_set_stop_time_in_pcm_frames(pSound: [*c]ma_sound, absoluteGlobalTimeInFrames: ma_uint64) void;
pub extern fn ma_sound_set_stop_time_in_milliseconds(pSound: [*c]ma_sound, absoluteGlobalTimeInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_set_stop_time_with_fade_in_pcm_frames(pSound: [*c]ma_sound, stopAbsoluteGlobalTimeInFrames: ma_uint64, fadeLengthInFrames: ma_uint64) void;
pub extern fn ma_sound_set_stop_time_with_fade_in_milliseconds(pSound: [*c]ma_sound, stopAbsoluteGlobalTimeInMilliseconds: ma_uint64, fadeLengthInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_is_playing(pSound: [*c]const ma_sound) ma_bool32;
pub extern fn ma_sound_get_time_in_pcm_frames(pSound: [*c]const ma_sound) ma_uint64;
pub extern fn ma_sound_get_time_in_milliseconds(pSound: [*c]const ma_sound) ma_uint64;
pub extern fn ma_sound_set_looping(pSound: [*c]ma_sound, isLooping: ma_bool32) void;
pub extern fn ma_sound_is_looping(pSound: [*c]const ma_sound) ma_bool32;
pub extern fn ma_sound_at_end(pSound: [*c]const ma_sound) ma_bool32;
pub extern fn ma_sound_seek_to_pcm_frame(pSound: [*c]ma_sound, frameIndex: ma_uint64) ma_result;
pub extern fn ma_sound_seek_to_second(pSound: [*c]ma_sound, seekPointInSeconds: f32) ma_result;
pub extern fn ma_sound_get_data_format(pSound: [*c]const ma_sound, pFormat: [*c]ma_format, pChannels: [*c]ma_uint32, pSampleRate: [*c]ma_uint32, pChannelMap: [*c]ma_channel, channelMapCap: usize) ma_result;
pub extern fn ma_sound_get_cursor_in_pcm_frames(pSound: [*c]const ma_sound, pCursor: [*c]ma_uint64) ma_result;
pub extern fn ma_sound_get_length_in_pcm_frames(pSound: [*c]const ma_sound, pLength: [*c]ma_uint64) ma_result;
pub extern fn ma_sound_get_cursor_in_seconds(pSound: [*c]const ma_sound, pCursor: [*c]f32) ma_result;
pub extern fn ma_sound_get_length_in_seconds(pSound: [*c]const ma_sound, pLength: [*c]f32) ma_result;
pub extern fn ma_sound_set_end_callback(pSound: [*c]ma_sound, callback: ma_sound_end_proc, pUserData: ?*anyopaque) ma_result;
pub extern fn ma_sound_group_init(pEngine: [*c]ma_engine, flags: ma_uint32, pParentGroup: [*c]ma_sound_group, pGroup: [*c]ma_sound_group) ma_result;
pub extern fn ma_sound_group_init_ex(pEngine: [*c]ma_engine, pConfig: [*c]const ma_sound_group_config, pGroup: [*c]ma_sound_group) ma_result;
pub extern fn ma_sound_group_uninit(pGroup: [*c]ma_sound_group) void;
pub extern fn ma_sound_group_get_engine(pGroup: [*c]const ma_sound_group) [*c]ma_engine;
pub extern fn ma_sound_group_start(pGroup: [*c]ma_sound_group) ma_result;
pub extern fn ma_sound_group_stop(pGroup: [*c]ma_sound_group) ma_result;
pub extern fn ma_sound_group_set_volume(pGroup: [*c]ma_sound_group, volume: f32) void;
pub extern fn ma_sound_group_get_volume(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_pan(pGroup: [*c]ma_sound_group, pan: f32) void;
pub extern fn ma_sound_group_get_pan(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_pan_mode(pGroup: [*c]ma_sound_group, panMode: ma_pan_mode) void;
pub extern fn ma_sound_group_get_pan_mode(pGroup: [*c]const ma_sound_group) ma_pan_mode;
pub extern fn ma_sound_group_set_pitch(pGroup: [*c]ma_sound_group, pitch: f32) void;
pub extern fn ma_sound_group_get_pitch(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_spatialization_enabled(pGroup: [*c]ma_sound_group, enabled: ma_bool32) void;
pub extern fn ma_sound_group_is_spatialization_enabled(pGroup: [*c]const ma_sound_group) ma_bool32;
pub extern fn ma_sound_group_set_pinned_listener_index(pGroup: [*c]ma_sound_group, listenerIndex: ma_uint32) void;
pub extern fn ma_sound_group_get_pinned_listener_index(pGroup: [*c]const ma_sound_group) ma_uint32;
pub extern fn ma_sound_group_get_listener_index(pGroup: [*c]const ma_sound_group) ma_uint32;
pub extern fn ma_sound_group_get_direction_to_listener(pGroup: [*c]const ma_sound_group) ma_vec3f;
pub extern fn ma_sound_group_set_position(pGroup: [*c]ma_sound_group, x: f32, y: f32, z: f32) void;
pub extern fn ma_sound_group_get_position(pGroup: [*c]const ma_sound_group) ma_vec3f;
pub extern fn ma_sound_group_set_direction(pGroup: [*c]ma_sound_group, x: f32, y: f32, z: f32) void;
pub extern fn ma_sound_group_get_direction(pGroup: [*c]const ma_sound_group) ma_vec3f;
pub extern fn ma_sound_group_set_velocity(pGroup: [*c]ma_sound_group, x: f32, y: f32, z: f32) void;
pub extern fn ma_sound_group_get_velocity(pGroup: [*c]const ma_sound_group) ma_vec3f;
pub extern fn ma_sound_group_set_attenuation_model(pGroup: [*c]ma_sound_group, attenuationModel: ma_attenuation_model) void;
pub extern fn ma_sound_group_get_attenuation_model(pGroup: [*c]const ma_sound_group) ma_attenuation_model;
pub extern fn ma_sound_group_set_positioning(pGroup: [*c]ma_sound_group, positioning: ma_positioning) void;
pub extern fn ma_sound_group_get_positioning(pGroup: [*c]const ma_sound_group) ma_positioning;
pub extern fn ma_sound_group_set_rolloff(pGroup: [*c]ma_sound_group, rolloff: f32) void;
pub extern fn ma_sound_group_get_rolloff(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_min_gain(pGroup: [*c]ma_sound_group, minGain: f32) void;
pub extern fn ma_sound_group_get_min_gain(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_max_gain(pGroup: [*c]ma_sound_group, maxGain: f32) void;
pub extern fn ma_sound_group_get_max_gain(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_min_distance(pGroup: [*c]ma_sound_group, minDistance: f32) void;
pub extern fn ma_sound_group_get_min_distance(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_max_distance(pGroup: [*c]ma_sound_group, maxDistance: f32) void;
pub extern fn ma_sound_group_get_max_distance(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_cone(pGroup: [*c]ma_sound_group, innerAngleInRadians: f32, outerAngleInRadians: f32, outerGain: f32) void;
pub extern fn ma_sound_group_get_cone(pGroup: [*c]const ma_sound_group, pInnerAngleInRadians: [*c]f32, pOuterAngleInRadians: [*c]f32, pOuterGain: [*c]f32) void;
pub extern fn ma_sound_group_set_doppler_factor(pGroup: [*c]ma_sound_group, dopplerFactor: f32) void;
pub extern fn ma_sound_group_get_doppler_factor(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_directional_attenuation_factor(pGroup: [*c]ma_sound_group, directionalAttenuationFactor: f32) void;
pub extern fn ma_sound_group_get_directional_attenuation_factor(pGroup: [*c]const ma_sound_group) f32;
pub extern fn ma_sound_group_set_fade_in_pcm_frames(pGroup: [*c]ma_sound_group, volumeBeg: f32, volumeEnd: f32, fadeLengthInFrames: ma_uint64) void;
pub extern fn ma_sound_group_set_fade_in_milliseconds(pGroup: [*c]ma_sound_group, volumeBeg: f32, volumeEnd: f32, fadeLengthInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_group_get_current_fade_volume(pGroup: [*c]ma_sound_group) f32;
pub extern fn ma_sound_group_set_start_time_in_pcm_frames(pGroup: [*c]ma_sound_group, absoluteGlobalTimeInFrames: ma_uint64) void;
pub extern fn ma_sound_group_set_start_time_in_milliseconds(pGroup: [*c]ma_sound_group, absoluteGlobalTimeInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_group_set_stop_time_in_pcm_frames(pGroup: [*c]ma_sound_group, absoluteGlobalTimeInFrames: ma_uint64) void;
pub extern fn ma_sound_group_set_stop_time_in_milliseconds(pGroup: [*c]ma_sound_group, absoluteGlobalTimeInMilliseconds: ma_uint64) void;
pub extern fn ma_sound_group_is_playing(pGroup: [*c]const ma_sound_group) ma_bool32;
pub extern fn ma_sound_group_get_time_in_pcm_frames(pGroup: [*c]const ma_sound_group) ma_uint64;

pub const __VERSION__ = "Aro aro-zig";
pub const __Aro__ = "";
pub const __STDC__ = @as(c_int, 1);
pub const __STDC_HOSTED__ = @as(c_int, 1);
pub const __STDC_UTF_16__ = @as(c_int, 1);
pub const __STDC_UTF_32__ = @as(c_int, 1);
pub const __STDC_EMBED_NOT_FOUND__ = @as(c_int, 0);
pub const __STDC_EMBED_FOUND__ = @as(c_int, 1);
pub const __STDC_EMBED_EMPTY__ = @as(c_int, 2);
pub const __STDC_VERSION__ = @as(c_long, 201710);
pub const __GNUC__ = @as(c_int, 7);
pub const __GNUC_MINOR__ = @as(c_int, 1);
pub const __GNUC_PATCHLEVEL__ = @as(c_int, 0);
pub const __ARO_EMULATE_NO__ = @as(c_int, 0);
pub const __ARO_EMULATE_CLANG__ = @as(c_int, 1);
pub const __ARO_EMULATE_GCC__ = @as(c_int, 2);
pub const __ARO_EMULATE_MSVC__ = @as(c_int, 3);
pub const __ARO_EMULATE__ = __ARO_EMULATE_GCC__;
pub inline fn __building_module(x: anytype) @TypeOf(@as(c_int, 0)) {
    _ = &x;
    return @as(c_int, 0);
}
pub const __OPTIMIZE__ = @as(c_int, 1);
pub const _WIN32 = @as(c_int, 1);
pub const _WIN64 = @as(c_int, 1);
pub const WIN32 = @as(c_int, 1);
pub const __WIN32 = @as(c_int, 1);
pub const __WIN32__ = @as(c_int, 1);
pub const WINNT = @as(c_int, 1);
pub const __WINNT = @as(c_int, 1);
pub const __WINNT__ = @as(c_int, 1);
pub const WIN64 = @as(c_int, 1);
pub const __WIN64 = @as(c_int, 1);
pub const __WIN64__ = @as(c_int, 1);
pub const __MINGW64__ = @as(c_int, 1);
pub const __MSVCRT__ = @as(c_int, 1);
pub const __MINGW32__ = @as(c_int, 1);
pub const __declspec = @compileError("unable to translate C expr: unexpected token '__attribute__'"); // <builtin>:35:9
pub const _cdecl = @compileError("unable to translate macro: undefined identifier `__cdecl__`"); // <builtin>:36:9
pub const __cdecl = @compileError("unable to translate macro: undefined identifier `__cdecl__`"); // <builtin>:37:9
pub const _stdcall = @compileError("unable to translate macro: undefined identifier `__stdcall__`"); // <builtin>:38:9
pub const __stdcall = @compileError("unable to translate macro: undefined identifier `__stdcall__`"); // <builtin>:39:9
pub const _fastcall = @compileError("unable to translate macro: undefined identifier `__fastcall__`"); // <builtin>:40:9
pub const __fastcall = @compileError("unable to translate macro: undefined identifier `__fastcall__`"); // <builtin>:41:9
pub const _thiscall = @compileError("unable to translate macro: undefined identifier `__thiscall__`"); // <builtin>:42:9
pub const __thiscall = @compileError("unable to translate macro: undefined identifier `__thiscall__`"); // <builtin>:43:9
pub const unix = @as(c_int, 1);
pub const __unix = @as(c_int, 1);
pub const __unix__ = @as(c_int, 1);
pub const __code_model_small__ = @as(c_int, 1);
pub const __amd64__ = @as(c_int, 1);
pub const __amd64 = @as(c_int, 1);
pub const __x86_64__ = @as(c_int, 1);
pub const __x86_64 = @as(c_int, 1);
pub const __SEG_GS = @as(c_int, 1);
pub const __SEG_FS = @as(c_int, 1);
pub const __seg_gs = @compileError("unable to translate macro: undefined identifier `address_space`"); // <builtin>:54:9
pub const __seg_fs = @compileError("unable to translate macro: undefined identifier `address_space`"); // <builtin>:55:9
pub const __LAHF_SAHF__ = @as(c_int, 1);
pub const __AES__ = @as(c_int, 1);
pub const __VAES__ = @as(c_int, 1);
pub const __PCLMUL__ = @as(c_int, 1);
pub const __VPCLMULQDQ__ = @as(c_int, 1);
pub const __LZCNT__ = @as(c_int, 1);
pub const __RDRND__ = @as(c_int, 1);
pub const __FSGSBASE__ = @as(c_int, 1);
pub const __BMI__ = @as(c_int, 1);
pub const __BMI2__ = @as(c_int, 1);
pub const __POPCNT__ = @as(c_int, 1);
pub const __PRFCHW__ = @as(c_int, 1);
pub const __RDSEED__ = @as(c_int, 1);
pub const __ADX__ = @as(c_int, 1);
pub const __MWAITX__ = @as(c_int, 1);
pub const __MOVBE__ = @as(c_int, 1);
pub const __SSE4A__ = @as(c_int, 1);
pub const __FMA__ = @as(c_int, 1);
pub const __F16C__ = @as(c_int, 1);
pub const __SHA__ = @as(c_int, 1);
pub const __FXSR__ = @as(c_int, 1);
pub const __XSAVE__ = @as(c_int, 1);
pub const __XSAVEOPT__ = @as(c_int, 1);
pub const __XSAVEC__ = @as(c_int, 1);
pub const __XSAVES__ = @as(c_int, 1);
pub const __CLFLUSHOPT__ = @as(c_int, 1);
pub const __CLWB__ = @as(c_int, 1);
pub const __WBNOINVD__ = @as(c_int, 1);
pub const __SHSTK__ = @as(c_int, 1);
pub const __CLZERO__ = @as(c_int, 1);
pub const __RDPID__ = @as(c_int, 1);
pub const __RDPRU__ = @as(c_int, 1);
pub const __INVPCID__ = @as(c_int, 1);
pub const __CRC32__ = @as(c_int, 1);
pub const __AVX2__ = @as(c_int, 1);
pub const __AVX__ = @as(c_int, 1);
pub const __SSE4_2__ = @as(c_int, 1);
pub const __SSE4_1__ = @as(c_int, 1);
pub const __SSSE3__ = @as(c_int, 1);
pub const __SSE3__ = @as(c_int, 1);
pub const __SSE2__ = @as(c_int, 1);
pub const __SSE__ = @as(c_int, 1);
pub const __SSE_MATH__ = @as(c_int, 1);
pub const __MMX__ = @as(c_int, 1);
pub const __GCC_HAVE_SYNC_COMPARE_AND_SWAP_8 = @as(c_int, 1);
pub const __ORDER_LITTLE_ENDIAN__ = @as(c_int, 1234);
pub const __ORDER_BIG_ENDIAN__ = @as(c_int, 4321);
pub const __ORDER_PDP_ENDIAN__ = @as(c_int, 3412);
pub const __BYTE_ORDER__ = __ORDER_LITTLE_ENDIAN__;
pub const __LITTLE_ENDIAN__ = @as(c_int, 1);
pub const __ATOMIC_RELAXED = @as(c_int, 0);
pub const __ATOMIC_CONSUME = @as(c_int, 1);
pub const __ATOMIC_ACQUIRE = @as(c_int, 2);
pub const __ATOMIC_RELEASE = @as(c_int, 3);
pub const __ATOMIC_ACQ_REL = @as(c_int, 4);
pub const __ATOMIC_SEQ_CST = @as(c_int, 5);
pub const __ATOMIC_BOOL_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_CHAR_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_CHAR16_T_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_CHAR32_T_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_WCHAR_T_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_WINT_T_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_SHORT_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_INT_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_LONG_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_LLONG_LOCK_FREE = @as(c_int, 1);
pub const __ATOMIC_POINTER_LOCK_FREE = @as(c_int, 1);
pub const __WCHAR_UNSIGNED__ = @as(c_int, 1);
pub const __WINT_UNSIGNED__ = @as(c_int, 1);
pub const __CHAR_BIT__ = @as(c_int, 8);
pub const __BOOL_WIDTH__ = @as(c_int, 8);
pub const __SCHAR_MAX__ = @as(c_int, 127);
pub const __SCHAR_WIDTH__ = @as(c_int, 8);
pub const __SHRT_MAX__ = @as(c_int, 32767);
pub const __SHRT_WIDTH__ = @as(c_int, 16);
pub const __INT_MAX__ = __helpers.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const __INT_WIDTH__ = @as(c_int, 32);
pub const __LONG_MAX__ = @as(c_long, 2147483647);
pub const __LONG_WIDTH__ = @as(c_int, 32);
pub const __LONG_LONG_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __LONG_LONG_WIDTH__ = @as(c_int, 64);
pub const __WCHAR_MAX__ = __helpers.promoteIntLiteral(c_int, 65535, .decimal);
pub const __WCHAR_WIDTH__ = @as(c_int, 16);
pub const __WINT_MAX__ = __helpers.promoteIntLiteral(c_int, 65535, .decimal);
pub const __WINT_WIDTH__ = @as(c_int, 16);
pub const __INTMAX_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __INTMAX_WIDTH__ = @as(c_int, 64);
pub const __SIZE_MAX__ = @as(c_ulonglong, 18446744073709551615);
pub const __SIZE_WIDTH__ = @as(c_int, 64);
pub const __UINTMAX_MAX__ = @as(c_ulonglong, 18446744073709551615);
pub const __UINTMAX_WIDTH__ = @as(c_int, 64);
pub const __PTRDIFF_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __PTRDIFF_WIDTH__ = @as(c_int, 64);
pub const __INTPTR_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __INTPTR_WIDTH__ = @as(c_int, 64);
pub const __UINTPTR_MAX__ = @as(c_ulonglong, 18446744073709551615);
pub const __UINTPTR_WIDTH__ = @as(c_int, 64);
pub const __SIG_ATOMIC_MAX__ = __helpers.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const __SIG_ATOMIC_WIDTH__ = @as(c_int, 32);
pub const __BITINT_MAXWIDTH__ = __helpers.promoteIntLiteral(c_int, 65535, .decimal);
pub const __SIZEOF_FLOAT__ = @as(c_int, 4);
pub const __SIZEOF_DOUBLE__ = @as(c_int, 8);
pub const __SIZEOF_LONG_DOUBLE__ = @as(c_int, 10);
pub const __SIZEOF_SHORT__ = @as(c_int, 2);
pub const __SIZEOF_INT__ = @as(c_int, 4);
pub const __SIZEOF_LONG__ = @as(c_int, 4);
pub const __SIZEOF_LONG_LONG__ = @as(c_int, 8);
pub const __SIZEOF_POINTER__ = @as(c_int, 8);
pub const __SIZEOF_PTRDIFF_T__ = @as(c_int, 8);
pub const __SIZEOF_SIZE_T__ = @as(c_int, 8);
pub const __SIZEOF_WCHAR_T__ = @as(c_int, 2);
pub const __SIZEOF_WINT_T__ = @as(c_int, 2);
pub const __SIZEOF_INT128__ = @as(c_int, 16);
pub const __INTPTR_TYPE__ = c_longlong;
pub const __UINTPTR_TYPE__ = c_ulonglong;
pub const __INTMAX_TYPE__ = c_longlong;
pub const __INTMAX_C_SUFFIX__ = @compileError("unable to translate macro: undefined identifier `LL`"); // <builtin>:173:9
pub const __INTMAX_C = __helpers.LL_SUFFIX;
pub const __UINTMAX_TYPE__ = c_ulonglong;
pub const __UINTMAX_C_SUFFIX__ = @compileError("unable to translate macro: undefined identifier `ULL`"); // <builtin>:176:9
pub const __UINTMAX_C = __helpers.ULL_SUFFIX;
pub const __PTRDIFF_TYPE__ = c_longlong;
pub const __SIZE_TYPE__ = c_ulonglong;
pub const __WCHAR_TYPE__ = c_ushort;
pub const __WINT_TYPE__ = c_ushort;
pub const __CHAR16_TYPE__ = c_ushort;
pub const __CHAR32_TYPE__ = c_uint;
pub const __INT8_TYPE__ = i8;
pub const __INT8_FMTd__ = "hhd";
pub const __INT8_FMTi__ = "hhi";
pub const __INT8_C_SUFFIX__ = "";
pub inline fn __INT8_C(c: anytype) @TypeOf(c) {
    _ = &c;
    return c;
}
pub const __INT16_TYPE__ = c_short;
pub const __INT16_FMTd__ = "hd";
pub const __INT16_FMTi__ = "hi";
pub const __INT16_C_SUFFIX__ = "";
pub inline fn __INT16_C(c: anytype) @TypeOf(c) {
    _ = &c;
    return c;
}
pub const __INT32_TYPE__ = c_int;
pub const __INT32_FMTd__ = "d";
pub const __INT32_FMTi__ = "i";
pub const __INT32_C_SUFFIX__ = "";
pub inline fn __INT32_C(c: anytype) @TypeOf(c) {
    _ = &c;
    return c;
}
pub const __INT64_TYPE__ = c_longlong;
pub const __INT64_FMTd__ = "lld";
pub const __INT64_FMTi__ = "lli";
pub const __INT64_C_SUFFIX__ = @compileError("unable to translate macro: undefined identifier `LL`"); // <builtin>:202:9
pub const __INT64_C = __helpers.LL_SUFFIX;
pub const __UINT8_TYPE__ = u8;
pub const __UINT8_FMTo__ = "hho";
pub const __UINT8_FMTu__ = "hhu";
pub const __UINT8_FMTx__ = "hhx";
pub const __UINT8_FMTX__ = "hhX";
pub const __UINT8_C_SUFFIX__ = "";
pub inline fn __UINT8_C(c: anytype) @TypeOf(c) {
    _ = &c;
    return c;
}
pub const __UINT8_MAX__ = @as(c_int, 255);
pub const __INT8_MAX__ = @as(c_int, 127);
pub const __UINT16_TYPE__ = c_ushort;
pub const __UINT16_FMTo__ = "ho";
pub const __UINT16_FMTu__ = "hu";
pub const __UINT16_FMTx__ = "hx";
pub const __UINT16_FMTX__ = "hX";
pub const __UINT16_C_SUFFIX__ = "";
pub inline fn __UINT16_C(c: anytype) @TypeOf(c) {
    _ = &c;
    return c;
}
pub const __UINT16_MAX__ = __helpers.promoteIntLiteral(c_int, 65535, .decimal);
pub const __INT16_MAX__ = @as(c_int, 32767);
pub const __UINT32_TYPE__ = c_uint;
pub const __UINT32_FMTo__ = "o";
pub const __UINT32_FMTu__ = "u";
pub const __UINT32_FMTx__ = "x";
pub const __UINT32_FMTX__ = "X";
pub const __UINT32_C_SUFFIX__ = @compileError("unable to translate macro: undefined identifier `U`"); // <builtin>:227:9
pub const __UINT32_C = __helpers.U_SUFFIX;
pub const __UINT32_MAX__ = __helpers.promoteIntLiteral(c_uint, 4294967295, .decimal);
pub const __INT32_MAX__ = __helpers.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const __UINT64_TYPE__ = c_ulonglong;
pub const __UINT64_FMTo__ = "llo";
pub const __UINT64_FMTu__ = "llu";
pub const __UINT64_FMTx__ = "llx";
pub const __UINT64_FMTX__ = "llX";
pub const __UINT64_C_SUFFIX__ = @compileError("unable to translate macro: undefined identifier `ULL`"); // <builtin>:236:9
pub const __UINT64_C = __helpers.ULL_SUFFIX;
pub const __UINT64_MAX__ = @as(c_ulonglong, 18446744073709551615);
pub const __INT64_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __INT_LEAST8_TYPE__ = i8;
pub const __INT_LEAST8_MAX__ = @as(c_int, 127);
pub const __INT_LEAST8_WIDTH__ = @as(c_int, 8);
pub const INT_LEAST8_FMTd__ = "hhd";
pub const INT_LEAST8_FMTi__ = "hhi";
pub const __UINT_LEAST8_TYPE__ = u8;
pub const __UINT_LEAST8_MAX__ = @as(c_int, 255);
pub const UINT_LEAST8_FMTo__ = "hho";
pub const UINT_LEAST8_FMTu__ = "hhu";
pub const UINT_LEAST8_FMTx__ = "hhx";
pub const UINT_LEAST8_FMTX__ = "hhX";
pub const __INT_FAST8_TYPE__ = i8;
pub const __INT_FAST8_MAX__ = @as(c_int, 127);
pub const __INT_FAST8_WIDTH__ = @as(c_int, 8);
pub const INT_FAST8_FMTd__ = "hhd";
pub const INT_FAST8_FMTi__ = "hhi";
pub const __UINT_FAST8_TYPE__ = u8;
pub const __UINT_FAST8_MAX__ = @as(c_int, 255);
pub const UINT_FAST8_FMTo__ = "hho";
pub const UINT_FAST8_FMTu__ = "hhu";
pub const UINT_FAST8_FMTx__ = "hhx";
pub const UINT_FAST8_FMTX__ = "hhX";
pub const __INT_LEAST16_TYPE__ = c_short;
pub const __INT_LEAST16_MAX__ = @as(c_int, 32767);
pub const __INT_LEAST16_WIDTH__ = @as(c_int, 16);
pub const INT_LEAST16_FMTd__ = "hd";
pub const INT_LEAST16_FMTi__ = "hi";
pub const __UINT_LEAST16_TYPE__ = c_ushort;
pub const __UINT_LEAST16_MAX__ = __helpers.promoteIntLiteral(c_int, 65535, .decimal);
pub const UINT_LEAST16_FMTo__ = "ho";
pub const UINT_LEAST16_FMTu__ = "hu";
pub const UINT_LEAST16_FMTx__ = "hx";
pub const UINT_LEAST16_FMTX__ = "hX";
pub const __INT_FAST16_TYPE__ = c_short;
pub const __INT_FAST16_MAX__ = @as(c_int, 32767);
pub const __INT_FAST16_WIDTH__ = @as(c_int, 16);
pub const INT_FAST16_FMTd__ = "hd";
pub const INT_FAST16_FMTi__ = "hi";
pub const __UINT_FAST16_TYPE__ = c_ushort;
pub const __UINT_FAST16_MAX__ = __helpers.promoteIntLiteral(c_int, 65535, .decimal);
pub const UINT_FAST16_FMTo__ = "ho";
pub const UINT_FAST16_FMTu__ = "hu";
pub const UINT_FAST16_FMTx__ = "hx";
pub const UINT_FAST16_FMTX__ = "hX";
pub const __INT_LEAST32_TYPE__ = c_int;
pub const __INT_LEAST32_MAX__ = __helpers.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const __INT_LEAST32_WIDTH__ = @as(c_int, 32);
pub const INT_LEAST32_FMTd__ = "d";
pub const INT_LEAST32_FMTi__ = "i";
pub const __UINT_LEAST32_TYPE__ = c_uint;
pub const __UINT_LEAST32_MAX__ = __helpers.promoteIntLiteral(c_uint, 4294967295, .decimal);
pub const UINT_LEAST32_FMTo__ = "o";
pub const UINT_LEAST32_FMTu__ = "u";
pub const UINT_LEAST32_FMTx__ = "x";
pub const UINT_LEAST32_FMTX__ = "X";
pub const __INT_FAST32_TYPE__ = c_int;
pub const __INT_FAST32_MAX__ = __helpers.promoteIntLiteral(c_int, 2147483647, .decimal);
pub const __INT_FAST32_WIDTH__ = @as(c_int, 32);
pub const INT_FAST32_FMTd__ = "d";
pub const INT_FAST32_FMTi__ = "i";
pub const __UINT_FAST32_TYPE__ = c_uint;
pub const __UINT_FAST32_MAX__ = __helpers.promoteIntLiteral(c_uint, 4294967295, .decimal);
pub const UINT_FAST32_FMTo__ = "o";
pub const UINT_FAST32_FMTu__ = "u";
pub const UINT_FAST32_FMTx__ = "x";
pub const UINT_FAST32_FMTX__ = "X";
pub const __INT_LEAST64_TYPE__ = c_longlong;
pub const __INT_LEAST64_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __INT_LEAST64_WIDTH__ = @as(c_int, 64);
pub const INT_LEAST64_FMTd__ = "lld";
pub const INT_LEAST64_FMTi__ = "lli";
pub const __UINT_LEAST64_TYPE__ = c_ulonglong;
pub const __UINT_LEAST64_MAX__ = @as(c_ulonglong, 18446744073709551615);
pub const UINT_LEAST64_FMTo__ = "llo";
pub const UINT_LEAST64_FMTu__ = "llu";
pub const UINT_LEAST64_FMTx__ = "llx";
pub const UINT_LEAST64_FMTX__ = "llX";
pub const __INT_FAST64_TYPE__ = c_longlong;
pub const __INT_FAST64_MAX__ = @as(c_longlong, 9223372036854775807);
pub const __INT_FAST64_WIDTH__ = @as(c_int, 64);
pub const INT_FAST64_FMTd__ = "lld";
pub const INT_FAST64_FMTi__ = "lli";
pub const __UINT_FAST64_TYPE__ = c_ulonglong;
pub const __UINT_FAST64_MAX__ = @as(c_ulonglong, 18446744073709551615);
pub const UINT_FAST64_FMTo__ = "llo";
pub const UINT_FAST64_FMTu__ = "llu";
pub const UINT_FAST64_FMTx__ = "llx";
pub const UINT_FAST64_FMTX__ = "llX";
pub const __FLT16_DENORM_MIN__ = @as(f16, 5.9604644775390625e-8);
pub const __FLT16_HAS_DENORM__ = "";
pub const __FLT16_DIG__ = @as(c_int, 3);
pub const __FLT16_DECIMAL_DIG__ = @as(c_int, 5);
pub const __FLT16_EPSILON__ = @as(f16, 9.765625e-4);
pub const __FLT16_HAS_INFINITY__ = "";
pub const __FLT16_HAS_QUIET_NAN__ = "";
pub const __FLT16_MANT_DIG__ = @as(c_int, 11);
pub const __FLT16_MAX_10_EXP__ = @as(c_int, 4);
pub const __FLT16_MAX_EXP__ = @as(c_int, 16);
pub const __FLT16_MAX__ = @as(f16, 6.5504e+4);
pub const __FLT16_MIN_10_EXP__ = -@as(c_int, 4);
pub const __FLT16_MIN_EXP__ = -@as(c_int, 13);
pub const __FLT16_MIN__ = @as(f16, 6.103515625e-5);
pub const __FLT_DENORM_MIN__ = @as(f32, 1.40129846e-45);
pub const __FLT_HAS_DENORM__ = "";
pub const __FLT_DIG__ = @as(c_int, 6);
pub const __FLT_DECIMAL_DIG__ = @as(c_int, 9);
pub const __FLT_EPSILON__ = @as(f32, 1.19209290e-7);
pub const __FLT_HAS_INFINITY__ = "";
pub const __FLT_HAS_QUIET_NAN__ = "";
pub const __FLT_MANT_DIG__ = @as(c_int, 24);
pub const __FLT_MAX_10_EXP__ = @as(c_int, 38);
pub const __FLT_MAX_EXP__ = @as(c_int, 128);
pub const __FLT_MAX__ = @as(f32, 3.40282347e+38);
pub const __FLT_MIN_10_EXP__ = -@as(c_int, 37);
pub const __FLT_MIN_EXP__ = -@as(c_int, 125);
pub const __FLT_MIN__ = @as(f32, 1.17549435e-38);
pub const __DBL_DENORM_MIN__ = @as(f64, 4.9406564584124654e-324);
pub const __DBL_HAS_DENORM__ = "";
pub const __DBL_DIG__ = @as(c_int, 15);
pub const __DBL_DECIMAL_DIG__ = @as(c_int, 17);
pub const __DBL_EPSILON__ = @as(f64, 2.2204460492503131e-16);
pub const __DBL_HAS_INFINITY__ = "";
pub const __DBL_HAS_QUIET_NAN__ = "";
pub const __DBL_MANT_DIG__ = @as(c_int, 53);
pub const __DBL_MAX_10_EXP__ = @as(c_int, 308);
pub const __DBL_MAX_EXP__ = @as(c_int, 1024);
pub const __DBL_MAX__ = @as(f64, 1.7976931348623157e+308);
pub const __DBL_MIN_10_EXP__ = -@as(c_int, 307);
pub const __DBL_MIN_EXP__ = -@as(c_int, 1021);
pub const __DBL_MIN__ = @as(f64, 2.2250738585072014e-308);
pub const __LDBL_DENORM_MIN__ = @as(c_longdouble, 3.64519953188247460253e-4951);
pub const __LDBL_HAS_DENORM__ = "";
pub const __LDBL_DIG__ = @as(c_int, 18);
pub const __LDBL_DECIMAL_DIG__ = @as(c_int, 21);
pub const __LDBL_EPSILON__ = @as(c_longdouble, 1.08420217248550443401e-19);
pub const __LDBL_HAS_INFINITY__ = "";
pub const __LDBL_HAS_QUIET_NAN__ = "";
pub const __LDBL_MANT_DIG__ = @as(c_int, 64);
pub const __LDBL_MAX_10_EXP__ = @as(c_int, 4932);
pub const __LDBL_MAX_EXP__ = @as(c_int, 16384);
pub const __LDBL_MAX__ = @as(c_longdouble, 1.18973149535723176502e+4932);
pub const __LDBL_MIN_10_EXP__ = -@as(c_int, 4931);
pub const __LDBL_MIN_EXP__ = -@as(c_int, 16381);
pub const __LDBL_MIN__ = @as(c_longdouble, 3.36210314311209350626e-4932);
pub const __FLT_EVAL_METHOD__ = @as(c_int, 0);
pub const __FLT_RADIX__ = @as(c_int, 2);
pub const __DECIMAL_DIG__ = __LDBL_DECIMAL_DIG__;
pub const __pic__ = @as(c_int, 2);
pub const __PIC__ = @as(c_int, 2);
pub const NDEBUG = @as(c_int, 1);
pub const __MSVCRT_VERSION__ = @as(c_int, 0xE00);
pub const _WIN32_WINNT = @as(c_int, 0x0a00);
pub const MA_NO_ENCODING = "";
pub const MA_NO_GENERATION = "";
pub const MA_NO_DECODING = "";
pub const miniaudio_h = "";
pub const MA_STRINGIFY = @compileError("unable to translate C expr: unexpected token ''"); // H:\Dev\carminium-\native\.\miniaudio.h:3745:9
pub inline fn MA_XSTRINGIFY(x: anytype) @TypeOf(MA_STRINGIFY(x)) {
    _ = &x;
    return MA_STRINGIFY(x);
}
pub const MA_VERSION_MAJOR = @as(c_int, 0);
pub const MA_VERSION_MINOR = @as(c_int, 11);
pub const MA_VERSION_REVISION = @as(c_int, 25);
pub const MA_VERSION_STRING = MA_XSTRINGIFY(MA_VERSION_MAJOR) ++ "." ++ MA_XSTRINGIFY(MA_VERSION_MINOR) ++ "." ++ MA_XSTRINGIFY(MA_VERSION_REVISION);
pub const MA_SIZEOF_PTR = @as(c_int, 8);
pub const __STDC_VERSION_STDDEF_H__ = @as(c_long, 202311);
pub const NULL = __helpers.cast(?*anyopaque, @as(c_int, 0));
pub const offsetof = @compileError("unable to translate macro: undefined identifier `__builtin_offsetof`"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stddef.h:18:9
pub const MA_TRUE = @as(c_int, 1);
pub const MA_FALSE = @as(c_int, 0);
pub const MA_SIZE_MAX = __helpers.promoteIntLiteral(c_int, 0xFFFFFFFF, .hex);
pub const MA_UINT64_MAX = (__helpers.cast(ma_uint64, __helpers.promoteIntLiteral(c_int, 0xFFFFFFFF, .hex)) << @as(c_int, 32)) | __helpers.cast(ma_uint64, __helpers.promoteIntLiteral(c_int, 0xFFFFFFFF, .hex));
pub const MA_WIN32 = "";
pub const MA_WIN32_DESKTOP = "";
pub const MA_FALLTHROUGH = @compileError("unable to translate macro: undefined identifier `fallthrough`"); // H:\Dev\carminium-\native\.\miniaudio.h:3964:17
pub const MA_GNUC_INLINE_HINT = @compileError("unable to translate C expr: unexpected token 'inline'"); // H:\Dev\carminium-\native\.\miniaudio.h:3991:17
pub const MA_INLINE = @compileError("unable to translate macro: undefined identifier `always_inline`"); // H:\Dev\carminium-\native\.\miniaudio.h:3995:17
pub const MA_NO_INLINE = @compileError("unable to translate macro: undefined identifier `noinline`"); // H:\Dev\carminium-\native\.\miniaudio.h:3996:17
pub const MA_API = @compileError("unable to translate C expr: unexpected token 'extern'"); // H:\Dev\carminium-\native\.\miniaudio.h:4036:17
pub const MA_PRIVATE = @compileError("unable to translate C expr: unexpected token 'static'"); // H:\Dev\carminium-\native\.\miniaudio.h:4044:17
pub const MA_SIMD_ALIGNMENT = @as(c_int, 32);
pub const alignas = @compileError("unable to translate C expr: unexpected token '_Alignas'"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdalign.h:6:9
pub const alignof = @compileError("unable to translate C expr: expected '(' instead got ''"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdalign.h:7:9
pub const __alignas_is_defined = @as(c_int, 1);
pub const __alignof_is_defined = @as(c_int, 1);
pub const MA_ATOMIC = @compileError("unable to translate C expr: unexpected token '_Alignas'"); // H:\Dev\carminium-\native\.\miniaudio.h:4113:13
pub const MA_MIN_CHANNELS = @as(c_int, 1);
pub const MA_MAX_CHANNELS = @as(c_int, 254);
pub const MA_MAX_FILTER_ORDER = @as(c_int, 8);
pub const MA_ATOMIC_SAFE_TYPE_DECL = @compileError("unable to translate macro: undefined identifier `ma_`"); // H:\Dev\carminium-\native\.\miniaudio.h:4428:9
pub const MA_ATOMIC_SAFE_TYPE_DECL_PTR = @compileError("unable to translate macro: undefined identifier `ma_`"); // H:\Dev\carminium-\native\.\miniaudio.h:4434:9
pub const __STDC_VERSION_STDARG_H__ = @as(c_int, 0);
pub const va_start = @compileError("unable to translate macro: undefined identifier `__builtin_va_start`"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdarg.h:12:9
pub const va_end = @compileError("unable to translate macro: undefined identifier `__builtin_va_end`"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdarg.h:14:9
pub const va_arg = @compileError("unable to translate macro: undefined identifier `__builtin_va_arg`"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdarg.h:15:9
pub const __va_copy = @compileError("unable to translate macro: undefined identifier `__builtin_va_copy`"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdarg.h:18:9
pub const va_copy = @compileError("unable to translate macro: undefined identifier `__builtin_va_copy`"); // C:\Users\rezen\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.16.0\lib\compiler\aro\include\stdarg.h:22:9
pub const __GNUC_VA_LIST = @as(c_int, 1);
pub const MA_ATTRIBUTE_FORMAT = @compileError("unable to translate macro: undefined identifier `format`"); // H:\Dev\carminium-\native\.\miniaudio.h:4525:17
pub const MA_MAX_LOG_CALLBACKS = @as(c_int, 4);
pub const MA_CHANNEL_INDEX_NULL = @as(c_int, 255);
pub const MA_DATA_SOURCE_SELF_MANAGED_RANGE_AND_LOOP_POINT = @as(c_int, 0x00000001);
pub const MA_SUPPORT_WASAPI = "";
pub const MA_SUPPORT_DSOUND = "";
pub const MA_SUPPORT_WINMM = "";
pub const MA_SUPPORT_JACK = "";
pub const MA_SUPPORT_CUSTOM = "";
pub const MA_SUPPORT_NULL = "";
pub const MA_HAS_WASAPI = "";
pub const MA_HAS_DSOUND = "";
pub const MA_HAS_WINMM = "";
pub const MA_HAS_JACK = "";
pub const MA_HAS_CUSTOM = "";
pub const MA_HAS_NULL = "";
pub const MA_BACKEND_COUNT = ma_backend_null + @as(c_int, 1);
pub const MA_DATA_FORMAT_FLAG_EXCLUSIVE_MODE = @as(c_uint, 1) << @as(c_int, 1);
pub const MA_MAX_DEVICE_NAME_LENGTH = @as(c_int, 255);
pub const MA_NO_RESOURCE_MANAGER = "";
pub const MA_MAX_NODE_BUS_COUNT = @as(c_int, 254);
pub const MA_MAX_NODE_LOCAL_BUS_COUNT = @as(c_int, 2);
pub const MA_NODE_BUS_COUNT_UNKNOWN = @as(c_int, 255);
pub const MA_ENGINE_MAX_LISTENERS = @as(c_int, 4);
pub const MA_LISTENER_INDEX_CLOSEST = __helpers.cast(ma_uint8, -@as(c_int, 1));
pub const MA_SOUND_SOURCE_CHANNEL_COUNT = __helpers.promoteIntLiteral(c_int, 0xFFFFFFFF, .hex);
