#pragma once

#include <cJSON.h>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>

namespace persona {
struct MissionStatus {
    std::string session, id, title, state, message;
    uint32_t revision = 0;
    bool pause = false, resume = false, cancel = false;
};

inline bool MissionText(const cJSON* root, const char* key, std::string& result, size_t limit,
                        bool empty = false) {
    const auto value = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(value) || !value->valuestring || (!empty && !*value->valuestring) ||
        std::strlen(value->valuestring) > limit)
        return false;
    result = value->valuestring;
    return true;
}

inline bool KnownMissionState(const std::string& state) {
    for (auto name :
         {"idle", "draft", "approved", "running", "waiting_tool", "waiting_dialogue", "paused",
          "recovery_required", "cancelling", "cancelled", "succeeded", "failed", "unknown"})
        if (state == name)
            return true;
    return false;
}

inline bool ParseMissionStatus(const cJSON* root, const std::string& session, MissionStatus& out) {
    MissionStatus value;
    std::string type;
    if (session.empty() || !MissionText(root, "type", type, 40) || type != "mission.status" ||
        !MissionText(root, "session_id", value.session, 128) || value.session != session ||
        !MissionText(root, "mission_id", value.id, 128, true) ||
        !MissionText(root, "title", value.title, 192, true) ||
        !MissionText(root, "state", value.state, 32) || !KnownMissionState(value.state))
        return false;
    const auto revision = cJSON_GetObjectItemCaseSensitive(root, "revision");
    const auto controls = cJSON_GetObjectItemCaseSensitive(root, "controls");
    const auto pause = cJSON_GetObjectItemCaseSensitive(controls, "pause");
    const auto resume = cJSON_GetObjectItemCaseSensitive(controls, "resume");
    const auto cancel = cJSON_GetObjectItemCaseSensitive(controls, "cancel");
    if (!cJSON_IsNumber(revision) || !std::isfinite(revision->valuedouble) ||
        revision->valuedouble < 0 || revision->valuedouble > 2147483647.0 ||
        std::floor(revision->valuedouble) != revision->valuedouble || !cJSON_IsObject(controls) ||
        !cJSON_IsBool(pause) || !cJSON_IsBool(resume) || !cJSON_IsBool(cancel))
        return false;
    value.revision = static_cast<uint32_t>(revision->valuedouble);
    value.pause = cJSON_IsTrue(pause);
    value.resume = cJSON_IsTrue(resume);
    value.cancel = cJSON_IsTrue(cancel);
    const auto message = cJSON_GetObjectItemCaseSensitive(root, "message");
    if (message && !MissionText(root, "message", value.message, 384, true))
        return false;
    if (value.state == "idle") {
        if (!value.id.empty() || !value.title.empty() || value.pause || value.resume ||
            value.cancel)
            return false;
    } else if (value.id.empty() || value.title.empty()) {
        return false;
    }
    if (value.pause && value.resume)
        return false;
    out = std::move(value);
    return true;
}

// A voice turn can be interrupted without retiring the mission. Only a transport
// close invalidates its controls; a fresh session may restore the same revision.
class MissionViewState {
public:
    bool Apply(const MissionStatus& value) {
        if (received_ && value.session == status_.session && value.id == status_.id &&
            value.revision <= status_.revision)
            return false;
        status_ = value;
        connected_ = received_ = true;
        pending_ = false;
        return true;
    }
    void Disconnect() { connected_ = false; }
    void Submitted() { pending_ = true; }
    bool CanControl(const std::string& action) const {
        if (!connected_ || pending_ || status_.id.empty())
            return false;
        return action == "pause"    ? status_.pause
               : action == "resume" ? status_.resume
               : action == "cancel" ? status_.cancel
                                    : false;
    }
    bool Connected() const { return connected_; }
    const MissionStatus& Status() const { return status_; }

private:
    MissionStatus status_;
    bool received_ = false, connected_ = false, pending_ = false;
};

inline const char* MissionStateLabel(const std::string& state) {
    if (state == "draft")
        return "待确认";
    if (state == "approved")
        return "已确认";
    if (state == "running")
        return "执行中";
    if (state == "waiting_tool")
        return "等待工具";
    if (state == "waiting_dialogue")
        return "等待对话";
    if (state == "paused")
        return "已暂停";
    if (state == "recovery_required")
        return "等待恢复";
    if (state == "cancelling")
        return "正在取消";
    if (state == "cancelled")
        return "已取消";
    if (state == "succeeded")
        return "已完成";
    if (state == "failed")
        return "任务失败";
    if (state == "unknown")
        return "状态待确认";
    return "无任务";
}

inline cJSON* RobotStopEvent(const std::string& request) {
    if (request.empty() || request.size() > 128)
        return nullptr;
    auto event = cJSON_CreateObject();
    cJSON_AddStringToObject(event, "type", "robot.stop");
    cJSON_AddStringToObject(event, "request_id", request.c_str());
    cJSON_AddStringToObject(event, "source", "touch");
    return event;
}

inline cJSON* MissionControlEvent(const MissionViewState& view, const std::string& action,
                                  const std::string& request) {
    if (!view.CanControl(action) || request.empty() || request.size() > 128)
        return nullptr;
    const auto& status = view.Status();
    auto event = cJSON_CreateObject();
    cJSON_AddStringToObject(event, "type", "mission.control");
    cJSON_AddStringToObject(event, "session_id", status.session.c_str());
    cJSON_AddStringToObject(event, "mission_id", status.id.c_str());
    cJSON_AddNumberToObject(event, "revision", status.revision);
    cJSON_AddStringToObject(event, "action", action.c_str());
    cJSON_AddStringToObject(event, "request_id", request.c_str());
    return event;
}
}  // namespace persona
