#include "persona_display.h"

#include <esp_log.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <inttypes.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include "application.h"
#include "board.h"
#include "choice_contract.h"
#include "lvgl_theme.h"
#include "mission_ui.h"
#include "persona_stop_control.h"
#include "persona_text_probe.h"
#include "persona_ui_feedback.h"
#include "persona_ui_model.h"
#include "settings.h"
#include "wheel_drive_contract.h"
#include "wifi_board.h"

LV_FONT_DECLARE(font_noto_sans_basic_14_1);
LV_FONT_DECLARE(font_xle_preview_14);
LV_FONT_DECLARE(font_material_symbols_30_4);

namespace {
constexpr uint32_t kBackground = 0x102E28;
constexpr uint32_t kPanel = 0x183C32;
constexpr uint32_t kBorder = 0x365C4C;
constexpr uint32_t kCyan = 0x9EDAC0;
constexpr uint32_t kText = 0xE8F6ED;
constexpr uint32_t kMuted = 0x90B8A6;
constexpr uint32_t kAmber = 0xD6B794;
const RgbLcdDisplay::RuntimeConfig kUiRuntime{5, 10, 1, 20};

void Bounds(lv_obj_t* object, const persona::ui::Rect& rect) {
    lv_obj_set_pos(object, rect.x, rect.y);
    lv_obj_set_size(object, rect.width, rect.height);
}
void ChangedBounds(lv_obj_t* object, const persona::ui::Rect& rect,
                   const persona::ui::Rect& previous, bool force) {
    if (force || rect.x != previous.x || rect.y != previous.y)
        lv_obj_set_pos(object, rect.x, rect.y);
    if (force || rect.width != previous.width || rect.height != previous.height)
        lv_obj_set_size(object, rect.width, rect.height);
}
void Visible(lv_obj_t* object, bool visible) {
    if (visible == !lv_obj_has_flag(object, LV_OBJ_FLAG_HIDDEN))
        return;
    if (visible)
        lv_obj_remove_flag(object, LV_OBJ_FLAG_HIDDEN);
    else
        lv_obj_add_flag(object, LV_OBJ_FLAG_HIDDEN);
}
void PressFeedback(lv_obj_t* object, uint32_t pressed_color) {
    persona::ui::InstallPressFeedback(object, pressed_color, kCyan);
}
lv_obj_t* Panel(lv_obj_t* parent, uint32_t color, int radius = 18) {
    auto object = lv_obj_create(parent);
    lv_obj_remove_style_all(object);
    lv_obj_remove_flag(object, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(object, radius, 0);
    lv_obj_set_style_border_color(object, lv_color_hex(kBorder), 0);
    lv_obj_set_style_border_width(object, 1, 0);
    return object;
}
lv_obj_t* Label(lv_obj_t* parent, const char* text, int x, int y, int width) {
    auto object = lv_label_create(parent);
    lv_label_set_text(object, text);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_width(object, width);
    lv_label_set_long_mode(object, LV_LABEL_LONG_WRAP);
    lv_obj_remove_flag(object, LV_OBJ_FLAG_CLICKABLE);
    return object;
}
void Ellipsis(lv_obj_t* label, int height) {
    lv_obj_set_height(label, height);
    lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
}
void FitButtonLabel(lv_obj_t* button) {
    lv_obj_update_layout(button);
    auto label = lv_obj_get_child(button, 0);
    lv_obj_set_width(label, lv_obj_get_width(button) - 24);
    lv_obj_set_height(label, LV_SIZE_CONTENT);
    lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
    lv_obj_update_layout(label);
    const int maximum = lv_obj_get_height(button) - 10;
    if (lv_obj_get_height(label) > maximum)
        Ellipsis(label, maximum);
    lv_obj_center(label);
}
lv_obj_t* Button(lv_obj_t* parent, const char* text, int x, int y, int w, int h,
                 bool primary = false) {
    auto object = persona::ui::CompanionButton(parent, text, x, y, w, h, primary);
    FitButtonLabel(object);
    return object;
}
void ButtonText(lv_obj_t* button, const char* text) {
    auto label = lv_obj_get_child(button, 0);
    if (std::strcmp(lv_label_get_text(label), text) != 0) {
        lv_label_set_text(label, text);
        FitButtonLabel(button);
    }
}
bool Text(const cJSON* root, const char* key, std::string& result, size_t max) {
    auto value = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(value) || !value->valuestring || !*value->valuestring ||
        std::strlen(value->valuestring) > max)
        return false;
    result = value->valuestring;
    return true;
}
}  // namespace

PersonaDisplay::PersonaDisplay(esp_lcd_panel_handle_t panel)
    : RgbLcdDisplay(nullptr, panel, 800, 480, 0, 0, false, false, false, &kUiRuntime) {}

void PersonaDisplay::SetupUI() {
    DisplayLockGuard lock(this);
    if (setup_ui_called_)
        return;
    setup_ui_called_ = true;
    auto screen = lv_display_get_screen_active(display_);
    lv_obj_set_style_bg_color(screen, lv_color_hex(kBackground), 0);
    lv_obj_set_style_text_color(screen, lv_color_hex(kText), 0);
    if (current_theme_)
        lv_obj_set_style_text_font(screen, current_theme_->GetTextFont()->font(), 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    home_ = persona::ui::CreateCompanionHome(
        screen, &font_xle_preview_14,
        [](lv_event_t* event) {
            static_cast<PersonaDisplay*>(lv_event_get_user_data(event))->StopConversation();
        },
        this);
    mission_button_ = home_.mission;
    lv_obj_set_user_data(mission_button_, reinterpret_cast<void*>(intptr_t(13)));
    lv_obj_add_event_cb(mission_button_, Click, LV_EVENT_CLICKED, this);
    auto settings = home_.settings;
    lv_obj_set_user_data(settings, reinterpret_cast<void*>(intptr_t(10)));
    lv_obj_add_event_cb(settings, Click, LV_EVENT_CLICKED, this);
    status_group_ = home_.status_group;
    status_dot_ = home_.status_dot;
    status_label_ = home_.status_label;
    tool_wait_ = persona::ui::CreateToolWait(lv_display_get_layer_top(display_),
                                             current_theme_ && current_theme_->GetTextFont()
                                                 ? current_theme_->GetTextFont()->font()
                                                 : nullptr,
                                             kText, kCyan);
    network_label_ = home_.network;
    lv_obj_set_style_text_font(network_label_, &font_material_symbols_30_4, 0);
    face_ = home_.face;
    lv_obj_set_user_data(face_, reinterpret_cast<void*>(intptr_t(6)));
    lv_obj_add_event_cb(face_, Click, LV_EVENT_CLICKED, this);
    // Compact choice prompts retain their small expression; the normal page
    // uses the complete companion drawn by the shared production helper.
    for (auto& eye : eyes_) {
        eye = Panel(face_, kText, 4);
        lv_obj_set_style_border_width(eye, 0, 0);
        lv_obj_remove_flag(eye, LV_OBJ_FLAG_CLICKABLE);
        PressFeedback(eye, kCyan);
    }
    mouth_ = Panel(face_, kText, LV_RADIUS_CIRCLE);
    lv_obj_set_style_border_width(mouth_, 0, 0);
    lv_obj_remove_flag(mouth_, LV_OBJ_FLAG_CLICKABLE);
    PressFeedback(mouth_, kCyan);
    lv_obj_add_event_cb(
        face_,
        [](lv_event_t* event) {
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(event));
            if (self->layout_count_ > 0)
                persona::ui::SetFacePressedParts(lv_event_get_code(event),
                                                 {self->eyes_[0], self->eyes_[1], self->mouth_});
            else
                persona::ui::SetFacePressedParts(
                    lv_event_get_code(event),
                    {self->home_.pet.eyes[0], self->home_.pet.eyes[1], self->home_.pet.mouth});
        },
        LV_EVENT_ALL, this);
    for (auto eye : home_.pet.eyes)
        PressFeedback(eye, kCyan);
    PressFeedback(home_.pet.mouth, kCyan);
    for (auto& bar : activity_) {
        bar = Panel(face_, kCyan, LV_RADIUS_CIRCLE);
        lv_obj_set_style_border_width(bar, 0, 0);
        lv_obj_remove_flag(bar, LV_OBJ_FLAG_CLICKABLE);
        Visible(bar, false);
    }
    subtitle_panel_ = home_.caption_panel;
    caption_role_ = home_.role;
    caption_hint_ = home_.hint;
    subtitle_scroll_ = home_.caption_scroll;
    subtitle_ = home_.caption;
    footer_hint_ = home_.footer;
    talk_button_ = home_.talk;
    lv_obj_add_event_cb(talk_button_, Click, LV_EVENT_CLICKED, this);
    stop_button_ = home_.stop.button;
    stop_icon_ = home_.stop.icon;
    stop_caption_ = home_.stop.caption;
    signature_ = home_.signature;

    option_title_ = Label(screen, "", 218, 76, 558);
    lv_obj_set_style_text_line_space(option_title_, 7, 0);
    Ellipsis(option_title_, 80);
    options_ = lv_obj_create(screen);
    lv_obj_remove_style_all(options_);
    lv_obj_remove_flag(options_, LV_OBJ_FLAG_SCROLLABLE);
    for (int i = 0; i < 4; ++i) {
        buttons_[i] = Button(options_, "", 0, 0, 370, 82);
        lv_obj_set_user_data(buttons_[i], reinterpret_cast<void*>(intptr_t(i + 1)));
        lv_obj_add_event_cb(buttons_[i], Click, LV_EVENT_CLICKED, this);
    }
    cancel_button_ = Button(screen, "取消选择", 610, 368, 166, 58);
    lv_obj_set_user_data(cancel_button_, reinterpret_cast<void*>(intptr_t(5)));
    lv_obj_add_event_cb(cancel_button_, Click, LV_EVENT_CLICKED, this);
    countdown_ = Label(screen, "", 612, 432, 164);
    lv_obj_set_style_text_align(countdown_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(countdown_, lv_color_hex(kMuted), 0);

    notice_panel_ = Panel(screen, 0x0E1B28, 4);
    Bounds(notice_panel_, {246, 6, 234, 50});
    notification_label_ = Label(notice_panel_, "", 10, 6, 214);
    lv_obj_set_style_text_line_space(notification_label_, 2, 0);
    Ellipsis(notification_label_, 38);
    lv_obj_set_style_text_align(notification_label_, LV_TEXT_ALIGN_CENTER, 0);
    Visible(notice_panel_, false);
    mission_panel_ = Panel(screen, kPanel, 6);
    Bounds(mission_panel_, persona::ui::kMissionPanelBounds);
    mission_title_ = Label(mission_panel_, "当前没有任务", 20, 18, 544);
    Ellipsis(mission_title_, 64);
    auto close_mission = Button(mission_panel_, "返回对话", 574, 16, 156, 48);
    lv_obj_set_user_data(close_mission, reinterpret_cast<void*>(intptr_t(14)));
    lv_obj_add_event_cb(close_mission, Click, LV_EVENT_CLICKED, this);
    mission_status_ = Label(mission_panel_, "无任务", 20, 94, 704);
    Ellipsis(mission_status_, 38);
    mission_message_ = Label(mission_panel_, "可在网页决策 agent 中创建任务。", 20, 138, 704);
    Ellipsis(mission_message_, 100);
    const char* labels[] = {"暂停任务", "恢复任务", "取消任务"};
    for (int i = 0; i < 3; ++i) {
        mission_controls_[i] = Button(mission_panel_, labels[i], 20 + i * 238, 260, 220, 58);
        lv_obj_set_user_data(mission_controls_[i], reinterpret_cast<void*>(intptr_t(15 + i)));
        lv_obj_add_event_cb(mission_controls_[i], Click, LV_EVENT_CLICKED, this);
    }
    RefreshMission();
    Visible(mission_panel_, false);
    agent_control_ = persona::ui::CreateAgentControlOverlay(
        lv_display_get_layer_top(display_),
        current_theme_ && current_theme_->GetTextFont() ? current_theme_->GetTextFont()->font()
                                                        : nullptr,
        [](lv_event_t* event) {
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(event));
            Application::GetInstance().ReleaseAgentControl(self->agent_control_epoch_);
        },
        this);
    ApplyLayout();
    SetChatMessage("system", "");
    timer_ = lv_timer_create(
        [](lv_timer_t* t) { static_cast<PersonaDisplay*>(lv_timer_get_user_data(t))->Tick(); }, 50,
        this);
}

void PersonaDisplay::SetTheme(Theme* theme) {
    DisplayLockGuard lock(this);
    current_theme_ = theme;
    if (setup_ui_called_ && theme && theme->GetTextFont()) {
        // Primary text inherits this resource-backed font. Pinning a basic
        // subset on individual labels would hide its additional Chinese glyphs.
        lv_obj_set_style_text_font(lv_display_get_screen_active(display_),
                                   theme->GetTextFont()->font(), 0);
        if (agent_control_.panel)
            lv_obj_set_style_text_font(agent_control_.panel, theme->GetTextFont()->font(), 0);
        // Top-layer labels do not inherit the screen font. Assets replace and
        // release the startup font; rebind this label before it can be drawn.
        persona::ui::SetToolWaitFont(tool_wait_, theme->GetTextFont()->font());
        ESP_LOGI(
            "PersonaUI", "Text font line_height=%d required_missing=%u small_missing=%u",
            theme->GetTextFont()->font()->line_height,
            persona::ui::MissingTextGlyphs(theme->GetTextFont()->font(),
                                           persona::ui::kTextGlyphProbe),
            persona::ui::MissingTextGlyphs(&font_xle_preview_14, persona::ui::kSmallGlyphProbe));
    }
}
void PersonaDisplay::SetStatus(const char* status) {
    DisplayLockGuard lock(this);
    app_status_ = persona::ui::BoundedText(status, 160);
    // A local lifecycle change is authoritative over the previous cloud thinking hint.
    persona_state_.clear();
    persona_message_.clear();
    if (status_label_)
        UpdateVisualState(!Application::GetInstance().GetAudioService().IsPlaybackIdle());
}

void PersonaDisplay::SetAgentControlView(bool active, const char* title, uint32_t local_epoch) {
    DisplayLockGuard lock(this);
    if (!agent_control_.panel)
        return;
    agent_control_epoch_ = active ? local_epoch : 0;
    persona::ui::ResetCompanionMotion(home_.pet);
    if (active) {
        persona::ui::ResetAgentDialogue(agent_control_);
        ClearOptions();
        ClearTransientNotice();
        CloseSettings();
        Visible(mission_panel_, false);
        CloseMonitor();
        lv_label_set_text(agent_control_.mission, persona::ui::BoundedText(title, 192).c_str());
        Visible(agent_control_.panel, true);
        lv_obj_move_foreground(agent_control_.panel);
    } else {
        Visible(agent_control_.panel, false);
        persona::ui::ResetAgentDialogue(agent_control_);
    }
}
void PersonaDisplay::SetAgentDialogue(const char* role, const char* phase, const char* text) {
    DisplayLockGuard lock(this);
    if (agent_control_epoch_)
        persona::ui::SetAgentDialogue(agent_control_, role, phase, text);
}
void PersonaDisplay::SetEmotion(const char* emotion) {
    DisplayLockGuard lock(this);
    sad_ = emotion && std::strcmp(emotion, "sad") == 0;
}
void PersonaDisplay::SetChatMessage(const char* role, const char* text) {
    DisplayLockGuard lock(this);
    if (!subtitle_)
        return;
    auto message = persona::ui::BoundedText(text);
    const unsigned missing = persona::ui::MissingTextGlyphs(
        lv_obj_get_style_text_font(subtitle_, LV_PART_MAIN), message.c_str());
    if (missing)
        ESP_LOGW("PersonaUI", "Caption has %u missing glyphs", missing);
    std::string role_text = role && std::strcmp(role, "user") == 0        ? "你说"
                            : role && std::strcmp(role, "assistant") == 0 ? "ECHO"
                                                                          : "提示";
    if (message.empty()) {
        message = "我在这里。\n叫一声“你好小智”，或轻触ECHO。";
        role_text = "提示";
    }
    if (message == caption_text_ && role_text == caption_role_text_)
        return;
    caption_text_ = std::move(message);
    caption_role_text_ = std::move(role_text);
    caption_dirty_ = true;
    RefreshCaption();
}
void PersonaDisplay::RefreshCaption(bool force) {
    if (!subtitle_ || (!caption_dirty_ && !force))
        return;
    if (!force && settings_ && !lv_obj_has_flag(settings_, LV_OBJ_FLAG_HIDDEN))
        return;
    const int64_t now = esp_timer_get_time();
    if (!force && now < caption_update_at_)
        return;
    const bool role_changed = caption_role_text_ != lv_label_get_text(caption_role_);
    const int previous_y = lv_obj_get_scroll_y(subtitle_scroll_);
    const int previous_bottom = lv_obj_get_scroll_bottom(subtitle_scroll_);
    if (caption_text_ != lv_label_get_text(subtitle_))
        lv_label_set_text(subtitle_, caption_text_.c_str());
    if (role_changed)
        lv_label_set_text(caption_role_, caption_role_text_.c_str());
    lv_obj_update_layout(subtitle_scroll_);
    const int maximum =
        std::max(0, int(lv_obj_get_height(subtitle_) - lv_obj_get_height(subtitle_scroll_)));
    lv_obj_scroll_to_y(
        subtitle_scroll_,
        persona::ui::CaptionScrollTarget(role_changed, previous_y, previous_bottom, maximum),
        LV_ANIM_OFF);
    const bool overflow = maximum > 0;
    if (overflow != caption_overflow_) {
        caption_overflow_ = overflow;
        Visible(caption_hint_, overflow);
    }
    caption_dirty_ = false;
    caption_update_at_ = now + 100000;
}
void PersonaDisplay::ClearTransientNotice() {
    if (!notice_clear_on_resume_)
        return;
    Visible(notice_panel_, false);
    notice_expires_ = 0;
    notice_clear_on_resume_ = false;
}
void PersonaDisplay::ClearChatMessages() { SetChatMessage("system", ""); }
void PersonaDisplay::ShowNotification(const char* text, int duration_ms) {
    DisplayLockGuard lock(this);
    if (!notification_label_)
        return;
    auto message = persona::ui::BoundedText(text, 384);
    notice_clear_on_resume_ = false;
    if (message.empty()) {
        Visible(notice_panel_, false);
        notice_expires_ = 0;
        return;
    }
    lv_label_set_text(notification_label_, message.c_str());
    notice_expires_ = esp_timer_get_time() + int64_t(std::clamp(duration_ms, 500, 15000)) * 1000;
    Visible(notice_panel_, true);
    lv_obj_move_foreground(notice_panel_);
}
void PersonaDisplay::ShowNotification(const std::string& text, int duration_ms) {
    ShowNotification(text.c_str(), duration_ms);
}
void PersonaDisplay::UpdateStatusBar(bool all) {
    DisplayLockGuard lock(this);
    if (!network_label_)
        return;
    auto icon = Board::GetInstance().GetNetworkStateIcon();
    if (all || std::strcmp(lv_label_get_text(network_label_), icon) != 0)
        lv_label_set_text(network_label_, icon);
}

void PersonaDisplay::ApplyLayout() {
    const int count = request_.empty() ? 0 : option_count_;
    if (layout_count_ == count)
        return;
    layout_count_ = count;
    const bool compact = count > 0;
    const auto layout = persona::ui::MakeLayout(compact, count);
    persona::ui::SetCompanionHomeLayout(home_, compact, &font_xle_preview_14);
    for (auto eye : eyes_)
        Visible(eye, compact);
    Visible(mouth_, compact);
    for (auto bar : activity_)
        Visible(bar, false);
    Bounds(options_, layout.choices);
    Bounds(cancel_button_, layout.cancel);
    Bounds(countdown_, layout.countdown);
    Visible(option_title_, compact);
    Visible(options_, compact);
    Visible(cancel_button_, compact);
    Visible(countdown_, compact);
    for (int i = 0; i < 4; ++i) {
        Visible(buttons_[i], compact && i < count);
        if (i < count) {
            Bounds(buttons_[i], layout.buttons[i]);
            FitButtonLabel(buttons_[i]);
        }
    }
    RefreshCaption(true);
    face_frame_valid_ = false;
    next_face_update_ = 0;
    countdown_seconds_ = -1;
}

void PersonaDisplay::UpdateVisualState(bool playback_active) {
    auto state = Application::GetInstance().GetDeviceState();
    const bool wake_ready = Application::GetInstance().GetAudioService().IsWakeWordRunning();
    Phase next = Phase::Idle;
    if (local_test_)
        next = local_test_playback_ ? Phase::Playback : Phase::Recording;
    else if (state == kDeviceStateWifiConfiguring)
        next = Phase::Configuring;
    else if (Application::GetInstance().IsConversationStopped())
        next = Phase::Paused;
    else if (state == kDeviceStateFatalError || persona_state_ == "error" || sad_)
        next = Phase::Error;
    else if (awaiting_.load())
        next = Phase::Choice;
    else if (playback_active || state == kDeviceStateSpeaking || state == kDeviceStateNotifying)
        next = Phase::Speaking;
    else if (state == kDeviceStateConnecting)
        next = Phase::Connecting;
    else if (persona_state_ == "tool" || persona_state_ == "tool_running")
        next = Phase::Tool;
    else if (persona_state_ == "thinking")
        next = Phase::Thinking;
    else if (state == kDeviceStateListening)
        next = Phase::Listening;
    else if (state == kDeviceStateStarting || state == kDeviceStateUnknown)
        next = Phase::Starting;
    if (phase_ != next)
        next_face_update_ = 0;
    phase_ = next;
    persona::ui::UpdateToolWait(tool_wait_, next == Phase::Tool, esp_timer_get_time());
    if (next == Phase::Listening || next == Phase::Connecting || next == Phase::Idle)
        ClearTransientNotice();
    const char* label = wake_ready ? "待机 · 等待你好小智" : "我在这里 · 未在倾听";
    const char* action = "开始对话";
    switch (next) {
        case Phase::Starting:
            label = "正在启动";
            action = "准备中";
            break;
        case Phase::Connecting:
            label = "正在连接服务器";
            break;
        case Phase::Paused:
            label = wake_ready ? "待机 · 等待你好小智" : "对话已结束 · 未在倾听";
            action = "开始对话";
            break;
        case Phase::Listening:
            label = "我在听，请说";
            action = "重新说话";
            break;
        case Phase::Thinking:
            label = "让我想一想";
            action = "重新说话";
            break;
        case Phase::Tool:
            label = "正在为你处理";
            action = "重新说话";
            break;
        case Phase::Speaking:
            label = "正在回答";
            action = "点击打断";
            break;
        case Phase::Choice:
            label = submitted_ ? "正在提交选择" : "请轻触选择";
            break;
        case Phase::Error:
            label = "暂时遇到问题";
            action = "重新连接";
            break;
        case Phase::Configuring:
            label = "请完成 Wi-Fi 配网";
            action = "等待配网";
            break;
        case Phase::Recording:
            label = "正在录音测试";
            action = "测试进行中";
            break;
        case Phase::Playback:
            label = "正在回放录音";
            action = "测试进行中";
            break;
        default:
            break;
    }
    const std::string* detail = nullptr;
    if (!persona_message_.empty() &&
        (next == Phase::Thinking || next == Phase::Tool || next == Phase::Error))
        detail = &persona_message_;
    else if (!app_status_.empty() && (next == Phase::Starting || next == Phase::Error))
        detail = &app_status_;
    const char* status = detail ? detail->c_str() : label;
    if (displayed_status_ != status) {
        displayed_status_ = status;
        lv_label_set_text(status_label_, status);
    }
    const bool conversation_active = !Application::GetInstance().IsConversationStopped() &&
                                     persona::IsPersonaConversationActive(
                                         state, playback_active, awaiting_.load(),
                                         persona_state_ == "thinking" || persona_state_ == "tool" ||
                                             persona_state_ == "tool_running");
    if (conversation_active)
        action = "结束对话";
    ButtonText(talk_button_, action);
    const bool disabled = next == Phase::Starting || next == Phase::Configuring || local_test_;
    if (disabled != lv_obj_has_state(talk_button_, LV_STATE_DISABLED)) {
        if (disabled)
            lv_obj_add_state(talk_button_, LV_STATE_DISABLED);
        else
            lv_obj_remove_state(talk_button_, LV_STATE_DISABLED);
    }
    // Ending a conversation must remain available even when cloud hints are stale.
    persona::ui::SetCompanionConversationControls(home_, conversation_active, layout_count_ > 0,
                                                  !disabled);
    const char* footer = conversation_active ? "轻触ECHO问案情"
                         : wake_ready        ? "等待唤醒"
                                             : "等待问询";
    const char* pet_status = conversation_active ? label
                             : wake_ready        ? "叫一声“你好小智”来聊天"
                                                 : "等待问询 · 点击开始对话";
    if (std::strcmp(lv_label_get_text(home_.status), pet_status) != 0)
        lv_label_set_text(home_.status, pet_status);
    if (std::strcmp(lv_label_get_text(footer_hint_), footer) != 0)
        lv_label_set_text(footer_hint_, footer);
    const uint32_t color = next == Phase::Error ? kAmber : kText;
    if (face_color_ != color) {
        face_color_ = color;
        for (auto eye : eyes_)
            lv_obj_set_style_bg_color(eye, lv_color_hex(color), 0);
        lv_obj_set_style_bg_color(mouth_, lv_color_hex(color), 0);
        const auto accent = lv_color_hex(next == Phase::Error ? kAmber : kCyan);
        lv_obj_set_style_bg_color(status_dot_, accent, 0);
        for (auto bar : activity_)
            lv_obj_set_style_bg_color(bar, accent, 0);
    }
}

persona::ui::FaceMode PersonaDisplay::AnimationMode() const {
    using persona::ui::FaceMode;
    switch (phase_) {
        case Phase::Listening:
        case Phase::Recording:
            return FaceMode::Listening;
        case Phase::Speaking:
        case Phase::Playback:
            return FaceMode::Speaking;
        case Phase::Thinking:
        case Phase::Tool:
            return FaceMode::Thinking;
        case Phase::Starting:
        case Phase::Connecting:
            return FaceMode::Connecting;
        case Phase::Choice:
            return FaceMode::Choice;
        case Phase::Error:
            return FaceMode::Error;
        default:
            return FaceMode::Idle;
    }
}
void PersonaDisplay::AnimateFace(bool playback_active, int64_t now) {
    if (now < next_face_update_)
        return;
    auto mode = AnimationMode();
    int target = 0;
    // Actual output still wins during the speaker queue's tail.
    if (playback_active) {
        mode = persona::ui::FaceMode::Speaking;
        target = persona_output_level.load(std::memory_order_relaxed);
    } else if (mode == persona::ui::FaceMode::Listening &&
               ((local_test_ && !local_test_playback_) ||
                Application::GetInstance().GetAudioService().IsAudioProcessorRunning())) {
        target = persona_input_level.load(std::memory_order_relaxed);
    }
    if (layout_count_ <= 0) {
        persona::ui::AnimateCompanionPet(home_.pet, mode, now / 1000,
                                         mode == persona::ui::FaceMode::Listening ? target : 0,
                                         playback_active ? target : 0);
        next_face_update_ = now + 50000;
        ++face_updates_;
        return;
    }
    smoothed_level_ = persona::ui::SmoothLevel(smoothed_level_, target);
    next_face_update_ = now + int64_t(persona::ui::FaceIntervalMs(mode)) * 1000;
    const auto frame =
        persona::ui::MakeFace(mode, layout_count_ > 0, smoothed_level_, uint32_t(now / 1000));
    const bool force = !face_frame_valid_;
    for (int i = 0; i < 2; ++i) {
        ChangedBounds(eyes_[i], frame.eyes[i], drawn_face_.eyes[i], force);
        if (force || frame.eye_radius != drawn_face_.eye_radius)
            lv_obj_set_style_radius(eyes_[i], frame.eye_radius, 0);
        if (force || frame.eye_opacity != drawn_face_.eye_opacity)
            lv_obj_set_style_bg_opa(eyes_[i], frame.eye_opacity, 0);
    }
    ChangedBounds(mouth_, frame.mouth, drawn_face_.mouth, force);
    for (size_t i = 0; i < activity_.size(); ++i) {
        const bool visible = int(i) < frame.activity_count;
        Visible(activity_[i], visible);
        if (!visible)
            continue;
        const bool newly_visible = force || int(i) >= drawn_face_.activity_count;
        ChangedBounds(activity_[i], frame.activity[i], drawn_face_.activity[i], newly_visible);
        if (newly_visible || frame.activity_opacity[i] != drawn_face_.activity_opacity[i])
            lv_obj_set_style_bg_opa(activity_[i], frame.activity_opacity[i], 0);
    }
    drawn_face_ = frame;
    face_frame_valid_ = true;
    ++face_updates_;
}
void PersonaDisplay::RecordTickCost(int64_t started) {
    const uint32_t cost = uint32_t(std::max<int64_t>(0, esp_timer_get_time() - started));
    tick_total_us_ += cost;
    tick_max_us_ = std::max(tick_max_us_, cost);
    ++tick_samples_;
    if (!perf_window_at_)
        perf_window_at_ = started;
    if (started - perf_window_at_ < 30000000)
        return;
    // This measures this callback only, not LVGL rasterization, FPS, or touch latency.
    ESP_LOGI("PersonaUI",
             "ui_tick avg_us=%" PRIu64 " max_us=%" PRIu32 " samples=%" PRIu32
             " face_updates=%" PRIu32,
             tick_total_us_ / tick_samples_, tick_max_us_, tick_samples_, face_updates_);
    perf_window_at_ = started;
    tick_total_us_ = 0;
    tick_samples_ = tick_max_us_ = face_updates_ = 0;
}

void PersonaDisplay::UpdateTestStatus(int64_t now, bool force) {
    if (!test_status_)
        return;
    int seconds = local_test_ && !local_test_playback_
                      ? (local_test_deadline_ == INT64_MAX
                             ? 0
                             : persona::ui::RemainingSeconds(local_test_deadline_, now))
                      : -1;
    if (force || seconds != test_seconds_) {
        test_seconds_ = seconds;
        char text[96];
        if (local_test_playback_)
            std::snprintf(text, sizeof(text), "正在回放，请听刚才的录音");
        else if (local_test_)
            std::snprintf(text, sizeof(text), "录音中 · %d 秒后自动回放", seconds);
        else
            std::snprintf(text, sizeof(text), "录音 5 秒后自动回放");
        lv_label_set_text(test_status_, text);
        ButtonText(test_button_, local_test_playback_ ? "正在回放"
                                 : local_test_        ? "结束录音并回放"
                                                      : "录音回放测试");
        if (local_test_playback_)
            lv_obj_add_state(test_button_, LV_STATE_DISABLED);
        else
            lv_obj_remove_state(test_button_, LV_STATE_DISABLED);
    }
}
void PersonaDisplay::ToggleLocalTest() {
    DisplayLockGuard lock(this);
    auto& app = Application::GetInstance();
    auto& audio = app.GetAudioService();
    if (local_test_playback_)
        return;
    if (local_test_) {
        audio.EnableAudioTesting(false);
        local_test_playback_ = true;
        local_test_deadline_ = esp_timer_get_time() + 500000;
        smoothed_level_ = 0;
        UpdateTestStatus(esp_timer_get_time(), true);
        return;
    }
    if (app.GetDeviceState() == kDeviceStateConnecting ||
        app.GetDeviceState() == kDeviceStateStarting) {
        ShowNotification("连接完成后再试录音回放");
        return;
    }
    app.AbortSpeaking(kAbortReasonNone);
    audio.EnableVoiceProcessing(false);
    audio.EnableWakeWordDetection(false);
    audio.ResetDecoder();
    ClearOptions();
    persona_state_.clear();
    persona_message_.clear();
    app.SetDeviceState(kDeviceStateAudioTesting);
    local_test_ = true;
    local_test_deadline_ = esp_timer_get_time() + 5000000;
    audio.EnableAudioTesting(true);
    UpdateTestStatus(esp_timer_get_time(), true);
}
void PersonaDisplay::Tick() {
    const int64_t now = esp_timer_get_time();
    if (agent_control_epoch_) {
        auto& audio = Application::GetInstance().GetAudioService();
        persona::ui::AnimateAgentPet(
            agent_control_, now / 1000,
            audio.IsAudioProcessorRunning() ? persona_input_level.load(std::memory_order_relaxed)
                                            : 0,
            !audio.IsPlaybackIdle() ? persona_output_level.load(std::memory_order_relaxed) : 0);
        RecordTickCost(now);
        return;
    }
    const bool playback_active = !Application::GetInstance().GetAudioService().IsPlaybackIdle();
    if (local_test_ && now >= local_test_deadline_) {
        local_test_deadline_ = INT64_MAX;
        if (!local_test_playback_)
            Application::GetInstance().Schedule([this] { ToggleLocalTest(); });
        else if (!playback_active)
            Application::GetInstance().Schedule([this] {
                DisplayLockGuard lock(this);
                local_test_ = local_test_playback_ = false;
                Application::GetInstance().SetDeviceState(kDeviceStateIdle);
                UpdateTestStatus(esp_timer_get_time(), true);
                lv_label_set_text(test_status_, "回放结束，可再次测试");
            });
        else
            local_test_deadline_ = now + 100000;
    }
    ++ticks_;
    if (notice_expires_ && now >= notice_expires_) {
        Visible(notice_panel_, false);
        notice_expires_ = 0;
    }
    if (!request_.empty() && now >= expires_) {
        if (!submitted_)
            Select(-2);
        ClearOptions();
        ShowNotification("选择已超时，可以重新提问", 4000);
    }
    if (!request_.empty()) {
        int seconds = submitted_ ? -2 : persona::ui::RemainingSeconds(expires_, now);
        if (seconds != countdown_seconds_) {
            countdown_seconds_ = seconds;
            char text[32];
            if (submitted_)
                std::snprintf(text, sizeof(text), "提交中");
            else
                std::snprintf(text, sizeof(text), "%d 秒", seconds);
            lv_label_set_text(countdown_, text);
        }
    }
    const bool settings_visible = settings_ && !lv_obj_has_flag(settings_, LV_OBJ_FLAG_HIDDEN);
    const bool monitor_visible =
        monitor_panel_ && !lv_obj_has_flag(monitor_panel_, LV_OBJ_FLAG_HIDDEN);
    const bool mission_visible =
        mission_panel_ && !lv_obj_has_flag(mission_panel_, LV_OBJ_FLAG_HIDDEN);
    if (settings_visible || monitor_visible || mission_visible)
        persona::ui::ResetCompanionMotion(home_.pet);
    // Hidden background state/text/face work waits until the settings layer closes.
    if (!settings_visible) {
        UpdateVisualState(playback_active);
        if (!monitor_visible && !mission_visible) {
            RefreshCaption();
            AnimateFace(playback_active, now);
        }
    }
    if (settings_visible) {
        UpdateTestStatus(now);
        if (ticks_ % 10 == 0) {
            SyncSettingsValues(now);
            const int rms = persona_input_rms.load(std::memory_order_relaxed);
            if (rms != diagnostic_rms_) {
                diagnostic_rms_ = rms;
                char text[40];
                std::snprintf(text, sizeof(text), "MIC RMS %d", rms);
                lv_label_set_text(diagnostics_, text);
            }
        }
    }
    RecordTickCost(now);
}

void PersonaDisplay::ClearOptions() {
    awaiting_.store(false);
    request_.clear();
    option_ids_.fill("");
    submitted_ = false;
    expires_ = 0;
    option_count_ = 0;
    if (options_) {
        lv_label_set_text(option_title_, "");
        lv_obj_remove_state(cancel_button_, LV_STATE_DISABLED);
        ApplyLayout();
    }
}
void PersonaDisplay::OnSessionClosed() {
    DisplayLockGuard lock(this);
    CloseMonitor();
    session_generation_.fetch_add(1);
    ClearOptions();
    session_.clear();
    last_request_.clear();
    persona_state_.clear();
    persona_message_.clear();
    persona_output_level.store(0);
    smoothed_level_ = 0;
    persona::ui::ResetCompanionMotion(home_.pet);
    mission_view_.Disconnect();
    RefreshMission();
}

bool PersonaDisplay::HandleDeviceMessage(const cJSON* root, const std::string& session) {
    const auto kind = cJSON_GetObjectItemCaseSensitive(root, "type");
    if (cJSON_IsString(kind) && std::strcmp(kind->valuestring, "robot.drive.status") == 0) {
        persona::WheelDriveStatus status;
        if (!persona::ParseWheelDriveStatus(root, session, status))
            return true;
        const auto generation = session_generation_.load();
        Application::GetInstance().Schedule([this, status, session, generation] {
            DisplayLockGuard lock(this);
            if (generation != session_generation_.load())
                return;
            if (status.state == "running") {
                if (wheel_drive_request_ == status.request && wheel_drive_terminal_)
                    return;
                wheel_drive_request_ = status.request;
                wheel_drive_terminal_ = false;
            } else {
                if (wheel_drive_request_ != status.request || wheel_drive_terminal_)
                    return;
                wheel_drive_terminal_ = true;
            }
            ESP_LOGI("WheelDrive", "state=%s direction=%s request=%s", status.state.c_str(),
                     status.direction.c_str(), status.request.c_str());
            ShowNotification(status.message.c_str(), 6000);
        });
        return true;
    }
    if (HandleMissionMessage(root, session))
        return true;
    if (HandleMonitorMessage(root, session))
        return true;
    std::string type;
    if (!Text(root, "type", type, 40))
        return false;
    if (type != "ui.options" && type != "ui.result" && type != "persona.state")
        return false;
    std::string incoming;
    if (!Text(root, "session_id", incoming, 128) || incoming != session || session.empty())
        return true;
    const uint32_t generation = session_generation_.load();
    const uint32_t turn_generation = Application::GetInstance().GetPersonaEventGeneration();
    if (type == "persona.state") {
        std::string state, message;
        if (!Text(root, "state", state, 32) ||
            (state != "thinking" && state != "idle" && state != "waiting_choice" &&
             state != "error" && state != "tool" && state != "tool_running"))
            return true;
        Text(root, "message", message, 512);
        Application::GetInstance().Schedule([this, incoming, state, message, generation,
                                             turn_generation] {
            DisplayLockGuard lock(this);
            if (!Application::GetInstance().IsPersonaMessageCurrent(incoming, turn_generation) ||
                generation != session_generation_.load())
                return;
            session_ = incoming;
            persona_state_ = state;
            persona_message_ = message;
            if (!request_.empty() && state == "idle")
                ClearOptions();
            if (state == "thinking" || state == "error" || state == "tool" ||
                state == "tool_running")
                Application::GetInstance().GetAudioService().EnableVoiceProcessing(false);
            if (state == "error" && !message.empty())
                ShowNotification(message, 6000);
            UpdateVisualState(!Application::GetInstance().GetAudioService().IsPlaybackIdle());
        });
        return true;
    }
    std::string request;
    if (!Text(root, "request_id", request, 128))
        return true;
    if (type == "ui.result") {
        auto ok = cJSON_GetObjectItemCaseSensitive(root, "ok");
        if (!cJSON_IsBool(ok))
            return true;
        std::string message;
        Text(root, "message", message, 512);
        Application::GetInstance().Schedule([this, incoming, request, success = cJSON_IsTrue(ok),
                                             message, generation, turn_generation] {
            DisplayLockGuard lock(this);
            if (!Application::GetInstance().IsPersonaMessageCurrent(incoming, turn_generation) ||
                generation != session_generation_.load() || session_ != incoming ||
                request_ != request || !submitted_)
                return;
            ClearOptions();
            ShowNotification(message.empty() ? (success ? "已收到你的选择" : "提交失败，请重新提问")
                                             : message.c_str(),
                             success ? 1400 : 4000);
            notice_clear_on_resume_ = success;
            UpdateVisualState(!Application::GetInstance().GetAudioService().IsPlaybackIdle());
        });
        return true;
    }
    persona::ChoiceMessage choice;
    if (!persona::ParseChoice(root, session, choice))
        return true;
    const int64_t deadline = esp_timer_get_time() + int64_t(choice.ttl_ms) * 1000;
    Application::GetInstance().Schedule(
        [this, incoming, request, choice, deadline, generation, turn_generation] {
            DisplayLockGuard lock(this);
            if (!Application::GetInstance().IsPersonaMessageCurrent(incoming, turn_generation) ||
                generation != session_generation_.load() ||
                (incoming == session_ && request == last_request_))
                return;
            if (!request_.empty() && !submitted_)
                Select(-1);
            ClearOptions();
            session_ = incoming;
            request_ = last_request_ = request;
            CloseMonitor();
            awaiting_.store(true);
            expires_ = deadline;
            option_ids_ = choice.ids;
            option_count_ = choice.count;
            lv_label_set_text(option_title_, choice.title.c_str());
            for (int i = 0; i < 4; ++i) {
                lv_obj_remove_state(buttons_[i],
                                    static_cast<lv_state_t>(LV_STATE_DISABLED | LV_STATE_CHECKED));
                lv_obj_set_style_bg_color(buttons_[i], lv_color_hex(kBackground), 0);
                lv_obj_set_style_border_color(buttons_[i], lv_color_hex(kBorder), 0);
                if (i < choice.count)
                    lv_label_set_text(lv_obj_get_child(buttons_[i], 0), choice.labels[i].c_str());
            }
            ApplyLayout();
            Application::GetInstance().GetAudioService().EnableVoiceProcessing(false);
            UpdateVisualState(!Application::GetInstance().GetAudioService().IsPlaybackIdle());
        });
    return true;
}

void PersonaDisplay::Select(int index) {
    if (request_.empty() || submitted_)
        return;
    if (index >= 0 && (index > 3 || option_ids_[index].empty()))
        return;
    if (esp_timer_get_time() >= expires_ && index != -2)
        index = -2;
    submitted_ = true;
    for (auto button : buttons_)
        lv_obj_add_state(button, LV_STATE_DISABLED);
    lv_obj_add_state(cancel_button_, LV_STATE_DISABLED);
    if (index >= 0) {
        lv_obj_add_state(buttons_[index], LV_STATE_CHECKED);
        lv_obj_set_style_bg_color(buttons_[index], lv_color_hex(0x0E2639), 0);
        lv_obj_set_style_border_color(buttons_[index], lv_color_hex(kCyan), 0);
    }
    std::string session = session_, request = request_;
    std::string option = index >= 0 ? option_ids_[index] : "";
    std::string reason = index == -2 ? "timeout" : index < 0 ? "cancel" : "selected";
    const uint32_t generation = session_generation_.load();
    const uint32_t turn_generation = Application::GetInstance().GetPersonaEventGeneration();
    Application::GetInstance().Schedule(
        [this, session, request, option, reason, generation, turn_generation] {
            if (!Application::GetInstance().IsPersonaMessageCurrent(session, turn_generation) ||
                generation != session_generation_.load())
                return;
            cJSON* event = cJSON_CreateObject();
            cJSON_AddStringToObject(event, "type", "ui.select");
            cJSON_AddStringToObject(event, "session_id", session.c_str());
            cJSON_AddStringToObject(event, "request_id", request.c_str());
            cJSON_AddStringToObject(event, "reason", reason.c_str());
            if (!option.empty())
                cJSON_AddStringToObject(event, "option_id", option.c_str());
            bool sent = Application::GetInstance().SendDeviceEvent(event);
            cJSON_Delete(event);
            if (!sent) {
                DisplayLockGuard lock(this);
                if (request_ == request && session_ == session) {
                    ClearOptions();
                    ShowNotification("连接已断开，请重新提问");
                }
            }
        });
    UpdateVisualState(!Application::GetInstance().GetAudioService().IsPlaybackIdle());
}
void PersonaDisplay::Talk(bool end_if_active) {
    if (local_test_ || Application::GetInstance().GetDeviceState() == kDeviceStateWifiConfiguring)
        return;
    auto& app = Application::GetInstance();
    if (end_if_active && !app.IsConversationStopped() &&
        persona::IsPersonaConversationActive(
            app.GetDeviceState(), !app.GetAudioService().IsPlaybackIdle(), awaiting_.load(),
            persona_state_ == "thinking" || persona_state_ == "tool" ||
                persona_state_ == "tool_running")) {
        StopConversation("main");
        return;
    }
    if (!request_.empty() && !submitted_)
        Select(-1);
    ClearOptions();
    ClearTransientNotice();
    persona_state_.clear();
    persona_message_.clear();
    Application::GetInstance().ToggleChatState();
}
void PersonaDisplay::Click(lv_event_t* event) {
    auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(event));
    auto target = static_cast<lv_obj_t*>(lv_event_get_current_target(event));
    int action = intptr_t(lv_obj_get_user_data(target));
    if (action == 10)
        self->SettingsUI();
    else if (action == 13)
        self->ShowMission();
    else if (action == 14)
        Visible(self->mission_panel_, false);
    else if (action >= 15 && action <= 17)
        self->ControlMission(action == 15 ? "pause" : action == 16 ? "resume" : "cancel");
    else if (action == 12)
        self->CloseMonitor();
    else if (action >= 1 && action <= 4)
        self->Select(action - 1);
    else if (action == 5)
        self->Select(-1);
    else if (action == 6)
        self->Talk();
    else
        self->Talk(true);
}

bool PersonaDisplay::HandleMissionMessage(const cJSON* root, const std::string& session) {
    std::string type;
    if (!Text(root, "type", type, 40) || type != "mission.status")
        return false;
    persona::MissionStatus status;
    if (!persona::ParseMissionStatus(root, session, status))
        return true;
    const uint32_t generation = session_generation_.load();
    // This management state is independent of the audio turn generation.
    Application::GetInstance().Schedule([this, status = std::move(status), generation] {
        DisplayLockGuard lock(this);
        if (generation != session_generation_.load())
            return;
        if (mission_view_.Apply(status))
            RefreshMission();
    });
    return true;
}

void PersonaDisplay::RefreshMission() {
    if (!mission_button_ || !mission_panel_)
        return;
    Visible(mission_button_, false);
    const auto& status = mission_view_.Status();
    const char* state = persona::MissionStateLabel(status.state);
    const auto summary = std::string("任务 · ") + state;
    ButtonText(mission_button_, summary.c_str());
    lv_label_set_text(mission_title_, status.title.empty() ? "当前没有任务" : status.title.c_str());
    const auto detail = std::string(state) +
                        (!status.id.empty() && !mission_view_.Connected() ? " · 已断开连接" : "");
    lv_label_set_text(mission_status_, detail.c_str());
    lv_label_set_text(mission_message_, status.message.empty()
                                            ? (status.id.empty() ? "可在网页决策 agent 中创建任务。"
                                                                 : "任务由工作站管理。")
                                            : status.message.c_str());
    const char* actions[] = {"pause", "resume", "cancel"};
    for (int i = 0; i < 3; ++i) {
        if (mission_view_.CanControl(actions[i]))
            lv_obj_remove_state(mission_controls_[i], LV_STATE_DISABLED);
        else
            lv_obj_add_state(mission_controls_[i], LV_STATE_DISABLED);
    }
}

void PersonaDisplay::ShowMission() {
    DisplayLockGuard lock(this);
    CloseMonitor();
    RefreshMission();
    Visible(mission_panel_, true);
    lv_obj_move_foreground(mission_panel_);
}

void PersonaDisplay::RobotStop() {
    // No microphone changes, no conversation abort, and no mission needed.
    Application::GetInstance().Schedule([this] {
        char request[64];
        std::snprintf(request, sizeof(request), "stop-%08" PRIx32 "-%" PRId64, esp_random(),
                      esp_timer_get_time());
        auto event = persona::RobotStopEvent(request);
        const bool accepted = Application::GetInstance().SendManagementEvent(event);
        cJSON_Delete(event);
        if (!accepted)
            ShowNotification("停止请求未发送，请检查连接", 6000);
    });
}

void PersonaDisplay::ControlMission(const char* action) {
    if (!mission_view_.CanControl(action))
        return;
    const std::string requested_action = action;
    const auto snapshot = mission_view_;
    const uint32_t generation = session_generation_.load();
    mission_view_.Submitted();
    RefreshMission();
    Application::GetInstance().Schedule([this, snapshot, requested_action, generation] {
        if (generation != session_generation_.load())
            return;
        char request[64];
        std::snprintf(request, sizeof(request), "mission-%08" PRIx32 "-%" PRId64, esp_random(),
                      esp_timer_get_time());
        auto event = persona::MissionControlEvent(snapshot, requested_action, request);
        const bool sent = Application::GetInstance().SendManagementEvent(event);
        cJSON_Delete(event);
        ShowNotification(sent ? "任务请求已发送，等待确认" : "任务请求未发送，请检查连接", 4000);
    });
}

void PersonaDisplay::CloseSettings() {
    persona::ui::HideCompanionSettings(settings_, settings_back_, keyboard_);
    persona::ui::ResetCompanionMotion(home_.pet);
}
void PersonaDisplay::StopConversation(const char* source) {
    CloseMonitor();
    if (!stop_button_ || local_test_ ||
        Application::GetInstance().GetDeviceState() == kDeviceStateWifiConfiguring)
        return;
    ClearOptions();
    persona_state_.clear();
    persona_message_.clear();
    sad_ = false;
    ESP_LOGI("PersonaUI", "Stop conversation requested: source=%s", source);
    ShowNotification("对话已结束，可用你好小智再次唤醒");
    Application::GetInstance().EndConversation();
}
void PersonaDisplay::SyncSettingsValues(int64_t now) {
    // MCP can change these values while this page is open. Do not fight a finger
    // or overwrite a just-released value before the application task applies it.
    auto sync = [now](lv_obj_t* slider, lv_obj_t* label, int actual, int minimum, int64_t after) {
        if (!slider || now < after || lv_slider_is_dragged(slider) ||
            lv_obj_has_state(slider, LV_STATE_PRESSED))
            return;
        const int position = std::clamp(actual, minimum, 100);
        if (lv_slider_get_value(slider) != position)
            lv_slider_set_value(slider, position, LV_ANIM_OFF);
        char text[16];
        std::snprintf(text, sizeof(text), "%d%%", actual);
        if (std::strcmp(lv_label_get_text(label), text) != 0)
            lv_label_set_text(label, text);
    };
    auto& board = Board::GetInstance();
    if (auto codec = board.GetAudioCodec())
        sync(volume_slider_, volume_value_, codec->output_volume(), 0, volume_sync_after_);
    if (auto backlight = board.GetBacklight())
        sync(brightness_slider_, brightness_value_, backlight->brightness(), 5,
             brightness_sync_after_);
}
void PersonaDisplay::SettingsUI() {
    if (settings_) {
        Visible(settings_, true);
        lv_obj_move_foreground(settings_);
        if (settings_back_) {
            Visible(settings_back_, true);
            lv_obj_move_foreground(settings_back_);
        }
        SyncSettingsValues(esp_timer_get_time());
        return;
    }
    auto screen = lv_display_get_screen_active(display_);
    settings_ = Panel(screen, kBackground, 0);
    Bounds(settings_, {0, 0, 800, 480});
    settings_title_ = Label(settings_, "连接与声音", 24, 16, 440);
    Ellipsis(settings_title_, 42);
    Settings ws("websocket");
    Label(settings_, "服务器", 24, 87, 150);
    url_ = lv_textarea_create(settings_);
    Bounds(url_, {176, 74, 600, 60});
    lv_textarea_set_one_line(url_, true);
    lv_textarea_set_max_length(url_, 256);
    lv_textarea_set_text(url_, ws.GetString("url").c_str());
    Label(settings_, "设备令牌", 24, 154, 150);
    token_ = lv_textarea_create(settings_);
    Bounds(token_, {176, 142, 600, 60});
    lv_textarea_set_one_line(token_, true);
    lv_textarea_set_password_mode(token_, true);
    lv_textarea_set_max_length(token_, 256);
    lv_textarea_set_text(token_, ws.GetString("token").c_str());
    lv_textarea_set_placeholder_text(token_, "Optional for registered devices");
    for (auto field : {url_, token_}) {
        lv_obj_set_style_bg_color(field, lv_color_hex(kPanel), 0);
        lv_obj_set_style_border_color(field, lv_color_hex(kBorder), 0);
        lv_obj_set_style_border_color(field, lv_color_hex(kCyan), LV_STATE_FOCUSED);
        lv_obj_set_style_text_color(field, lv_color_hex(kText), 0);
        lv_obj_set_style_radius(field, 6, 0);
    }
    auto save = Button(settings_, "保存并重启", 24, 222, 232, 56, true);
    lv_obj_add_event_cb(
        save,
        [](lv_event_t* e) {
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(e));
            std::string url = lv_textarea_get_text(self->url_),
                        token = lv_textarea_get_text(self->token_);
            if ((url.rfind("ws://", 0) != 0 && url.rfind("wss://", 0) != 0) || url.size() < 9 ||
                url.find_first_of(" \r\n") != std::string::npos) {
                self->ShowNotification("请输入有效的 ws:// 或 wss:// 地址", 5000);
                return;
            }
            Application::GetInstance().Schedule([url, token] {
                {
                    Settings ws("websocket", true);
                    ws.SetString("url", url);
                    ws.SetString("token", token);
                    ws.SetInt("version", 1);
                }
                Application::GetInstance().Reboot();
            });
        },
        LV_EVENT_CLICKED, this);
    auto wifi = Button(settings_, "重新配网", 272, 222, 208, 56);
    lv_obj_add_event_cb(
        wifi,
        [](lv_event_t* e) {
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(e));
            if (self->local_test_) {
                self->ShowNotification("录音回放结束后再重新配网");
                return;
            }
            self->CloseSettings();
            self->ShowNotification("正在准备配网，请稍候");
            Application::GetInstance().Schedule(
                [] { static_cast<WifiBoard&>(Board::GetInstance()).EnterWifiConfigMode(); });
        },
        LV_EVENT_CLICKED, this);
    test_button_ = Button(settings_, "录音回放测试", 496, 222, 280, 56);
    lv_obj_add_event_cb(
        test_button_,
        [](lv_event_t* e) {
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(e));
            Application::GetInstance().Schedule([self] { self->ToggleLocalTest(); });
        },
        LV_EVENT_CLICKED, this);

    Label(settings_, "音量", 24, 304, 120);
    volume_value_ = Label(settings_, "", 674, 304, 102);
    auto volume = volume_slider_ = lv_slider_create(settings_);
    Bounds(volume, {160, 319, 478, 14});
    lv_slider_set_range(volume, 0, 100);
    lv_slider_set_value(volume, Board::GetInstance().GetAudioCodec()->output_volume(), LV_ANIM_OFF);
    Label(settings_, "亮度", 24, 362, 120);
    brightness_value_ = Label(settings_, "", 674, 362, 102);
    auto light = brightness_slider_ = lv_slider_create(settings_);
    Bounds(light, {160, 377, 478, 14});
    lv_slider_set_range(light, 5, 100);
    lv_slider_set_value(light, Board::GetInstance().GetBacklight()->brightness(), LV_ANIM_OFF);
    for (auto slider : {volume, light}) {
        lv_obj_set_style_bg_color(slider, lv_color_hex(kBorder), LV_PART_MAIN);
        lv_obj_set_style_bg_color(slider, lv_color_hex(kCyan), LV_PART_INDICATOR);
        lv_obj_set_style_bg_color(slider, lv_color_hex(kCyan), LV_PART_KNOB);
        lv_obj_set_ext_click_area(slider, 18);
    }
    lv_obj_add_event_cb(
        volume,
        [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED &&
                lv_event_get_code(e) != LV_EVENT_RELEASED)
                return;
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(e));
            int value = lv_slider_get_value(static_cast<lv_obj_t*>(lv_event_get_target(e)));
            char text[16];
            std::snprintf(text, sizeof(text), "%d%%", value);
            lv_label_set_text(self->volume_value_, text);
            if (lv_event_get_code(e) == LV_EVENT_RELEASED) {
                self->volume_sync_after_ = esp_timer_get_time() + 750000;
                Application::GetInstance().Schedule(
                    [value] { Board::GetInstance().GetAudioCodec()->SetOutputVolume(value); });
            }
        },
        LV_EVENT_ALL, this);
    lv_obj_add_event_cb(
        light,
        [](lv_event_t* e) {
            if (lv_event_get_code(e) != LV_EVENT_VALUE_CHANGED &&
                lv_event_get_code(e) != LV_EVENT_RELEASED)
                return;
            auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(e));
            int value = lv_slider_get_value(static_cast<lv_obj_t*>(lv_event_get_target(e)));
            char text[16];
            std::snprintf(text, sizeof(text), "%d%%", value);
            lv_label_set_text(self->brightness_value_, text);
            if (lv_event_get_code(e) == LV_EVENT_RELEASED) {
                self->brightness_sync_after_ = esp_timer_get_time() + 750000;
                Application::GetInstance().Schedule(
                    [value] { Board::GetInstance().GetBacklight()->SetBrightness(value, true); });
            }
        },
        LV_EVENT_ALL, this);
    char value[16];
    std::snprintf(value, sizeof(value), "%d%%", static_cast<int>(lv_slider_get_value(volume)));
    lv_label_set_text(volume_value_, value);
    std::snprintf(value, sizeof(value), "%d%%", static_cast<int>(lv_slider_get_value(light)));
    lv_label_set_text(brightness_value_, value);
    test_status_ = Label(settings_, "录音 5 秒后自动回放", 24, 423, 558);
    Ellipsis(test_status_, 40);
    diagnostics_ = Label(settings_, "MIC RMS 0", 600, 435, 176);
    lv_obj_set_style_text_font(diagnostics_, &font_noto_sans_basic_14_1, 0);
    lv_obj_set_style_text_color(diagnostics_, lv_color_hex(kMuted), 0);
    lv_obj_set_style_text_align(diagnostics_, LV_TEXT_ALIGN_RIGHT, 0);
    keyboard_ = lv_keyboard_create(settings_);
    lv_obj_set_size(keyboard_, 800, 266);
    lv_obj_align(keyboard_, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_bg_color(keyboard_, lv_color_hex(kPanel), 0);
    lv_obj_set_style_bg_color(keyboard_, lv_color_hex(0x14202C), LV_PART_ITEMS);
    lv_obj_set_style_text_color(keyboard_, lv_color_hex(kText), LV_PART_ITEMS);
    Visible(keyboard_, false);
    for (auto field : {url_, token_})
        lv_obj_add_event_cb(
            field,
            [](lv_event_t* e) {
                if (lv_event_get_code(e) != LV_EVENT_FOCUSED &&
                    lv_event_get_code(e) != LV_EVENT_CLICKED)
                    return;
                auto self = static_cast<PersonaDisplay*>(lv_event_get_user_data(e));
                lv_keyboard_set_textarea(self->keyboard_,
                                         static_cast<lv_obj_t*>(lv_event_get_target(e)));
                Visible(self->keyboard_, true);
                lv_obj_move_foreground(self->keyboard_);
            },
            LV_EVENT_ALL, this);
    lv_obj_add_event_cb(
        keyboard_,
        [](lv_event_t* e) {
            if (lv_event_get_code(e) == LV_EVENT_READY || lv_event_get_code(e) == LV_EVENT_CANCEL)
                Visible(static_cast<lv_obj_t*>(lv_event_get_target(e)), false);
        },
        LV_EVENT_ALL, this);
    // Keep navigation above the full-screen settings sheet and its keyboard.
    // This dedicated root-level hit target remains reachable in every settings state.
    settings_back_ = Button(screen, "返回主页", 668, 8, 108, 48, true);
    lv_obj_add_event_cb(
        settings_back_,
        [](lv_event_t* e) {
            if (lv_event_get_code(e) == LV_EVENT_CLICKED)
                static_cast<PersonaDisplay*>(lv_event_get_user_data(e))->CloseSettings();
        },
        LV_EVENT_CLICKED, this);
}
