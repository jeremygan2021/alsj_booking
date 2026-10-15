#pragma once

#include <cstdint>

// Updated under AudioService's queue mutex. An old in-flight decode/output can
// never complete a new task, and decode/output errors cannot look like drain.
struct TaskPlaybackProgress {
    uint32_t id = 0, written_frames = 0;
    bool tail_complete = false;
    const char* error = "";

    void Begin(uint32_t playback_id) { *this = {playback_id, 0, false, ""}; }
    bool Record(uint32_t playback_id, bool fence, bool success) {
        if (id == 0 || id != playback_id || tail_complete || *error)
            return false;
        if (!success)
            error = "output_error";
        else if (fence)
            tail_complete = true;
        else
            ++written_frames;
        return true;
    }
    bool DecodeFailed(uint32_t playback_id) {
        if (id == 0 || id != playback_id || *error)
            return false;
        error = "decode_error";
        return true;
    }
};

// Conservative silence fence: cover even a stereo DMA ring when codec input
// is mono, plus 20 ms for the ES8311 digital path. Written by the output task,
// without sleeping the application/audio callback or changing codec settings.
constexpr uint32_t PlaybackTailFenceSamples(uint32_t rate, uint32_t descriptors, uint32_t frames) {
    return 2 * descriptors * frames + (rate + 49) / 50;
}
