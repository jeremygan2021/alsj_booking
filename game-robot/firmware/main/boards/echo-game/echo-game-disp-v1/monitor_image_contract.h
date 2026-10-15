#pragma once
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace persona {
inline bool KnownPreviewCamera(std::string_view camera) {
    return camera == "room-24" || camera == "room-26" || camera == "room-28" ||
           camera == "hand_left" || camera == "hand_right" || camera == "head" ||
           camera == "panel_location" || camera == "panel_calibration";
}
// Parse the baseline SOF marker before allocating RGB565 pixels.
inline bool ValidMonitorJpeg(const uint8_t* data, size_t size) {
    if (!data || size < 4 || size > 65536 || data[0] != 0xff || data[1] != 0xd8 ||
        data[size - 2] != 0xff || data[size - 1] != 0xd9)
        return false;
    size_t offset = 2;
    while (offset + 4 <= size) {
        if (data[offset++] != 0xff)
            return false;
        while (offset < size && data[offset] == 0xff)
            ++offset;
        if (offset + 3 > size)
            return false;
        const uint8_t marker = data[offset++];
        const size_t length = size_t(data[offset]) * 256 + data[offset + 1];
        if (length < 2 || length > size - offset)
            return false;
        if (marker == 0xc0) {
            if (length < 8 || data[offset + 2] != 8)
                return false;
            const size_t height = size_t(data[offset + 3]) * 256 + data[offset + 4];
            const size_t width = size_t(data[offset + 5]) * 256 + data[offset + 6];
            return width > 0 && width <= 704 && height > 0 && height <= 272;
        }
        if (marker == 0xda || marker == 0xd9)
            return false;
        offset += length;
    }
    return false;
}
}  // namespace persona
