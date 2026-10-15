#pragma once

#include <lvgl.h>
#include "persona_ui_feedback.h"
#include "persona_ui_model.h"

namespace persona::ui {
inline constexpr Rect kMissionButtonBounds{24, 10, 180, 44};
inline constexpr Rect kRobotStopBounds{488, 10, 166, 44};
inline constexpr Rect kMissionPanelBounds{24, 64, 752, 342};

// Keep this separate from the conversation stop control. It fires on touch-down
// and stays reachable above captions, choices, images and task overlays.
inline lv_obj_t* CreateRobotStopControl(lv_obj_t* parent, lv_event_cb_t callback, void* context) {
    auto button = lv_button_create(parent);
    lv_obj_remove_style_all(button);
    lv_obj_remove_flag(button, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(button, kRobotStopBounds.x, kRobotStopBounds.y);
    lv_obj_set_size(button, kRobotStopBounds.width, kRobotStopBounds.height);
    lv_obj_set_style_bg_color(button, lv_color_hex(0x251319), 0);
    lv_obj_set_style_bg_opa(button, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(button, lv_color_hex(0xE7838B), 0);
    lv_obj_set_style_border_width(button, 1, 0);
    lv_obj_set_style_radius(button, 6, 0);
    lv_obj_set_style_text_color(button, lv_color_hex(0xE7838B), 0);
    InstallPressFeedback(button, 0xE7838B, 0xE7838B);
    lv_obj_set_style_text_color(button, lv_color_hex(0x07131D), LV_STATE_PRESSED);
    lv_obj_add_event_cb(button, callback, LV_EVENT_PRESSED, context);
    auto label = lv_label_create(button);
    lv_label_set_text(label, "机器人停止");
    lv_obj_remove_flag(label, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_center(label);
    return button;
}
}  // namespace persona::ui
