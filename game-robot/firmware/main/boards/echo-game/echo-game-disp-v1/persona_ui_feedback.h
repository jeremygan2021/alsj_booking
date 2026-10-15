#pragma once

#include <array>
#include <cstdint>
#include "lvgl.h"

namespace persona::ui {
// LVGL 9.5 dereferences a present LV_STYLE_TRANSITION property even when its
// value is null. Both state descriptors and their property array must outlive
// every object. A zero-duration descriptor gives press an immediate transition.
inline void InstallPressFeedback(lv_obj_t* object, uint32_t pressed_color, uint32_t border_color) {
    static const lv_style_prop_t properties[] = {LV_STYLE_BG_COLOR, LV_STYLE_BORDER_COLOR,
                                                 LV_STYLE_TEXT_COLOR, LV_STYLE_PROP_INV};
    static const lv_style_transition_dsc_t release = [] {
        lv_style_transition_dsc_t value;
        lv_style_transition_dsc_init(&value, properties, lv_anim_path_ease_out, 120, 0, nullptr);
        return value;
    }();
    static const lv_style_transition_dsc_t press = [] {
        lv_style_transition_dsc_t value;
        lv_style_transition_dsc_init(&value, properties, lv_anim_path_linear, 0, 0, nullptr);
        return value;
    }();
    lv_obj_set_style_transition(object, &release, LV_STATE_DEFAULT);
    lv_obj_set_style_transition(object, &press, LV_STATE_PRESSED);
    lv_obj_set_style_bg_color(object, lv_color_hex(pressed_color), LV_STATE_PRESSED);
    lv_obj_set_style_border_color(object, lv_color_hex(border_color), LV_STATE_PRESSED);
}
inline void SetFacePressedParts(lv_event_code_t code, const std::array<lv_obj_t*, 3>& parts) {
    if (code != LV_EVENT_PRESSED && code != LV_EVENT_RELEASED && code != LV_EVENT_PRESS_LOST)
        return;
    for (auto part : parts) {
        if (code == LV_EVENT_PRESSED)
            lv_obj_add_state(part, LV_STATE_PRESSED);
        else
            lv_obj_remove_state(part, LV_STATE_PRESSED);
    }
}
}  // namespace persona::ui
