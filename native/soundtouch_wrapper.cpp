/**
 * Carminium — SoundTouch C wrapper implementation
 *
 * 许可证: LGPL v2.1 (与 SoundTouch 一致)
 */
#include "soundtouch_wrapper.h"

#include "SoundTouch.h"
#include <new>

using namespace soundtouch;

struct StWrapper {
    SoundTouch st;
};

extern "C" {

void* st_create(uint32_t sampleRate, uint32_t channels) {
    StWrapper* w = new (std::nothrow) StWrapper();
    if (!w) return nullptr;
    w->st.setSampleRate(sampleRate);
    w->st.setChannels(channels);
    // 默认 sequence/pitch 窗口参数（适合音乐）
    w->st.setSetting(SETTING_SEQUENCE_MS, 82);
    w->st.setSetting(SETTING_SEEKWINDOW_MS, 28);
    w->st.setSetting(SETTING_OVERLAP_MS, 12);
    return w;
}

void st_destroy(void* handle) {
    if (!handle) return;
    delete static_cast<StWrapper*>(handle);
}

void st_set_tempo(void* handle, float tempo) {
    if (!handle) return;
    static_cast<StWrapper*>(handle)->st.setTempo(tempo);
}

void st_set_pitch(void* handle, float pitch) {
    if (!handle) return;
    static_cast<StWrapper*>(handle)->st.setPitch(pitch);
}

void st_set_rate(void* handle, float rate) {
    if (!handle) return;
    static_cast<StWrapper*>(handle)->st.setRate(rate);
}

uint32_t st_put_samples(void* handle, const float* samples, uint32_t frames) {
    if (!handle || !samples || frames == 0) return 0;
    static_cast<StWrapper*>(handle)->st.putSamples(samples, frames);
    return frames;
}

uint32_t st_receive_samples(void* handle, float* out, uint32_t maxFrames) {
    if (!handle || !out || maxFrames == 0) return 0;
    return static_cast<StWrapper*>(handle)->st.receiveSamples(out, maxFrames);
}

uint32_t st_num_samples(void* handle) {
    if (!handle) return 0;
    return static_cast<StWrapper*>(handle)->st.numSamples();
}

void st_clear(void* handle) {
    if (!handle) return;
    static_cast<StWrapper*>(handle)->st.clear();
}

void st_flush(void* handle) {
    if (!handle) return;
    static_cast<StWrapper*>(handle)->st.flush();
}

int st_is_empty(void* handle) {
    if (!handle) return 1;
    return static_cast<StWrapper*>(handle)->st.isEmpty() ? 1 : 0;
}

}  // extern "C"
