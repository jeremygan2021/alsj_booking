#pragma once

#include <lvgl.h>
#include <cstdint>

namespace persona::ui {
struct ToolWaitView {
    lv_obj_t* spinner = nullptr;
    lv_obj_t* label = nullptr;
};

inline void SetToolWaitFont(ToolWaitView& view, const lv_font_t* font) {
    if (view.label && font)
        lv_obj_set_style_text_font(view.label, font, 0);
}

inline ToolWaitView CreateToolWait(lv_obj_t* layer, const lv_font_t* font, uint32_t text_color,
                                   uint32_t accent) {
    ToolWaitView view;
    view.spinner = lv_arc_create(layer);
    lv_obj_set_size(view.spinner, 36, 36);
    lv_obj_align(view.spinner, LV_ALIGN_TOP_MID, 0, 78);
    lv_arc_set_bg_angles(view.spinner, 0, 360);
    lv_arc_set_angles(view.spinner, 0, 90);
    lv_obj_remove_style(view.spinner, nullptr, LV_PART_KNOB);
    lv_obj_set_style_arc_width(view.spinner, 4, LV_PART_MAIN);
    lv_obj_set_style_arc_width(view.spinner, 4, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(view.spinner, lv_color_hex(accent), LV_PART_INDICATOR);
    lv_obj_remove_flag(view.spinner, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(view.spinner, LV_OBJ_FLAG_HIDDEN);
    view.label = lv_label_create(layer);
    lv_label_set_text(view.label, "正在执行，请稍候");
    lv_obj_set_style_text_color(view.label, lv_color_hex(text_color), 0);
    SetToolWaitFont(view, font);
    lv_obj_align(view.label, LV_ALIGN_TOP_MID, 0, 120);
    lv_obj_add_flag(view.label, LV_OBJ_FLAG_HIDDEN);
    return view;
}

inline void UpdateToolWait(ToolWaitView& view, bool active, int64_t now_us) {
    if (!view.spinner || !view.label)
        return;
    if (active) {
        lv_obj_remove_flag(view.spinner, LV_OBJ_FLAG_HIDDEN);
        lv_obj_remove_flag(view.label, LV_OBJ_FLAG_HIDDEN);
        lv_arc_set_rotation(view.spinner, (now_us / 2500) % 360);
    } else {
        lv_obj_add_flag(view.spinner, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(view.label, LV_OBJ_FLAG_HIDDEN);
    }
}
}  // namespace persona::ui
