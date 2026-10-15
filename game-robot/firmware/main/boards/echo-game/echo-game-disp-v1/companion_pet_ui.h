#pragma once

#include <lvgl.h>
#include <algorithm>
#include <cmath>
#include "persona_ui_feedback.h"
#include "persona_ui_model.h"

namespace persona::ui {
struct CompanionPet {
    lv_obj_t* pet = nullptr;
    lv_obj_t* head = nullptr;
    lv_obj_t* eyes[2] = {};
    lv_obj_t* eye_smiles[2] = {};
    lv_obj_t* mouth = nullptr;
    lv_obj_t* smile = nullptr;
    lv_obj_t* hand = nullptr;
    lv_obj_t* ground = nullptr;
    lv_obj_t* activity[11] = {};
    int base_y = 0, wave_y = 375;
    int pet_y = -100, head_y = -100, hand_y = -100, mouth_h = -1;
    int eye_h = -1, level = 0, activity_height[11] = {};
    int arm_rotation = -1000;
    int64_t next_frame_ms = 0;
};
inline lv_obj_t* AgentShape(lv_obj_t* parent, int x, int y, int width, int height, uint32_t color,
                            int radius = 0, uint32_t bottom = 0) {
    auto object = lv_obj_create(parent);
    lv_obj_remove_style_all(object);
    lv_obj_remove_flag(object, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(object, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_size(object, width, height);
    lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(object, radius, 0);
    if (bottom) {
        lv_obj_set_style_bg_grad_color(object, lv_color_hex(bottom), 0);
        lv_obj_set_style_bg_grad_dir(object, LV_GRAD_DIR_VER, 0);
    }
    return object;
}
inline lv_obj_t* AgentLabel(lv_obj_t* parent, int x, int y, int width, const char* text,
                            uint32_t color) {
    auto label = lv_label_create(parent);
    lv_obj_remove_flag(label, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(label, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(label, x, y);
    lv_obj_set_width(label, width);
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    lv_label_set_text(label, text);
    return label;
}
inline lv_obj_t* AgentLine(lv_obj_t* parent, int x, int y, const lv_point_precise_t* points,
                           uint32_t count, uint32_t color, int width) {
    auto line = lv_line_create(parent);
    lv_obj_remove_flag(line, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(line, x, y);
    lv_line_set_points(line, points, count);
    lv_obj_set_style_line_color(line, lv_color_hex(color), 0);
    lv_obj_set_style_line_width(line, width, 0);
    lv_obj_set_style_line_rounded(line, true, 0);
    return line;
}
inline void AgentOutline(lv_obj_t* object, uint32_t color, int width) {
    lv_obj_set_style_border_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_border_width(object, width, 0);
}
inline void AgentVisible(lv_obj_t* object, bool visible) {
    if (!object || visible == !lv_obj_has_flag(object, LV_OBJ_FLAG_HIDDEN))
        return;
    if (visible)
        lv_obj_remove_flag(object, LV_OBJ_FLAG_HIDDEN);
    else
        lv_obj_add_flag(object, LV_OBJ_FLAG_HIDDEN);
}

inline void CreateCompanionPet(CompanionPet& view, lv_obj_t* parent, int x, int y,
                               lv_obj_t* wave_parent, int wave_x, int wave_y) {
    view.ground = AgentShape(parent, x + 77, y + 261, 140, 10, 0x0B241D, LV_RADIUS_CIRCLE);
    lv_obj_set_style_bg_opa(view.ground, LV_OPA_30, 0);
    lv_obj_set_style_shadow_color(view.ground, lv_color_hex(0x0B241D), 0);
    lv_obj_set_style_shadow_width(view.ground, 14, 0);
    lv_obj_set_style_shadow_opa(view.ground, LV_OPA_20, 0);
    view.base_y = y;
    view.pet = AgentShape(parent, x, y, 270, 270, 0x173B34);
    lv_obj_set_style_bg_opa(view.pet, LV_OPA_TRANSP, 0);
    lv_obj_add_flag(view.pet, LV_OBJ_FLAG_OVERFLOW_VISIBLE);

    // Layered highlights, offset side panels and contact shadows give the mint
    // character depth without large bitmap assets or offscreen 3D buffers.
    AgentShape(view.pet, 133, 140, 25, 21, 0x77AC9C, 8);
    AgentShape(view.pet, 137, 143, 18, 16, 0xD4F0E1, 6);
    AgentShape(view.pet, 115, 229, 22, 27, 0x90C2AD, 9);
    AgentShape(view.pet, 155, 229, 22, 27, 0x83B8A3, 9);
    AgentShape(view.pet, 105, 238, 43, 20, 0xE6F7EB, 10, 0xA9D6BF);
    AgentShape(view.pet, 149, 239, 43, 20, 0xD9F0E2, 10, 0x96C7B0);
    AgentShape(view.pet, 111, 241, 30, 4, 0xF2FCF5, 3);
    AgentShape(view.pet, 155, 242, 29, 4, 0xE9F9EF, 3);
    AgentShape(view.pet, 97, 157, 108, 84, 0x659D86, 30, 0x49806C);
    auto chest = AgentShape(view.pet, 91, 151, 108, 86, 0xD8F1E2, 31);
    AgentOutline(chest, 0xD9F0E4, 2);
    AgentShape(view.pet, 106, 159, 77, 6, 0xF2FCF6, 4);
    AgentShape(view.pet, 126, 177, 39, 31, 0x477D68, 11, 0x6EAA90);
    AgentShape(view.pet, 129, 180, 33, 25, 0x79B59B, 9, 0x548C74);
    AgentShape(view.pet, 140, 185, 11, 11, 0xD8F5E5, LV_RADIUS_CIRCLE);
    AgentShape(view.pet, 145, 218, 5, 5, 0x78B297, LV_RADIUS_CIRCLE);
    // The whole forearm moves around its shoulder, so the hand never detaches.
    view.hand = AgentShape(view.pet, 191, 169, 37, 78, 0x173B34);
    lv_obj_set_style_bg_opa(view.hand, LV_OPA_TRANSP, 0);
    lv_obj_add_flag(view.hand, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    lv_obj_set_style_transform_pivot_x(view.hand, 9, 0);
    lv_obj_set_style_transform_pivot_y(view.hand, 11, 0);
    AgentShape(view.hand, 0, 0, 23, 24, 0xC6E9D6, LV_RADIUS_CIRCLE);
    AgentShape(view.hand, 5, 14, 20, 25, 0xADD9C2, 9, 0x79AC94);
    AgentShape(view.hand, 5, 32, 22, 22, 0xDCF3E4, LV_RADIUS_CIRCLE);
    AgentShape(view.hand, 6, 45, 18, 17, 0xB8E0CB, 8, 0x7BAE95);
    AgentShape(view.hand, 2, 56, 26, 22, 0x93C8AD, 10, 0x548B70);
    AgentShape(view.hand, 7, 58, 16, 5, 0xE3F6E9, 3);
    AgentShape(view.pet, 72, 170, 23, 24, 0xC1E5D0, LV_RADIUS_CIRCLE);
    AgentShape(view.pet, 72, 184, 20, 26, 0xBCE2CE, 9, 0x7BAE96);
    AgentShape(view.pet, 71, 201, 22, 23, 0xDDF4E5, LV_RADIUS_CIRCLE);
    AgentShape(view.pet, 73, 216, 17, 17, 0xAED8C1, 8, 0x76A88F);
    AgentShape(view.pet, 67, 227, 26, 23, 0x91C7AC, 10, 0x5C947A);
    AgentShape(view.pet, 73, 230, 15, 5, 0xE1F4E7, 3);

    view.head = AgentShape(view.pet, 0, 0, 270, 160, 0x173B34);
    lv_obj_set_style_bg_opa(view.head, LV_OPA_TRANSP, 0);
    lv_obj_add_flag(view.head, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    AgentShape(view.head, 145, 10, 4, 25, 0xA7DAC7, 2);
    AgentShape(view.head, 141, 3, 12, 12, 0xBDEAD7, LV_RADIUS_CIRCLE);
    AgentShape(view.head, 78, 32, 154, 122, 0x77B5A0, 33, 0x467F6F);
    AgentShape(view.head, 62, 69, 12, 41, 0x8CC6B0, 6);
    AgentShape(view.head, 226, 71, 12, 39, 0x478576, 6, 0x225E52);
    AgentShape(view.head, 222, 68, 12, 40, 0x9CD9C1, 6, 0x69AF94);
    auto shell = AgentShape(view.head, 70, 26, 154, 122, 0xE2F7E9, 35, 0x98CEB8);
    AgentOutline(shell, 0xD1EEDF, 3);
    lv_obj_set_style_shadow_color(shell, lv_color_hex(0x051D17), 0);
    lv_obj_set_style_shadow_width(shell, 16, 0);
    lv_obj_set_style_shadow_ofs_y(shell, 6, 0);
    lv_obj_set_style_shadow_opa(shell, LV_OPA_30, 0);
    AgentShape(view.head, 83, 31, 123, 6, 0xF1FCF4, 4);
    auto rim = AgentShape(view.head, 78, 37, 137, 100, 0x8BBCA9, 26, 0x3B7766);
    AgentOutline(rim, 0x8CC8B2, 2);
    auto face = AgentShape(view.head, 85, 44, 123, 85, 0x082D27, 23, 0x06251F);
    AgentOutline(face, 0x2E685A, 2);
    AgentShape(face, 8, 5, 94, 3, 0x164B3E, 2);
    AgentShape(face, 12, 51, 15, 6, 0xDAA6AD, LV_RADIUS_CIRCLE);
    AgentShape(face, 96, 51, 15, 6, 0xDAA6AD, LV_RADIUS_CIRCLE);
    static const lv_point_precise_t eye_curve[] = {{0, 8}, {6, 2}, {12, 8}};
    static const lv_point_precise_t smile_curve[] = {{0, 0}, {6, 5}, {12, 7}, {18, 5}, {24, 0}};
    for (int i = 0; i < 2; ++i) {
        view.eyes[i] = AgentShape(face, 25 + i * 49, 22, 15, 24, 0xBDECDD, 8);
        view.eye_smiles[i] = AgentLine(face, 26 + i * 49, 27, eye_curve, 3, 0xBAEAD8, 3);
        AgentShape(view.eyes[i], 3, 3, 4, 5, 0xE3FFF2, 3);
        AgentVisible(view.eye_smiles[i], false);
    }
    view.smile = AgentLine(face, 49, 58, smile_curve, 5, 0xB8E4D2, 2);
    view.mouth = AgentShape(face, 55, 58, 13, 8, 0x9FE1C7, 6);
    AgentVisible(view.mouth, false);
    view.wave_y = wave_y;
    for (int i = 0; i < 11; ++i)
        view.activity[i] = AgentShape(wave_parent, wave_x + i * 9, wave_y - 2, 5, 4, 0x8CD6B7, 3);
}
inline int VoiceVisualLevel(int raw) {
    // Only a display gain: low PCM RMS is readable without changing the audio.
    raw = std::clamp(raw, 0, 100);
    return raw <= 1 ? 0 : std::min(100, int(std::lround(std::sqrt((raw - 1) / 25.0) * 100)));
}
inline void ResetCompanionMotion(CompanionPet& view) {
    view.level = 0;
    view.next_frame_ms = 0;
}
inline void AnimateCompanionPet(CompanionPet& view, FaceMode mode, int64_t now_ms,
                                int input_level = 0, int output_level = 0) {
    if (!view.pet || lv_obj_has_flag(view.pet, LV_OBJ_FLAG_HIDDEN))
        return;
    if (now_ms < view.next_frame_ms)
        return;
    view.next_frame_ms = now_ms + 50;
    const bool speaking = mode == FaceMode::Speaking;
    const bool listening = mode == FaceMode::Listening;
    const int target = VoiceVisualLevel(speaking ? output_level : listening ? input_level : 0);
    view.level = SmoothLevel(view.level, target);
    const int pet_y = view.base_y + int(std::lround(std::sin(now_ms * 0.0017) * 9));
    if (view.pet_y != pet_y) {
        lv_obj_set_y(view.pet, pet_y);
        view.pet_y = pet_y;
    }
    const int head_y = speaking ? int(std::lround(std::sin(now_ms * 0.004) * 2)) : 0;
    if (view.head_y != head_y) {
        lv_obj_set_y(view.head, head_y);
        view.head_y = head_y;
    }
    const int hand_y = 169 + int(std::lround(std::sin(now_ms * 0.0026)));
    if (view.hand_y != hand_y) {
        lv_obj_set_y(view.hand, hand_y);
        view.hand_y = hand_y;
    }
    const int rotation = -70 + int(std::lround(std::sin(now_ms * 0.0026) * (speaking ? 75 : 25)));
    if (view.arm_rotation != rotation) {
        lv_obj_set_style_transform_rotation(view.hand, rotation, 0);
        view.arm_rotation = rotation;
    }
    const bool blink = (now_ms % 5100) < 120;
    const bool happy = !speaking && !listening && (now_ms % 8700) > 6800;
    const int eye_h = blink ? 2 : 24;
    if (view.eye_h != eye_h) {
        for (auto eye : view.eyes)
            lv_obj_set_height(eye, eye_h);
        view.eye_h = eye_h;
    }
    for (int i = 0; i < 2; ++i) {
        AgentVisible(view.eyes[i], !happy || blink);
        AgentVisible(view.eye_smiles[i], happy && !blink);
    }
    const bool vocal = speaking && view.level > 0;
    AgentVisible(view.smile, !vocal);
    AgentVisible(view.mouth, vocal);
    const int height = 4 + view.level / 7;
    if (view.mouth_h != height) {
        lv_obj_set_height(view.mouth, height);
        view.mouth_h = height;
    }
    constexpr int weights[] = {25, 40, 56, 74, 90, 100, 90, 74, 56, 40, 25};
    for (int i = 0; i < 11; ++i) {
        // Zero input settles to a quiet baseline; thinking never synthesizes voice.
        const int height = 4 + view.level * weights[i] * 44 / 10000;
        if (view.activity_height[i] != height) {
            lv_obj_set_height(view.activity[i], height);
            lv_obj_set_y(view.activity[i], view.wave_y - height / 2);
            view.activity_height[i] = height;
        }
    }
}
// A settings back button lives on the root screen; close every surface together.
inline void HideCompanionSettings(lv_obj_t* page, lv_obj_t* back, lv_obj_t* keyboard) {
    for (auto object : {page, back, keyboard})
        if (object)
            AgentVisible(object, false);
}
}  // namespace persona::ui
