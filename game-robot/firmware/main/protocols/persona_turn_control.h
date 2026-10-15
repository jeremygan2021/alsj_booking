#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <deque>
#include <string>
#include "device_state.h"

namespace persona {

inline bool IsCurrentMcpRequest(uint32_t received_generation, uint32_t current_generation,
                                const std::string& received_session,
                                const std::string& current_session, bool channel_open) {
    return received_generation == current_generation && channel_open && !received_session.empty() &&
           received_session == current_session;
}

enum class ClosedSessionAction { Ignore, KeepConnecting, KeepLocalTest, KeepWakeResponse, Idle };
inline ClosedSessionAction ClosedSessionPolicy(const std::string& closed,
                                               const std::string& current, DeviceState state,
                                               bool wake_response_active = false) {
    if (!current.empty() && current != closed)
        return ClosedSessionAction::Ignore;
    if (state == kDeviceStateConnecting)
        return wake_response_active ? ClosedSessionAction::KeepWakeResponse
                                    : ClosedSessionAction::KeepConnecting;
    if (state == kDeviceStateAudioTesting)
        return ClosedSessionAction::KeepLocalTest;
    return ClosedSessionAction::Idle;
}
inline bool CanStartPersonaTurn(DeviceState state) {
    return state == kDeviceStateIdle || state == kDeviceStateListening ||
           state == kDeviceStateSpeaking;
}
// Ending a cloud conversation is not a local microphone mute. Standby may
// detect the keyword without running the voice processor or uploading audio.
inline bool ShouldArmStandbyWake(DeviceState state, bool agent_owned, bool audio_task,
                                 bool output_busy) {
    return state == kDeviceStateIdle && !agent_owned && !audio_task && !output_busy;
}
inline bool IsPersonaConversationActive(DeviceState state, bool playing, bool awaiting,
                                        bool model_busy) {
    return playing || awaiting || model_busy || state == kDeviceStateConnecting ||
           state == kDeviceStateListening || state == kDeviceStateSpeaking ||
           state == kDeviceStateNotifying;
}
inline unsigned ReconnectDelayMs(unsigned failed_attempt) {
    return 500U << std::min(failed_attempt, 3U);
}
inline bool RetryInterruptedSession(unsigned completed_attempts, int64_t elapsed_ms) {
    return completed_attempts < 9 && elapsed_ms < 30000;
}

// Turn state is main-task-only. The atomic generation may be read by callbacks.
// Network callbacks schedule updates through Application.
// Playback completion and permission to capture the next turn are separate.
class TurnControl {
public:
    void BeginSession(const std::string& session, bool enabled) {
        event_generation_.fetch_add(1);
        session_ = session;
        enabled_ = enabled;
        retired_.clear();
        ClearResponse();
    }

    uint32_t EventGeneration() const { return event_generation_.load(); }
    void EndSession() { BeginSession("", false); }
    bool IsCurrentEvent(uint32_t generation) const { return generation == EventGeneration(); }
    bool AcceptsEvent(const std::string& session, uint32_t generation) const {
        return IsCurrentEvent(generation) && !session.empty() && session == session_;
    }
    bool enabled() const { return enabled_; }
    bool MatchesSession(const std::string& session) const {
        return enabled_ && !session.empty() && session == session_;
    }
    const std::string& response() const { return response_; }

    bool Announce(const std::string& response) {
        if (!enabled_ || response.empty() || response.size() > 128 ||
            std::find(retired_.begin(), retired_.end(), response) != retired_.end()) {
            return false;
        }
        if (response != response_) {
            RetireCurrent();
            ClearResponse();
            response_ = response;
        }
        return true;
    }

    bool StartAudio(const std::string& response) {
        if (!Announce(response) || audio_started_) {
            return false;
        }
        audio_started_ = true;
        return true;
    }

    bool StopAudio(const std::string& response) {
        if (!enabled_ || response != response_ || !audio_started_ || stop_received_) {
            return false;
        }
        stop_received_ = true;
        return true;
    }

    std::string PlaybackDrained(bool idle) {
        if (!enabled_ || !idle || !stop_received_ || played_sent_) {
            return {};
        }
        played_sent_ = true;
        return response_;
    }

    bool GrantListening(const std::string& response) {
        if (!enabled_ || response.empty() || response != response_ || granted_ ||
            (audio_started_ && !played_sent_)) {
            return false;
        }
        granted_ = true;
        return true;
    }

    std::string ConsumeGrant() {
        if (!granted_) {
            return {};
        }
        auto response = response_;
        Abort(false);
        return response;
    }

    void Abort(bool invalidate_events = true) {
        if (invalidate_events)
            event_generation_.fetch_add(1);
        RetireCurrent();
        ClearResponse();
    }

private:
    void RetireCurrent() {
        if (!response_.empty()) {
            retired_.push_back(response_);
            if (retired_.size() > 16) {
                retired_.pop_front();
            }
        }
    }
    void ClearResponse() {
        response_.clear();
        audio_started_ = false;
        stop_received_ = false;
        played_sent_ = false;
        granted_ = false;
    }

    std::atomic<uint32_t> event_generation_{0};
    std::string session_;
    std::string response_;
    std::deque<std::string> retired_;
    bool enabled_ = false;
    bool audio_started_ = false;
    bool stop_received_ = false;
    bool played_sent_ = false;
    bool granted_ = false;
};

}  // namespace persona
