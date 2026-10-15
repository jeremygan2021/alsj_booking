#pragma once

#include "companion_pet_ui.h"
#include "persona_stop_control.h"

namespace persona::ui {
inline constexpr uint32_t kCompanionBackground = 0x102E28;
inline constexpr uint32_t kCompanionText = 0xE8F6ED;
inline constexpr uint32_t kCompanionMuted = 0x90B8A6;
inline void ConfigureCompanionScreen(lv_obj_t* screen) {
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x14342E), 0);
    lv_obj_set_style_bg_grad_color(screen, lv_color_hex(0x0E211E), 0);
    lv_obj_set_style_bg_grad_dir(screen, LV_GRAD_DIR_NONE, 0);
    lv_obj_set_style_text_color(screen, lv_color_hex(kCompanionText), 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
}
inline lv_obj_t* CompanionButton(lv_obj_t* parent, const char* text, int x, int y, int w, int h,
                                 bool primary = false) {
    auto button = lv_button_create(parent);
    lv_obj_remove_style_all(button);
    lv_obj_remove_flag(button, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(button, x, y);
    lv_obj_set_size(button, w, h);
    lv_obj_set_style_bg_color(button, lv_color_hex(primary ? 0xA5E5C9 : 0x183C32), 0);
    lv_obj_set_style_bg_opa(button, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(button, lv_color_hex(primary ? 0x153F2C : kCompanionText), 0);
    lv_obj_set_style_text_color(button, lv_color_hex(0x153F2C), LV_STATE_PRESSED);
    lv_obj_set_style_border_color(button, lv_color_hex(primary ? 0xA5E5C9 : 0x365C4C), 0);
    lv_obj_set_style_border_width(button, 1, 0);
    lv_obj_set_style_radius(button, 14, 0);
    InstallPressFeedback(button, 0xD7F6E5, 0xD7F6E5);
    lv_obj_set_style_opa(button, LV_OPA_60, LV_STATE_DISABLED);
    lv_obj_set_style_opa(button, LV_OPA_COVER, LV_STATE_DISABLED | LV_STATE_CHECKED);
    auto label = AgentLabel(button, 0, 0, w - 24, text, primary ? 0x153F2C : kCompanionText);
    // Inherit pressed text from the button rather than pinning label color.
    lv_obj_remove_local_style_prop(label, LV_STYLE_TEXT_COLOR, LV_PART_MAIN);
    lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(label);
    return button;
}
struct CompanionHomeView {
    CompanionPet pet;
    lv_obj_t* face = nullptr;
    lv_obj_t* title = nullptr;
    lv_obj_t* status = nullptr;
    lv_obj_t* status_group = nullptr;
    lv_obj_t* status_dot = nullptr;
    lv_obj_t* status_label = nullptr;
    lv_obj_t* mission = nullptr;
    lv_obj_t* settings = nullptr;
    lv_obj_t* network = nullptr;
    lv_obj_t* caption_panel = nullptr;
    lv_obj_t* caption_scroll = nullptr;
    lv_obj_t* caption = nullptr;
    lv_obj_t* role = nullptr;
    lv_obj_t* hint = nullptr;
    lv_obj_t* talk = nullptr;
    StopControl stop{};
    lv_obj_t* footer = nullptr;
    lv_obj_t* signature = nullptr;
};
inline CompanionHomeView CreateCompanionHome(lv_obj_t* screen, const lv_font_t* small_font,
                                             lv_event_cb_t stop_callback, void* context) {
    CompanionHomeView view;
    ConfigureCompanionScreen(screen);
    view.mission = CompanionButton(screen, "任务 · 无任务", 24, 10, 180, 44);
    view.settings = CompanionButton(screen, "设置", 668, 10, 108, 44);
    view.network = AgentLabel(screen, 210, 16, 34, "", kCompanionMuted);
    view.status_group = AgentShape(screen, 248, 10, 394, 44, kCompanionBackground);
    lv_obj_set_style_bg_opa(view.status_group, LV_OPA_TRANSP, 0);
    view.status_dot = AgentShape(view.status_group, 2, 18, 6, 6, 0x9EDAC0, LV_RADIUS_CIRCLE);
    view.status_label =
        AgentLabel(view.status_group, 18, 10, 370, "我在这里 · 未在倾听", kCompanionMuted);
    lv_label_set_long_mode(view.status_label, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.status_label, 28);
    view.title = AgentLabel(screen, 30, 68, 282, "ECHO · 档案助理", kCompanionText);
    const auto layout = MakeLayout(false);
    view.face = AgentShape(screen, layout.face.x, layout.face.y, layout.face.width,
                           layout.face.height, kCompanionBackground);
    lv_obj_set_style_bg_opa(view.face, LV_OPA_TRANSP, 0);
    lv_obj_add_flag(view.face, LV_OBJ_FLAG_CLICKABLE);
    CreateCompanionPet(view.pet, view.face, 0, 10, screen, 330, 380);
    view.status = AgentLabel(screen, 448, 362, 328, "等待问询", kCompanionMuted);
    lv_label_set_long_mode(view.status, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.status, 27);
    view.caption_panel =
        AgentShape(screen, layout.subtitle.x, layout.subtitle.y, layout.subtitle.width,
                   layout.subtitle.height, 0x24483A, 22, 0x1C3D31);
    AgentOutline(view.caption_panel, 0x426954, 1);
    view.role = AgentLabel(view.caption_panel, 14, 9, 120, "提示", kCompanionMuted);
    view.hint = AgentLabel(view.caption_panel, layout.subtitle.width - 138, 9, 124, "上下滑动",
                           kCompanionMuted);
    lv_obj_set_style_text_align(view.hint, LV_TEXT_ALIGN_RIGHT, 0);
    if (small_font) {
        lv_obj_set_style_text_font(view.hint, small_font, 0);
    }
    AgentVisible(view.hint, false);
    view.caption_scroll = lv_obj_create(view.caption_panel);
    lv_obj_remove_style_all(view.caption_scroll);
    lv_obj_remove_flag(view.caption_scroll, LV_OBJ_FLAG_SCROLL_ELASTIC);
    lv_obj_add_flag(view.caption_scroll, LV_OBJ_FLAG_SCROLLABLE);
    const auto viewport = CaptionViewport(layout.subtitle);
    lv_obj_set_pos(view.caption_scroll, viewport.x, viewport.y);
    lv_obj_set_size(view.caption_scroll, viewport.width, viewport.height);
    lv_obj_set_scroll_dir(view.caption_scroll, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(view.caption_scroll, LV_SCROLLBAR_MODE_AUTO);
    lv_obj_set_style_bg_color(view.caption_scroll, lv_color_hex(kCompanionMuted),
                              LV_PART_SCROLLBAR);
    lv_obj_set_style_bg_opa(view.caption_scroll, LV_OPA_COVER, LV_PART_SCROLLBAR);
    lv_obj_set_style_width(view.caption_scroll, 3, LV_PART_SCROLLBAR);
    view.caption = AgentLabel(view.caption_scroll, 0, 0, viewport.width - 8,
                              "我在这里。\n叫一声“你好小智”，或轻触ECHO。", kCompanionText);
    lv_obj_set_style_text_line_space(view.caption, 7, 0);
    view.footer = AgentLabel(screen, 24, 429, 172, "等待问询", kCompanionMuted);
    lv_label_set_long_mode(view.footer, LV_LABEL_LONG_DOT);
    lv_obj_set_height(view.footer, 34);
    view.talk = CompanionButton(screen, "开始对话", 208, 414, 204, 54, true);
    view.stop = CreateStopControl(screen, stop_callback, context);
    AgentVisible(view.stop.button, false);
    view.signature = AgentLabel(screen, 606, 434, 170, "ECHO · 案情问答", kCompanionMuted);
    if (small_font)
        lv_obj_set_style_text_font(view.signature, small_font, 0);
    lv_obj_set_style_text_align(view.signature, LV_TEXT_ALIGN_RIGHT, 0);
    return view;
}
inline void SetCompanionHomeArtVisible(CompanionHomeView& view, bool visible) {
    AgentVisible(view.pet.pet, visible);
    AgentVisible(view.pet.ground, visible);
    AgentVisible(view.title, visible);
    AgentVisible(view.status, visible);
    for (auto bar : view.pet.activity)
        AgentVisible(bar, visible);
}
inline void SetCompanionHomeLayout(CompanionHomeView& view, bool compact,
                                   const lv_font_t* small_font = nullptr) {
    const auto layout = MakeLayout(compact);
    lv_obj_set_pos(view.face, layout.face.x, layout.face.y);
    lv_obj_set_size(view.face, layout.face.width, layout.face.height);
    SetCompanionHomeArtVisible(view, !compact);
    lv_obj_set_pos(view.caption_panel, layout.subtitle.x, layout.subtitle.y);
    lv_obj_set_size(view.caption_panel, layout.subtitle.width, layout.subtitle.height);
    lv_obj_set_style_bg_opa(view.caption_panel, compact ? LV_OPA_TRANSP : LV_OPA_COVER, 0);
    lv_obj_set_style_radius(view.caption_panel, compact ? 0 : 22, 0);
    lv_obj_set_style_border_side(view.caption_panel,
                                 compact ? LV_BORDER_SIDE_TOP : LV_BORDER_SIDE_FULL, 0);
    if (compact && small_font)
        lv_obj_set_style_text_font(view.role, small_font, 0);
    else
        lv_obj_remove_local_style_prop(view.role, LV_STYLE_TEXT_FONT, LV_PART_MAIN);
    const auto viewport = CaptionViewport(layout.subtitle);
    lv_obj_set_pos(view.caption_scroll, viewport.x, viewport.y);
    lv_obj_set_size(view.caption_scroll, viewport.width, viewport.height);
    lv_obj_set_width(view.caption, viewport.width - 8);
    lv_obj_set_pos(view.hint, layout.subtitle.width - 138, 8);
    SetStopControlLayout(view.stop, compact);
    AgentVisible(view.talk, !compact);
    AgentVisible(view.footer, !compact);
    AgentVisible(view.signature, !compact);
    ResetCompanionMotion(view.pet);
}
inline void OpenCompanionHomeMonitor(CompanionHomeView& view, lv_obj_t* panel) {
    AgentVisible(panel, true);
    AgentVisible(view.face, false);
    AgentVisible(view.caption_panel, false);
    ResetCompanionMotion(view.pet);
    lv_obj_move_foreground(panel);
}
inline void DismissCompanionHomeMonitor(CompanionHomeView& view, lv_obj_t* panel) {
    AgentVisible(panel, false);
    AgentVisible(view.face, true);
    AgentVisible(view.caption_panel, true);
    ResetCompanionMotion(view.pet);
}
inline void SetCompanionConversationControls(CompanionHomeView& view, bool active, bool compact,
                                             bool enabled) {
    // The compact choice screen always retains its dedicated end control.
    AgentVisible(view.stop.button, active || compact);
    SetStopControlActive(view.stop, enabled);
}
}  // namespace persona::ui
