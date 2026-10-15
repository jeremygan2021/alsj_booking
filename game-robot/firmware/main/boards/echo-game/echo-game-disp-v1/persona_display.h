#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include "agent_control_ui.h"
#include "companion_home_ui.h"
#include "display/lcd_display.h"
#include "mission_contract.h"
#include "persona_ui_model.h"
#include "tool_wait_ui.h"

extern std::atomic<int> persona_input_level;
extern std::atomic<int> persona_output_level;
extern std::atomic<int> persona_input_rms;

class PersonaDisplay : public RgbLcdDisplay {
public:
    PersonaDisplay(esp_lcd_panel_handle_t panel);
    void SetupUI() override;
    void SetPreviewImage(std::unique_ptr<LvglImage> image) override {}
    bool SupportsGuiOperations() const override { return false; }
    void SetStatus(const char* status) override;
    void SetEmotion(const char* emotion) override;
    void SetChatMessage(const char* role, const char* text) override;
    void ClearChatMessages() override;
    void ShowNotification(const char* text, int duration_ms = 3000) override;
    void ShowNotification(const std::string& text, int duration_ms = 3000) override;
    void UpdateStatusBar(bool all = false) override;
    void SetTheme(Theme* theme) override;
    bool HandleDeviceMessage(const cJSON* root, const std::string& session) override;
    bool IsAwaitingInput() const override { return awaiting_.load(); }
    void OnSessionClosed() override;
    void SetAgentControlView(bool active, const char* title, uint32_t local_epoch) override;
    void SetAgentDialogue(const char* role, const char* phase, const char* text) override;

private:
    enum class Phase {
        Starting,
        Idle,
        Paused,
        Connecting,
        Listening,
        Thinking,
        Tool,
        Speaking,
        Choice,
        Error,
        Configuring,
        Recording,
        Playback
    };
    lv_obj_t* face_ = nullptr;
    lv_obj_t* eyes_[2] = {};
    lv_obj_t* mouth_ = nullptr;
    std::array<lv_obj_t*, 5> activity_{};
    lv_obj_t* status_group_ = nullptr;
    lv_obj_t* subtitle_panel_ = nullptr;
    lv_obj_t* subtitle_ = nullptr;
    lv_obj_t* subtitle_scroll_ = nullptr;
    lv_obj_t* caption_hint_ = nullptr;
    lv_obj_t* caption_role_ = nullptr;
    lv_obj_t* talk_button_ = nullptr;
    lv_obj_t* stop_button_ = nullptr;
    lv_obj_t* stop_icon_ = nullptr;
    lv_obj_t* stop_caption_ = nullptr;
    lv_obj_t* footer_hint_ = nullptr;
    lv_obj_t* signature_ = nullptr;
    lv_obj_t* status_dot_ = nullptr;
    persona::ui::ToolWaitView tool_wait_;
    lv_obj_t* notice_panel_ = nullptr;
    lv_obj_t* options_ = nullptr;
    lv_obj_t* option_title_ = nullptr;
    lv_obj_t* cancel_button_ = nullptr;
    lv_obj_t* countdown_ = nullptr;
    std::array<lv_obj_t*, 4> buttons_{};
    lv_obj_t* diagnostics_ = nullptr;
    lv_obj_t* test_status_ = nullptr;
    lv_obj_t* test_button_ = nullptr;
    lv_obj_t* settings_ = nullptr;
    lv_obj_t* mission_button_ = nullptr;
    lv_obj_t* mission_panel_ = nullptr;
    lv_obj_t* mission_title_ = nullptr;
    lv_obj_t* mission_status_ = nullptr;
    lv_obj_t* mission_message_ = nullptr;
    std::array<lv_obj_t*, 3> mission_controls_{};
    persona::MissionViewState mission_view_;
    persona::ui::CompanionHomeView home_;
    persona::ui::AgentControlOverlay agent_control_;
    uint32_t agent_control_epoch_ = 0;
    lv_obj_t* settings_back_ = nullptr;
    lv_obj_t* settings_title_ = nullptr;
    lv_obj_t* volume_slider_ = nullptr;
    lv_obj_t* brightness_slider_ = nullptr;
    lv_obj_t* volume_value_ = nullptr;
    lv_obj_t* brightness_value_ = nullptr;
    lv_obj_t* url_ = nullptr;
    lv_obj_t* token_ = nullptr;
    lv_obj_t* keyboard_ = nullptr;
    lv_timer_t* timer_ = nullptr;
    std::array<std::string, 4> option_ids_{};
    std::string request_, session_, persona_state_, persona_message_, last_request_;
    std::string wheel_drive_request_;
    bool wheel_drive_terminal_ = false;
    std::string app_status_, caption_text_, caption_role_text_, displayed_status_;
    std::atomic<bool> awaiting_{false};
    std::atomic<uint32_t> session_generation_{0};
    bool submitted_ = false;
    int64_t expires_ = 0, notice_expires_ = 0, caption_update_at_ = 0;
    bool caption_dirty_ = false, caption_overflow_ = false, notice_clear_on_resume_ = false;
    unsigned ticks_ = 0;
    bool local_test_ = false, local_test_playback_ = false;
    int64_t local_test_deadline_ = 0;
    int option_count_ = 0, layout_count_ = -1, countdown_seconds_ = -1;
    int test_seconds_ = -1, diagnostic_rms_ = -1, smoothed_level_ = 0;
    persona::ui::FaceFrame drawn_face_{};
    bool face_frame_valid_ = false;
    int64_t next_face_update_ = 0, perf_window_at_ = 0;
    int64_t volume_sync_after_ = 0, brightness_sync_after_ = 0;
    uint64_t tick_total_us_ = 0;
    uint32_t tick_samples_ = 0, tick_max_us_ = 0, face_updates_ = 0;
    bool sad_ = false;
    Phase phase_ = Phase::Starting;
    uint32_t face_color_ = 0;
    void ToggleLocalTest();
    void Tick();
    void ApplyLayout();
    void RefreshCaption(bool force = false);
    void ClearTransientNotice();
    void UpdateVisualState(bool playback_active);
    void AnimateFace(bool playback_active, int64_t now);
    persona::ui::FaceMode AnimationMode() const;
    void RecordTickCost(int64_t started);
    void UpdateTestStatus(int64_t now, bool force = false);
    void ClearOptions();
    void Select(int index);
    void SettingsUI();
    void SyncSettingsValues(int64_t now);
    void CloseSettings();
    void StopConversation(const char* source = "stop");
    bool HandleMissionMessage(const cJSON* root, const std::string& session);
    void RefreshMission();
    void ShowMission();
    void RobotStop();
    void ControlMission(const char* action);
    static void Click(lv_event_t* event);
    void Talk(bool end_if_active = false);
    struct MonitorTransfer;
    std::mutex monitor_mutex_;
    std::shared_ptr<MonitorTransfer> monitor_transfer_;
    std::atomic<uint32_t> monitor_generation_{0};
    std::atomic<bool> monitor_decoding_{false};
    std::shared_ptr<LvglImage> monitor_pixels_;
    lv_obj_t* monitor_panel_ = nullptr;
    lv_obj_t* monitor_image_ = nullptr;
    lv_obj_t* monitor_title_ = nullptr;
    lv_obj_t* monitor_time_ = nullptr;
    bool HandleMonitorMessage(const cJSON* root, const std::string& session);
    void ShowMonitor(std::shared_ptr<LvglImage> image, const std::string& title, double captured);
    void CloseMonitor();
    void MonitorResult(const std::string& session, const std::string& request, bool ok);
};
