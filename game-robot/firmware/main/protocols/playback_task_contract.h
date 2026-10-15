#pragma once

#include <cJSON.h>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>

namespace persona {
struct PlaybackRequest {
    std::string session, id, state, control, mission;
    uint32_t expected_frames = 0, timeout_ms = 0;
};

inline bool PlaybackText(const cJSON* root, const char* key, std::string& value, size_t limit) {
    const auto field = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(field) || !field->valuestring || !*field->valuestring ||
        std::strlen(field->valuestring) > limit)
        return false;
    value = field->valuestring;
    return true;
}

inline bool PlaybackInteger(const cJSON* root, const char* key, uint32_t& value, uint32_t minimum,
                            uint32_t maximum) {
    const auto field = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsNumber(field) || !std::isfinite(field->valuedouble) ||
        field->valuedouble < minimum || field->valuedouble > maximum ||
        std::floor(field->valuedouble) != field->valuedouble)
        return false;
    value = static_cast<uint32_t>(field->valuedouble);
    return true;
}

inline bool ParsePlaybackRequest(const cJSON* root, const std::string& session,
                                 PlaybackRequest& out) {
    PlaybackRequest value;
    std::string type, format;
    if (session.empty() || !PlaybackText(root, "type", type, 32) || type != "playback.task" ||
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
            !PlaybackInteger(root, "expected_frames", value.expected_frames, 1, 10000) ||
            !PlaybackInteger(root, "timeout_ms", value.timeout_ms, 1000, 600000))
            return false;
    } else if (value.state != "end" && value.state != "cancel") {
        return false;
    }
    out = std::move(value);
    return true;
}

// One current/last task, never a playback backlog. Access from Application's
// network and main callbacks is protected by its audio gate.
class PlaybackTask {
public:
    void Start(const PlaybackRequest& request, uint32_t local_id, int64_t now_ms) {
        request_ = request;
        local_id_ = local_id;
        deadline_ms_ = now_ms + request.timeout_ms;
        received_ = written_ = 0;
        state_ = "received";
        reason_.clear();
        active_ = true;
        ended_ = fence_queued_ = false;
    }
    bool Matches(const PlaybackRequest& request) const {
        return request_.session == request.session && request_.id == request.id && !state_.empty();
    }
    bool AcceptFrame(size_t bytes) {
        if (!active_)
            return false;
        if (ended_ || received_ >= request_.expected_frames) {
            Fail("frame_mismatch");
            return false;
        }
        if (bytes == 0 || bytes > 4096) {
            Fail("invalid_frame");
            return false;
        }
        ++received_;
        return true;
    }
    void End() {
        if (!active_)
            return;
        ended_ = true;
        if (received_ != request_.expected_frames)
            Fail("frame_mismatch");
    }
    void Progress(uint32_t local_id, uint32_t written, bool tail_complete,
                  const std::string& error) {
        if (!active_ || local_id != local_id_)
            return;
        if (!error.empty()) {
            Fail(error);
            return;
        }
        written_ = written;
        if (written_)
            state_ = "playing";
        if (tail_complete) {
            if (ended_ && fence_queued_ && received_ == request_.expected_frames &&
                written_ == received_) {
                state_ = "completed";
                active_ = false;
            } else {
                Fail("frame_mismatch");
            }
        }
    }
    void CheckTimeout(int64_t now_ms) {
        if (active_ && now_ms >= deadline_ms_)
            Fail("timeout");
    }
    void Fail(const std::string& reason) {
        if (!active_)
            return;
        state_ = "failed";
        reason_ = reason;
        active_ = false;
    }
    void Cancel(const std::string& reason) {
        if (!active_)
            return;
        state_ = "cancelled";
        reason_ = reason;
        active_ = false;
    }
    bool NeedsFence() const { return active_ && ended_ && !fence_queued_; }
    void FenceQueued() { fence_queued_ = true; }
    bool Active() const { return active_; }
    uint32_t LocalId() const { return local_id_; }
    const std::string& Session() const { return request_.session; }
    const std::string& Id() const { return request_.id; }
    const std::string& State() const { return state_; }
    cJSON* Ack() const {
        auto result = cJSON_CreateObject();
        cJSON_AddStringToObject(result, "type", "playback.ack");
        cJSON_AddStringToObject(result, "session_id", request_.session.c_str());
        cJSON_AddStringToObject(result, "task_id", request_.id.c_str());
        cJSON_AddStringToObject(result, "control_id", request_.control.c_str());
        cJSON_AddStringToObject(result, "mission_id", request_.mission.c_str());
        cJSON_AddStringToObject(result, "state", state_.c_str());
        cJSON_AddNumberToObject(result, "received_frames", received_);
        if (!reason_.empty())
            cJSON_AddStringToObject(result, "reason", reason_.c_str());
        return result;
    }

private:
    PlaybackRequest request_;
    std::string state_, reason_;
    uint32_t local_id_ = 0, received_ = 0, written_ = 0;
    int64_t deadline_ms_ = 0;
    bool active_ = false, ended_ = false, fence_queued_ = false;
};
}  // namespace persona
