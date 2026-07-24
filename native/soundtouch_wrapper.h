/**
 * Carminium — SoundTouch C wrapper
 *
 * 将 soundtouch::SoundTouch C++ 类封装为纯 C API，供 Zig 调用。
 * 仅暴露 carminium_audio 需要的最小功能子集。
 *
 * 许可证: LGPL v2.1 (与 SoundTouch 一致)
 */
#ifndef CARMINIUM_SOUNDTOUCH_WRAPPER_H
#define CARMINIUM_SOUNDTOUCH_WRAPPER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 创建 SoundTouch 实例。sampleRate/channels 在创建时设置。 */
void* st_create(uint32_t sampleRate, uint32_t channels);

/* 销毁实例 */
void st_destroy(void* handle);

/* 设置 tempo (1.0 = 原速, 0.5 = 半速, 2.0 = 倍速) */
void st_set_tempo(void* handle, float tempo);

/* 设置 pitch (1.0 = 原调, 2.0 = 升一个八度) */
void st_set_pitch(void* handle, float pitch);

/* 设置 rate (同时影响 tempo 和 pitch, 1.0 = 原样) */
void st_set_rate(void* handle, float rate);

/* 输入 PCM (interleaved float32, frames 个采样帧)。
   返回实际接受的帧数（通常等于 frames）。 */
uint32_t st_put_samples(void* handle, const float* samples, uint32_t frames);

/* 从输出缓冲取处理后的 PCM。返回实际取到的帧数。 */
uint32_t st_receive_samples(void* handle, float* out, uint32_t maxFrames);

/* 当前可输出的帧数 */
uint32_t st_num_samples(void* handle);

/* 清空内部缓冲（seek 时调用） */
void st_clear(void* handle);

/* 刷出内部残留（曲末调用，可能产生额外静音） */
void st_flush(void* handle);

/* 是否有未处理的输入 */
int st_is_empty(void* handle);

#ifdef __cplusplus
}
#endif

#endif /* CARMINIUM_SOUNDTOUCH_WRAPPER_H */
