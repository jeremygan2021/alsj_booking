#pragma once

#include <cmath>
#include "mission_contract.h"
#include "wheel_drive_limits.h"

namespace persona {
struct WheelDriveStatus {
    std::string request, state, direction, message;
    bool has_duration = false;
    double duration_s = 0;
};

// Status only: motor goals and credentials never enter the ESP32 firmware.
inline bool ParseWheelDriveStatus(const cJSON* root, const std::string& session,
                                  WheelDriveStatus& status) {
    std::string type, incoming;
    if (session.empty() || !MissionText(root, "type", type, 40) || type != "robot.drive.status" ||
        !MissionText(root, "session_id", incoming, 128) || incoming != session ||
        !MissionText(root, "request_id", status.request, 128) ||
        !MissionText(root, "state", status.state, 32) ||
        !MissionText(root, "direction", status.direction, 16) ||
        !MissionText(root, "message", status.message, 384))
        return false;
    status.has_duration = false;
    status.duration_s = 0;
    const auto duration = cJSON_GetObjectItemCaseSensitive(root, "duration_s");
    if (duration) {
        if (!cJSON_IsNumber(duration) || !std::isfinite(duration->valuedouble) ||
            duration->valuedouble < kWheelDriveMinDurationSeconds)
            return false;
        status.has_duration = true;
        status.duration_s = duration->valuedouble;
    }
    return (status.state == "running" || status.state == "succeeded" || status.state == "failed") &&
           (status.direction == "forward" || status.direction == "backward" ||
            status.direction == "left" || status.direction == "right");
}
}  // namespace persona
