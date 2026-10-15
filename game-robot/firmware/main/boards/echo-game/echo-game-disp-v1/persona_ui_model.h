#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <string>

namespace persona::ui {
struct Rect {
    int x, y, width, height;
};
struct Layout {
    Rect face, subtitle, choices, cancel, countdown;
    std::array<Rect, 4> buttons{};
};
// Physical landscape pixels; captions remain outside the choice grid.
inline Layout MakeLayout(bool choices, int count = 0) {
    Layout layout{{24, 94, 282, 306},  {326, 114, 450, 230}, {24, 178, 752, 176},
                  {610, 368, 104, 58}, {612, 432, 164, 34},  {}};
    if (!choices)
        return layout;
    layout.face = {24, 64, 170, 98};
    layout.subtitle = {24, 366, 568, 98};
    count = std::clamp(count, 1, 4);
    for (int i = 0; i < count; ++i) {
        if (count == 1)
            layout.buttons[i] = {0, 0, 752, 176};
        else if (count == 2)
            layout.buttons[i] = {i * 382, 0, 370, 176};
        else if (count == 3 && i == 2)
            layout.buttons[i] = {0, 94, 752, 82};
        else
            layout.buttons[i] = {(i % 2) * 382, (i / 2) * 94, 370, 82};
    }
    return layout;
}
enum class FaceMode { Idle, Listening, Thinking, Speaking, Choice, Error, Connecting };
struct FaceFrame {
    std::array<Rect, 2> eyes{};
    Rect mouth{};
    std::array<Rect, 5> activity{};
    std::array<int, 5> activity_opacity{};
    int eye_radius = 0, eye_opacity = 255, activity_count = 0;
};
inline bool SameRect(const Rect& a, const Rect& b) {
    return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}
inline int FaceIntervalMs(FaceMode mode) {
    switch (mode) {
        case FaceMode::Listening:
        case FaceMode::Speaking:
            return 50;
        case FaceMode::Thinking:
        case FaceMode::Connecting:
            return 100;
        default:
            return 200;
    }
}
// Integer-only line geometry. Wall-clock timing keeps blinking consistent across rates.
inline FaceFrame MakeFace(FaceMode mode, bool compact, int level, uint32_t now_ms) {
    FaceFrame frame;
    level = std::clamp(level, 0, 100);
    const int width = compact ? 170 : 440;
    const int breathe_step = int(now_ms % 4000) / 1000;
    const int breathe = compact ? 0 : (breathe_step == 1 ? -1 : breathe_step == 3 ? 1 : 0);
    const bool blink = mode != FaceMode::Error && (now_ms + 1100) % 5300 < 160;
    const bool thinking = mode == FaceMode::Thinking || mode == FaceMode::Connecting;
    const int look_step = int(now_ms % 3200) / 800;
    const int look = thinking ? (look_step == 0 ? -3 : look_step == 2 ? 3 : 0) : 0;
    int eye_height = 14;
    if (mode == FaceMode::Listening)
        eye_height = 16 + level / 15;
    else if (thinking)
        eye_height = 9;
    else if (mode == FaceMode::Choice)
        eye_height = 12;
    else if (mode == FaceMode::Error)
        eye_height = 6;
    if (compact)
        eye_height = std::max(3, eye_height / 3);
    if (blink)
        eye_height = compact ? 1 : 2;
    const int eye_width = compact ? 24 : 56;
    for (int i = 0; i < 2; ++i) {
        const int center_x = compact ? 59 + i * 52 : 152 + i * 136;
        const int height =
            thinking && !blink && i == 1 ? std::max(2, eye_height - (compact ? 1 : 3)) : eye_height;
        frame.eyes[i] = {center_x - eye_width / 2 + look,
                         (compact ? 35 : 81) + breathe - height / 2, eye_width, height};
    }
    frame.eye_radius = compact ? 2 : 4;
    frame.eye_opacity = mode == FaceMode::Error ? 200 : 255;
    const bool speaking = mode == FaceMode::Speaking;
    const int mouth_width =
        compact ? (speaking ? 12 + level / 12 : 12) : (speaking ? 28 + level / 4 : 26);
    const int mouth_height =
        compact ? (speaking ? 2 + level / 40 : 2) : (speaking ? 3 + level / 14 : 3);
    frame.mouth = {(width - mouth_width) / 2, (compact ? 70 : 150) - mouth_height / 2, mouth_width,
                   mouth_height};
    frame.activity_count = mode == FaceMode::Listening ? 5 : thinking ? 3 : 0;
    const int active_dot = int(now_ms / 200) % 3;
    constexpr int weights[] = {2, 3, 4, 3, 2};
    for (int i = 0; i < 5; ++i) {
        const int bar_width = compact ? 2 : 3;
        const int bar_height = mode == FaceMode::Listening ? (compact ? 2 + level * weights[i] / 100
                                                                      : 3 + level * weights[i] / 20)
                                                           : bar_width;
        const int center_x =
            width / 2 + (i - (frame.activity_count == 3 ? 1 : 2)) * (compact ? 6 : 10);
        frame.activity[i] = {center_x - bar_width / 2, (compact ? 89 : 191) - bar_height / 2,
                             bar_width, bar_height};
        frame.activity_opacity[i] = thinking ? (i == active_dot ? 240 : 80) : 210;
    }
    return frame;
}

// Caption identity and scroll hint stay above the scrolling text viewport.
inline Rect CaptionViewport(const Rect& panel) {
    return panel.width <= 450 ? Rect{14, 42, panel.width - 28, panel.height - 54}
                              : Rect{14, 30, panel.width - 28, panel.height - 40};
}
// Continue following streamed text only while the reader remains near the bottom.
// A role change starts a fresh caption; scrolling up preserves the reader's position.
inline int CaptionScrollTarget(bool role_changed, int previous_y, int previous_bottom_gap,
                               int maximum_y) {
    maximum_y = std::max(0, maximum_y);
    if (role_changed)
        return 0;
    if (previous_bottom_gap <= 12)
        return maximum_y;
    return std::clamp(previous_y, 0, maximum_y);
}
inline int RemainingSeconds(int64_t deadline_us, int64_t now_us) {
    if (deadline_us <= now_us)
        return 0;
    const int64_t remaining = deadline_us - now_us;
    return int(std::min<int64_t>(60, remaining / 1000000 + (remaining % 1000000 != 0)));
}
inline int SmoothLevel(int previous, int target) {
    previous = std::clamp(previous, 0, 100);
    target = std::clamp(target, 0, 100);
    return target > previous ? (previous + target * 2 + 2) / 3 : (previous * 3 + target) / 4;
}
// Bound network text memory without cutting a UTF-8 codepoint.
inline std::string BoundedText(const char* text, size_t max_bytes = 2048) {
    if (!text)
        return {};
    size_t length = 0;
    while (length < max_bytes && text[length])
        ++length;
    if (!text[length])
        return std::string(text, length);
    while (length > 0 && (static_cast<unsigned char>(text[length]) & 0xC0) == 0x80)
        --length;
    return std::string(text, length) + "…";
}
}  // namespace persona::ui
