#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>
#include "playback_progress.h"

struct WakeResponseClip {
    std::string_view text;
    std::string_view sound;
};

inline size_t ChooseWakeResponse(uint32_t entropy, size_t previous, size_t count) {
    if (count <= 1)
        return 0;
    if (previous >= count)
        return entropy % count;
    const size_t candidate = entropy % (count - 1);
    return candidate >= previous ? candidate + 1 : candidate;
}

// Application owns this gate on its main task. A drained queue alone never
// opens the microphone: every decoded frame and the codec's DMA tail must finish.
class WakeResponseGate {
public:
    enum class Action { Idle, Wait, QueueTail, Complete, Failed };
    bool Begin(uint32_t id, uint32_t frames, int64_t now_ms) {
        if (active() || !id || !frames || frames > 40)
            return false;
        id_ = id;
        frames_ = frames;
        deadline_ms_ = now_ms + 4000;
        tail_queued_ = false;
        return true;
    }
    Action Advance(const TaskPlaybackProgress& progress, bool drained, int64_t now_ms) const {
        if (!active())
            return Action::Idle;
        if (progress.id != id_ || *progress.error || now_ms >= deadline_ms_ ||
            progress.written_frames > frames_)
            return Action::Failed;
        if (progress.tail_complete)
            return progress.written_frames == frames_ ? Action::Complete : Action::Failed;
        if (!drained)
            return Action::Wait;
        if (progress.written_frames != frames_)
            return Action::Failed;
        return tail_queued_ ? Action::Wait : Action::QueueTail;
    }
    void TailQueued() { tail_queued_ = true; }
    void Cancel() { id_ = frames_ = 0; }
    bool active() const { return id_ != 0; }
    uint32_t id() const { return id_; }

private:
    uint32_t id_ = 0, frames_ = 0;
    int64_t deadline_ms_ = 0;
    bool tail_queued_ = false;
};
