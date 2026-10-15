#pragma once
#include <lvgl.h>
#include "persona_ui_feedback.h"

namespace persona::ui {
struct MonitorPreview {
    lv_obj_t *panel = nullptr, *image = nullptr, *title = nullptr, *time = nullptr,
             *close = nullptr;
};
inline MonitorPreview CreateMonitorPreview(lv_obj_t* screen, const lv_font_t* font,
                                           const lv_font_t* small_font, lv_event_cb_t callback,
                                           void* user) {
    MonitorPreview card;
    card.panel = lv_obj_create(screen);
    lv_obj_remove_style_all(card.panel);
    lv_obj_remove_flag(card.panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(card.panel, 24, 66);
    lv_obj_set_size(card.panel, 752, 334);
    lv_obj_set_style_radius(card.panel, 12, 0);
    lv_obj_set_style_bg_color(card.panel, lv_color_hex(0x0E131A), 0);
    lv_obj_set_style_bg_opa(card.panel, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(card.panel, lv_color_hex(0x283340), 0);
    lv_obj_set_style_border_width(card.panel, 1, 0);
    card.title = lv_label_create(card.panel);
    lv_obj_set_pos(card.title, 18, 12);
    lv_obj_set_width(card.title, 312);
    lv_obj_set_style_text_font(card.title, font, 0);
    lv_obj_set_style_text_color(card.title, lv_color_hex(0xE7EDF4), 0);
    card.time = lv_label_create(card.panel);
    lv_obj_set_pos(card.time, 342, 16);
    lv_obj_set_width(card.time, 270);
    lv_obj_set_style_text_font(card.time, small_font, 0);
    lv_obj_set_style_text_color(card.time, lv_color_hex(0x8796A7), 0);
    card.close = lv_button_create(card.panel);
    lv_obj_set_pos(card.close, 628, 6);
    lv_obj_set_size(card.close, 108, 40);
    lv_obj_set_style_radius(card.close, 6, 0);
    lv_obj_set_style_bg_color(card.close, lv_color_hex(0x182430), 0);
    lv_obj_set_style_shadow_width(card.close, 0, 0);
    lv_obj_set_style_text_color(card.close, lv_color_hex(0x8ACFFF), 0);
    lv_obj_set_style_text_font(card.close, font, 0);
    persona::ui::InstallPressFeedback(card.close, 0x283D50, 0x8ACFFF);
    auto label = lv_label_create(card.close);
    lv_label_set_text(label, "关闭画面");
    lv_obj_center(label);
    lv_obj_set_user_data(card.close, reinterpret_cast<void*>(intptr_t(12)));
    lv_obj_add_event_cb(card.close, callback, LV_EVENT_CLICKED, user);
    card.image = lv_image_create(card.panel);
    lv_obj_remove_flag(card.image, LV_OBJ_FLAG_CLICKABLE);
    return card;
}
}  // namespace persona::ui
