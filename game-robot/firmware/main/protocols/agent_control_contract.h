#pragma once

#include "playback_task_contract.h"

namespace persona {
struct AgentDialogueRequest {
    std::string session, control, mission, role, phase, text;
    uint32_t sequence = 0;
};
inline bool ParseAgentDialogueRequest(const cJSON* root, const std::string& session,
                                      AgentDialogueRequest& out) {
    AgentDialogueRequest value;
    std::string type;
    if (session.empty() || !PlaybackText(root, "type", type, 32) || type != "agent.dialogue" ||
        !PlaybackText(root, "session_id", value.session, 128) || value.session != session ||
        !PlaybackText(root, "control_id", value.control, 128) ||
        !PlaybackText(root, "mission_id", value.mission, 128) ||
        !PlaybackText(root, "role", value.role, 16) ||
        !PlaybackText(root, "phase", value.phase, 16) ||
        !PlaybackText(root, "text", value.text, 1024) ||
        !PlaybackInteger(root, "seq", value.sequence, 1, 2147483647))
        return false;
    if (value.role != "assistant" && value.role != "user" && value.role != "status")
        return false;
    if (value.phase != "waiting" && value.phase != "speaking" && value.phase != "listening" &&
        value.phase != "transcribing" && value.phase != "done")
        return false;
    out = std::move(value);
    return true;
}
struct AgentControlRequest {
    std::string session, control, mission, title, state;
    uint32_t revision = 0;
};
inline bool ParseAgentControlRequest(const cJSON* root, const std::string& session,
                                     AgentControlRequest& out) {
    AgentControlRequest value;
    std::string type;
    if (session.empty() || !PlaybackText(root, "type", type, 32) || type != "agent.control" ||
        !PlaybackText(root, "session_id", value.session, 128) || value.session != session ||
        !PlaybackText(root, "control_id", value.control, 128) ||
        !PlaybackText(root, "mission_id", value.mission, 128) ||
        !PlaybackText(root, "state", value.state, 16) ||
        !PlaybackInteger(root, "revision", value.revision, 0, 2147483647))
        return false;
    if (value.state == "start") {
        if (!PlaybackText(root, "title", value.title, 192))
            return false;
    } else if (value.state != "end") {
        return false;
    }
    out = std::move(value);
    return true;
}
class AgentControlTask {
public:
    bool Matches(const AgentControlRequest& value) const {
        return !state_.empty() && request_.session == value.session &&
               request_.control == value.control && request_.mission == value.mission;
    }
    void Start(const AgentControlRequest& value) {
        request_ = value;
        state_ = "acquired";
        reason_.clear();
        active_ = true;
        dialogue_sequence_ = 0;
    }
    void Release(const char* reason) {
        if (!active_)
            return;
        state_ = "released";
        reason_ = reason;
        active_ = false;
    }
    void Fail(const char* reason) {
        state_ = "failed";
        reason_ = reason;
        active_ = false;
    }
    bool Active() const { return active_; }
    bool AllowsTask(const std::string& session, const std::string& control,
                    const std::string& mission) const {
        return active_ && request_.session == session && request_.control == control &&
               request_.mission == mission;
    }
    bool AcceptDialogue(const AgentDialogueRequest& value) {
        if (!AllowsTask(value.session, value.control, value.mission) ||
            value.sequence <= dialogue_sequence_)
            return false;
        dialogue_sequence_ = value.sequence;
        return true;
    }
    const AgentControlRequest& Request() const { return request_; }
    cJSON* Event(const char* type) const {
        auto event = cJSON_CreateObject();
        cJSON_AddStringToObject(event, "type", type);
        cJSON_AddStringToObject(event, "session_id", request_.session.c_str());
        cJSON_AddStringToObject(event, "control_id", request_.control.c_str());
        cJSON_AddStringToObject(event, "mission_id", request_.mission.c_str());
        cJSON_AddNumberToObject(event, "revision", request_.revision);
        return event;
    }
    cJSON* Ack() const {
        auto event = Event("agent.control.ack");
        cJSON_AddStringToObject(event, "state", state_.c_str());
        if (!reason_.empty())
            cJSON_AddStringToObject(event, "reason", reason_.c_str());
        return event;
    }

private:
    AgentControlRequest request_;
    std::string state_, reason_;
    bool active_ = false;
    uint32_t dialogue_sequence_ = 0;
};
}  // namespace persona
