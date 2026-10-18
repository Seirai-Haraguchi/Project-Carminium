#ifndef CARMINIUM_SOUNDTOUCH_WRAPPER_H
#define CARMINIUM_SOUNDTOUCH_WRAPPER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void* st_create(uint32_t sampleRate, uint32_t channels);

void st_destroy(void* handle);

void st_set_tempo(void* handle, float tempo);

void st_set_pitch(void* handle, float pitch);

void st_set_rate(void* handle, float rate);

uint32_t st_put_samples(void* handle, const float* samples, uint32_t frames);

uint32_t st_receive_samples(void* handle, float* out, uint32_t maxFrames);

uint32_t st_num_samples(void* handle);

void st_clear(void* handle);

void st_flush(void* handle);

int st_is_empty(void* handle);

#ifdef __cplusplus
}
#endif

#endif
