#ifndef _APPLICATION_H_
#define _APPLICATION_H_

#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <freertos/task.h>

#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "audio/wake_response.h"
#include "audio_service.h"
#include "device_state.h"
#include "device_state_machine.h"
#include "notify/notify_player.h"
#include "ota.h"
#include "protocol.h"
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
#include "agent_control_contract.h"
#include "capture_task_contract.h"
#include "persona_turn_control.h"
#include "playback_task_contract.h"
#endif

// Main event bits
#define MAIN_EVENT_SCHEDULE (1 << 0)
#define MAIN_EVENT_SEND_AUDIO (1 << 1)
#define MAIN_EVENT_WAKE_WORD_DETECTED (1 << 2)
#define MAIN_EVENT_VAD_CHANGE (1 << 3)
#define MAIN_EVENT_ERROR (1 << 4)
#define MAIN_EVENT_ACTIVATION_DONE (1 << 5)
#define MAIN_EVENT_CLOCK_TICK (1 << 6)
#define MAIN_EVENT_NETWORK_CONNECTED (1 << 7)
#define MAIN_EVENT_NETWORK_DISCONNECTED (1 << 8)
#define MAIN_EVENT_TOGGLE_CHAT (1 << 9)
#define MAIN_EVENT_START_LISTENING (1 << 10)
#define MAIN_EVENT_STOP_LISTENING (1 << 11)
#define MAIN_EVENT_STATE_CHANGED (1 << 12)
#define MAIN_EVENT_PERSONA_OPENED (1 << 14)
#define MAIN_EVENT_PLAYBACK_DRAINED (1 << 13)
#define MAIN_EVENT_END_CONVERSATION (1 << 15)
#define MAIN_EVENT_TASK_PLAYBACK (1 << 16)
#define MAIN_EVENT_AGENT_RELEASE (1 << 17)

enum AecMode {
    kAecOff,
    kAecOnDeviceSide,
    kAecOnServerSide,
};

class Application {
public:
    static Application& GetInstance() {
        static Application instance;
        return instance;
    }
    // Delete copy constructor and assignment operator
    Application(const Application&) = delete;
    Application& operator=(const Application&) = delete;

    /**
     * Initialize the application
     * This sets up display, audio, network callbacks, etc.
     * Network connection starts asynchronously.
     */
    void Initialize();

    /**
     * Run the main event loop
     * This function runs in the main task and never returns.
     * It handles all events including network, state changes, and user interactions.
     */
    void Run();

    DeviceState GetDeviceState() const { return state_machine_.GetState(); }
    bool IsVoiceDetected() const { return audio_service_.IsVoiceDetected(); }

    /**
     * Request state transition
     * Returns true if transition was successful
     */
    bool SetDeviceState(DeviceState state);

    /**
     * Schedule a callback to be executed in the main task
     */
    void Schedule(std::function<void()>&& callback);

    /**
     * Alert with status, message, emotion and optional sound
     */
    void Alert(const char* status, const char* message, const char* emotion = "",
               const std::string_view& sound = "");
    void DismissAlert();

    void AbortSpeaking(AbortReason reason);

    /**
     * Toggle chat state (event-based, thread-safe)
     * Sends MAIN_EVENT_TOGGLE_CHAT to be handled in Run()
     */
    void ToggleChatState();

    /**
     * Start listening (event-based, thread-safe)
     * Sends MAIN_EVENT_START_LISTENING to be handled in Run()
     */
    void StartListening();

    /**
     * Stop listening (event-based, thread-safe)
     * Sends MAIN_EVENT_STOP_LISTENING to be handled in Run()
     */
    void StopListening();

    void Reboot();
    void WakeWordInvoke(const std::string& wake_word);
    bool UpgradeFirmware(const std::string& url, const std::string& version = "");
    bool CanEnterSleepMode();
    bool SendDeviceEvent(const cJSON* event);
    void SendMcpMessage(const std::string& payload);
    void RegisterMcpBroadcastCallback(std::function<void(const std::string&)> callback);
    void SetAecMode(AecMode mode);
    AecMode GetAecMode() const { return aec_mode_; }
    void PlaySound(const std::string_view& sound);
    AudioService& GetAudioService() { return audio_service_; }
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    // End cloud capture/playback; local standby wake remains available.
    void EndConversation();
    void ReleaseAgentControl(uint32_t local_epoch);
    // Application-task only: management requests never grant microphone capture.
    bool SendManagementEvent(const cJSON* event);
    bool IsConversationStopped() const { return persona_user_stopped_.load(); }
    uint32_t GetPersonaEventGeneration() const { return persona_turn_.EventGeneration(); }
    bool IsPersonaMessageCurrent(const std::string& session, uint32_t generation) const {
        return persona_turn_.AcceptsEvent(session, generation);
    }
#endif

    /**
     * Reset protocol resources (thread-safe)
     * Can be called from any task to release resources allocated after network connected
     * This includes closing audio channel, resetting protocol and ota objects
     */
    void ResetProtocol();

private:
    Application();
    ~Application();

    std::mutex mutex_;
    std::deque<std::function<void()>> main_tasks_;
    std::unique_ptr<Protocol> protocol_;
    EventGroupHandle_t event_group_ = nullptr;
    esp_timer_handle_t clock_timer_handle_ = nullptr;
    DeviceStateMachine state_machine_;
    ListeningMode listening_mode_ = kListeningModeAutoStop;
    AecMode aec_mode_ = kAecOff;
    std::string last_error_message_;
    AudioService audio_service_;
    NotifyPlayer notify_player_;
    uint32_t notification_playback_id_ = 0;
    std::unique_ptr<Ota> ota_;

    std::function<void(const std::string&)> mcp_broadcast_callback_;

    bool has_server_time_ = false;
    bool aborted_ = false;
    bool assets_version_checked_ = false;
    bool play_popup_on_listening_ =
        false;  // Flag to play popup sound after state changes to listening
    bool pending_listening_start_ =
        false;  // Waiting for playback to drain before starting listening (auto mode)
    WakeResponseGate wake_response_;
    std::string wake_response_word_;
    uint32_t wake_response_sequence_ = 0x40000000U;
    bool StartWakeResponse(const std::string& wake_word);
    void AdvanceWakeResponse();
    void CancelWakeResponse();
    int clock_ticks_ = 0;
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    persona::TurnControl persona_turn_;
    std::string persona_pending_robot_stop_;
    void FlushPendingRobotStop();
    void RetireControlOnlyChannel();
    void HandleEndConversationEvent();
    void RefreshStandbyWake();
    void CompletePersonaPlayback();
    void HandlePlaybackTask(const persona::PlaybackRequest& request);
    void AdvancePlaybackTask();
    void CancelPlaybackTask(const char* reason, bool notify = true);
    void SendPlaybackAck(const cJSON* ack);
    void HandleCaptureTask(const persona::CaptureRequest& request);
    void AdvanceCaptureTask();
    void CancelCaptureTask(const char* reason, bool notify = true);
    persona::CaptureTask persona_capture_;
    persona::AgentControlTask persona_agent_control_;
    std::atomic<bool> persona_agent_owned_{false};
    std::atomic<bool> persona_agent_release_pending_{false};
    std::atomic<uint32_t> persona_agent_epoch_{0};
    void HandleAgentControl(const persona::AgentControlRequest& request);
    void EndAgentControl(const char* reason, bool notify = true, bool user_release = false);
    std::atomic<bool> persona_capture_engaged_{false};
    persona::PlaybackTask persona_playback_;
    uint32_t persona_playback_sequence_ = 0x80000000U;
    std::string persona_playback_ack_state_;
    std::atomic<bool> persona_playback_engaged_{false};
    std::atomic<bool> persona_playback_silent_{false};
    void StartPersonaListening(ListeningMode mode);
    std::string persona_pending_wake_;
    bool persona_network_ready_ = false;
    bool persona_open_running_ = false;
    bool persona_reset_pending_ = false;
    bool persona_reconnect_only_ = false;
    std::atomic<bool> persona_open_success_{false};
    std::atomic<bool> persona_reopen_after_abort_{false};
    std::atomic<bool> persona_user_stopped_{false};
    std::mutex persona_audio_mutex_;
    // Independent of turn setup: MCP initialize can arrive immediately after hello.
    std::atomic<uint32_t> persona_mcp_generation_{0};
    int persona_retry_at_ = 0;
    int persona_retry_delay_ = 5;
#endif
    TaskHandle_t activation_task_handle_ = nullptr;

    // Event handlers
    void HandleStateChangedEvent();
    void HandleToggleChatEvent();
    void HandleStartListeningEvent();
    void HandleStopListeningEvent();
    void HandleNetworkConnectedEvent();
    void HandleNetworkDisconnectedEvent();
    void HandleActivationDoneEvent();
    void HandleWakeWordDetectedEvent();
    void ContinueOpenAudioChannel(ListeningMode mode);
    void BeginWakeWordInvoke(const std::string& wake_word);
    void ContinueWakeWordInvoke(const std::string& wake_word);
    void StartListeningAudio();
    void ConfigureWakeWordForListening();
    void StartNotification(std::string audio_url, std::vector<NotifySubtitle> subtitles);
    void StopNotification();
    void HandleNotificationFinished(uint32_t playback_id, bool success);

    // Activation task (runs in background)
    void ActivationTask();

    // Helper methods
    void CheckAssetsVersion();
    void CheckNewVersion();
    void InitializeProtocol();
    void ShowActivationCode(const std::string& code, const std::string& message);
    void SetListeningMode(ListeningMode mode);
    ListeningMode GetDefaultListeningMode() const;

    // State change handler called by state machine
    void OnStateChanged(DeviceState old_state, DeviceState new_state);
};

class TaskPriorityReset {
public:
    TaskPriorityReset(BaseType_t priority) {
        original_priority_ = uxTaskPriorityGet(NULL);
        vTaskPrioritySet(NULL, priority);
    }
    ~TaskPriorityReset() { vTaskPrioritySet(NULL, original_priority_); }

private:
    BaseType_t original_priority_;
};

#endif  // _APPLICATION_H_
