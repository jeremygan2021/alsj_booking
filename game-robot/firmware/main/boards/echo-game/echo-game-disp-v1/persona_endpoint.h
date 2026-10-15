#pragma once
#include <string_view>
namespace persona {
inline constexpr char kServerEndpoint[] = "wss://alsj.luna.ski/echo/ws/device";
inline constexpr char kDraftServerEndpoint[] = "ws://6.6.6.66:8901/ws/device";
inline constexpr int kServerEndpointRevision = 2;
inline bool NeedsServerEndpointUpdate(std::string_view saved, int revision) {
    return saved.empty() || (revision < kServerEndpointRevision && saved == kDraftServerEndpoint);
}
}  // namespace persona
