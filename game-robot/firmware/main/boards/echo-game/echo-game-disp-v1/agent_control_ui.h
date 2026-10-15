#pragma once

#include <lvgl.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include "companion_pet_ui.h"
#include "persona_ui_model.h"

namespace persona::ui {
inline constexpr Rect kAgentReleaseBounds{562, 398, 208, 58};
struct AgentControlOverlay : CompanionPet {
    lv_obj_t* panel = nullptr;
    lv_obj_t* title = nullptr;
    lv_obj_t* mission = nullptr;
    lv_obj_t* release = nullptr;
    lv_obj_t* status = nullptr;
    lv_obj_t* assistant = nullptr;
    lv_obj_t* reply = nullptr;
    lv_obj_t* reply_card = nullptr;
    enum class Phase { Waiting, Speaking, Listening, Transcribing, Done };
    Phase phase = Phase::Waiting;
};

inline AgentControlOverlay CreateAgentControlOverlay(lv_obj_t* top, const lv_font_t* font,
                                                     lv_event_cb_t callback, void* context) {
    AgentControlOverlay view;
    view.panel = AgentShape(top, 0, 0, 800, 480, 0x14342E);
    // This opaque top-layer surface catches all touches outside the sole button.
    lv_obj_add_flag(view.panel, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_text_color(view.panel, lv_color_hex(0xE9F7EF), 0);
    if (font)
        lv_obj_set_style_text_font(view.panel, font, 0);
    view.title = AgentLabel(view.panel, 30, 22, 480, "小智 · 你的机器人伙伴", 0xE7F6EE);
    auto badge = AgentShape(view.panel, 568, 20, 202, 36, 0x214A40, 18);
    AgentShape(badge, 13, 14, 8, 8, 0x8DDFC5, LV_RADIUS_CIRCLE);
    AgentLabel(badge, 30, 5, 165, "决策 Agent 接管", 0xABE0CF);
    view.mission = AgentLabel(view.panel, 30, 60, 740, "正在被决策 Agent 控制", 0x8AAF9F);
    lv_label_set_long_mode(view.mission, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.mission, 27);
    AgentShape(view.panel, 30, 91, 740, 1, 0x2C4D43);

    CreateCompanionPet(view, view.panel, 29, 105, view.panel, 328, 380);
    AgentLabel(view.panel, 88, 377, 212, "小智，陪你一起完成", 0x7EB09C);

    AgentLabel(view.panel, 328, 115, 200, "小智", 0xA5D5C1);
    auto question_card = AgentShape(view.panel, 326, 144, 444, 102, 0x25483C, 18, 0x203F34);
    AgentOutline(question_card, 0x416B58, 1);
    view.assistant =
        AgentLabel(question_card, 20, 17, 402, "我在这里，等待安排现场对话。", 0xE8F8ED);
    lv_label_set_long_mode(view.assistant, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.assistant, 72);
    auto reply_role = AgentLabel(view.panel, 650, 248, 120, "现场回复", 0x89BBA7);
    lv_obj_set_style_text_align(reply_role, LV_TEXT_ALIGN_RIGHT, 0);
    view.reply_card = AgentShape(view.panel, 365, 274, 405, 80, 0x17382F, 16);
    AgentOutline(view.reply_card, 0x305447, 1);
    view.reply = AgentLabel(view.reply_card, 18, 10, 369, "听完问题后，直接回答就好。", 0x7FA894);
    lv_label_set_long_mode(view.reply, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.reply, 62);
    view.status = AgentLabel(view.panel, 440, 361, 330, "准备中", 0x9ACAB5);
    lv_label_set_long_mode(view.status, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.status, 27);
    AgentLabel(view.panel, 30, 429, 510, "由决策 Agent 委派 · 你随时可以解除控制", 0x749F8C);
    view.release = lv_button_create(view.panel);
    lv_obj_remove_style_all(view.release);
    lv_obj_remove_flag(view.release, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(view.release, kAgentReleaseBounds.x, kAgentReleaseBounds.y);
    lv_obj_set_size(view.release, kAgentReleaseBounds.width, kAgentReleaseBounds.height);
    lv_obj_set_style_bg_color(view.release, lv_color_hex(0xA5E5C9), 0);
    lv_obj_set_style_bg_opa(view.release, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(view.release, 16, 0);
    lv_obj_set_style_text_color(view.release, lv_color_hex(0x153F2C), 0);
    InstallPressFeedback(view.release, 0xD7F6E5, 0xD7F6E5);
    lv_obj_set_style_text_color(view.release, lv_color_hex(0x153F2C), LV_STATE_PRESSED);
    lv_obj_add_event_cb(view.release, callback, LV_EVENT_PRESSED, context);
    auto label = lv_label_create(view.release);
    lv_label_set_text(label, "解除控制");
    lv_obj_remove_flag(label, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_center(label);
    lv_obj_add_flag(view.panel, LV_OBJ_FLAG_HIDDEN);
    return view;
}

inline void ResetAgentDialogue(AgentControlOverlay& view) {
    view.phase = AgentControlOverlay::Phase::Waiting;
    ResetCompanionMotion(view);
    lv_label_set_text(view.assistant, "我在这里，等待安排现场对话。");
    lv_label_set_text(view.reply, "听完问题后，直接回答就好。");
    lv_obj_set_style_text_color(view.reply, lv_color_hex(0x7FA894), 0);
    lv_label_set_text(view.status, "准备中");
}
inline void SetAgentDialogue(AgentControlOverlay& view, const char* role, const char* phase,
                             const char* text) {
    if (!view.panel || lv_obj_has_flag(view.panel, LV_OBJ_FLAG_HIDDEN))
        return;
    if (std::strcmp(phase, "speaking") == 0)
        view.phase = AgentControlOverlay::Phase::Speaking;
    else if (std::strcmp(phase, "listening") == 0)
        view.phase = AgentControlOverlay::Phase::Listening;
    else if (std::strcmp(phase, "transcribing") == 0)
        view.phase = AgentControlOverlay::Phase::Transcribing;
    else if (std::strcmp(phase, "done") == 0)
        view.phase = AgentControlOverlay::Phase::Done;
    else
        view.phase = AgentControlOverlay::Phase::Waiting;
    if (std::strcmp(role, "assistant") == 0) {
        lv_label_set_text(view.assistant, text);
        lv_label_set_text(view.reply, "听完问题后，直接回答就好。");
        lv_obj_set_style_text_color(view.reply, lv_color_hex(0x7FA894), 0);
    } else if (std::strcmp(role, "user") == 0) {
        lv_label_set_text(view.reply, text);
        lv_obj_set_style_text_color(view.reply, lv_color_hex(0xD0F1DF), 0);
    }
    const char* caption =
        view.phase == AgentControlOverlay::Phase::Speaking       ? "正在说话"
        : view.phase == AgentControlOverlay::Phase::Listening    ? "我在听，你可以回答了"
        : view.phase == AgentControlOverlay::Phase::Transcribing ? "正在理解刚才的回复"
        : view.phase == AgentControlOverlay::Phase::Done         ? "现场对话已结束"
                                                                 : "准备中";
    lv_label_set_text(view.status, std::strcmp(role, "status") == 0 ? text : caption);
}
inline void AnimateAgentPet(AgentControlOverlay& view, int64_t now_ms, int input_level = 0,
                            int output_level = 0) {
    if (!view.panel || lv_obj_has_flag(view.panel, LV_OBJ_FLAG_HIDDEN))
        return;
    const auto mode = view.phase == AgentControlOverlay::Phase::Speaking       ? FaceMode::Speaking
                      : view.phase == AgentControlOverlay::Phase::Listening    ? FaceMode::Listening
                      : view.phase == AgentControlOverlay::Phase::Transcribing ? FaceMode::Thinking
                                                                               : FaceMode::Idle;
    AnimateCompanionPet(view, mode, now_ms, input_level, output_level);
}
}  // namespace persona::ui
