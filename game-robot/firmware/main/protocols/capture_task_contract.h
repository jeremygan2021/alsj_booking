#pragma once

#include "playback_task_contract.h"

namespace persona {
struct CaptureRequest {
    std::string session, id, state, control, mission;
    uint32_t timeout_ms = 0;
};

inline bool ParseCaptureRequest(const cJSON* root, const std::string& session,
                                CaptureRequest& out) {
    CaptureRequest value;
    std::string type, format;
    if (session.empty() || !PlaybackText(root, "type", type, 32) || type != "capture.task" ||
        !PlaybackText(root, "session_id", value.session, 128) || value.session != session ||
        !PlaybackText(root, "task_id", value.id, 128) ||
        !PlaybackText(root, "state", value.state, 16))
        return false;
    if (value.state == "start") {
        uint32_t rate, channels, duration;
        if (!PlaybackText(root, "control_id", value.control, 128) ||
            !PlaybackText(root, "mission_id", value.mission, 128) ||
            !PlaybackText(root, "format", format, 16) || format != "opus" ||
            !PlaybackInteger(root, "sample_rate", rate, 16000, 16000) ||
            !PlaybackInteger(root, "channels", channels, 1, 1) ||
            !PlaybackInteger(root, "frame_duration", duration, 60, 60) ||
            !PlaybackInteger(root, "timeout_ms", value.timeout_ms, 1000, 60000))
            return false;
    } else if (value.state != "end" && value.state != "cancel") {
        return false;
    }
    out = std::move(value);
    return true;
}

// Main-task-owned state. Starting this object means capture setup succeeded;
// an incoming network start alone is never evidence that the microphone runs.
class CaptureTask {
public:
    void Start(const CaptureRequest& request, uint32_t input_generation, int64_t now_ms) {
        request_ = request;
        input_generation_ = input_generation;
        deadline_ms_ = now_ms + request.timeout_ms;
        sent_frames_ = 0;
        state_ = "listening";
        reason_.clear();
        active_ = true;
    }
    bool Matches(const CaptureRequest& request) const {
        return request_.session == request.session && request_.id == request.id && !state_.empty();
    }
    bool AcceptsFrame(uint32_t input_generation, int64_t now_ms) const {
        return active_ && input_generation == input_generation_ && now_ms < deadline_ms_;
    }
    void FrameSent() {
        if (active_)
            ++sent_frames_;
    }
    void End() { Finish("completed", ""); }
    void Cancel(const std::string& reason) { Finish("cancelled", reason); }
    void Fail(const std::string& reason) { Finish("failed", reason); }
    void CheckTimeout(int64_t now_ms) {
        if (active_ && now_ms >= deadline_ms_)
            Fail("timeout");
    }
    bool Active() const { return active_; }
    const std::string& State() const { return state_; }
    cJSON* Ack() const {
        auto result = cJSON_CreateObject();
        cJSON_AddStringToObject(result, "type", "capture.ack");
        cJSON_AddStringToObject(result, "session_id", request_.session.c_str());
        cJSON_AddStringToObject(result, "task_id", request_.id.c_str());
        cJSON_AddStringToObject(result, "control_id", request_.control.c_str());
        cJSON_AddStringToObject(result, "mission_id", request_.mission.c_str());
        cJSON_AddStringToObject(result, "state", state_.c_str());
        cJSON_AddNumberToObject(result, "sent_frames", sent_frames_);
        if (!reason_.empty())
            cJSON_AddStringToObject(result, "reason", reason_.c_str());
        return result;
    }

private:
    void Finish(const char* state, const std::string& reason) {
        if (!active_)
            return;
        state_ = state;
        reason_ = reason;
        active_ = false;
    }
    CaptureRequest request_;
    std::string state_, reason_;
    uint32_t input_generation_ = 0, sent_frames_ = 0;
    int64_t deadline_ms_ = 0;
    bool active_ = false;
};
}  // namespace persona
