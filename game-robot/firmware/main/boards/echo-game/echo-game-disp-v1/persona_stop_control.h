#pragma once

#include "persona_ui_feedback.h"
#include "persona_ui_model.h"

namespace persona::ui {
struct StopControl {
    lv_obj_t* button;
    lv_obj_t* icon;
    lv_obj_t* caption;
};
inline Rect StopControlBounds(bool choices) {
    return choices ? Rect{722, 368, 54, 58} : Rect{428, 414, 156, 54};
}
inline StopControl CreateStopControl(lv_obj_t* parent, lv_event_cb_t callback, void* context,
                                     const lv_font_t* font = nullptr) {
    auto button = lv_button_create(parent);
    lv_obj_remove_style_all(button);
    lv_obj_remove_flag(button, LV_OBJ_FLAG_SCROLLABLE);
    const auto rect = StopControlBounds(false);
    lv_obj_set_pos(button, rect.x, rect.y);
    lv_obj_set_size(button, rect.width, rect.height);
    lv_obj_set_style_bg_color(button, lv_color_hex(0x163B31), 0);
    lv_obj_set_style_bg_opa(button, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(button, lv_color_hex(0x6C4A4D), 0);
    lv_obj_set_style_border_width(button, 1, 0);
    lv_obj_set_style_radius(button, 14, 0);
    lv_obj_set_style_text_color(button, lv_color_hex(0xE7838B), 0);
    if (font)
        lv_obj_set_style_text_font(button, font, 0);
    lv_obj_set_style_opa(button, LV_OPA_60, LV_STATE_DISABLED);
    InstallPressFeedback(button, 0x8ACFFF, 0x8ACFFF);
    // Stop on touch-down; releasing outside the button must not undo the stop.
    lv_obj_add_event_cb(button, callback, LV_EVENT_PRESSED, context);
    auto icon = lv_obj_create(button);
    lv_obj_remove_style_all(icon);
    lv_obj_remove_flag(icon, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(icon, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(icon, 16, 16);
    lv_obj_set_style_bg_opa(icon, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(icon, lv_color_hex(0x8796A7), 0);
    lv_obj_set_style_radius(icon, 3, 0);
    lv_obj_align(icon, LV_ALIGN_LEFT_MID, 16, 0);
    auto caption = lv_label_create(button);
    lv_label_set_text(caption, "结束对话");
    lv_obj_remove_flag(caption, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_align(caption, LV_ALIGN_LEFT_MID, 48, 0);
    lv_obj_add_state(button, LV_STATE_DISABLED);
    return {button, icon, caption};
}
inline void SetStopControlLayout(StopControl control, bool choices) {
    const auto rect = StopControlBounds(choices);
    lv_obj_set_pos(control.button, rect.x, rect.y);
    lv_obj_set_size(control.button, rect.width, rect.height);
    if (choices) {
        lv_obj_add_flag(control.caption, LV_OBJ_FLAG_HIDDEN);
        lv_obj_center(control.icon);
    } else {
        lv_obj_remove_flag(control.caption, LV_OBJ_FLAG_HIDDEN);
        lv_obj_align(control.icon, LV_ALIGN_LEFT_MID, 16, 0);
    }
}
inline void SetStopControlActive(StopControl control, bool active) {
    if (active == !lv_obj_has_state(control.button, LV_STATE_DISABLED))
        return;
    if (active)
        lv_obj_remove_state(control.button, LV_STATE_DISABLED);
    else
        lv_obj_add_state(control.button, LV_STATE_DISABLED);
    lv_obj_set_style_bg_color(control.icon, lv_color_hex(active ? 0xE7838B : 0x8796A7), 0);
}
}  // namespace persona::ui
