#pragma once

namespace persona {
inline constexpr double kWheelDriveMinDurationSeconds = 0.4;
// Duration is selected by the user; the controller still stops at that deadline.
inline constexpr bool kWheelDriveDurationUnlimited = true;
}  // namespace persona
