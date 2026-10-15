#include "persona_display.h"

#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_timer.h>
#include <mbedtls/base64.h>
#include <cmath>
#include <cstring>
#include <ctime>
#include "application.h"
#include "display/lvgl_display/lvgl_image.h"
#include "esp_jpeg_dec.h"
#include "monitor_image_contract.h"
#include "monitor_preview_ui.h"
#include "persona_ui_feedback.h"

LV_FONT_DECLARE(font_xle_preview_20);
LV_FONT_DECLARE(font_xle_preview_14);

struct PersonaDisplay::MonitorTransfer {
    std::string request, session, title;
    double captured = 0;
    size_t capacity = 0, size = 0;
    unsigned index = 0;
    uint32_t generation = 0, turn = 0;
    int64_t deadline = 0;
    uint8_t* data = nullptr;
    ~MonitorTransfer() { heap_caps_free(data); }
};

namespace {
bool String(const cJSON* root, const char* key, std::string& out, size_t maximum) {
    auto value = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(value) || !value->valuestring || !*value->valuestring ||
        strlen(value->valuestring) > maximum)
        return false;
    out = value->valuestring;
    return true;
}

std::shared_ptr<LvglImage> DecodeMonitor(const uint8_t* jpeg, size_t length) {
    // Reject oversized dimensions before any decoder allocation.
    if (!persona::ValidMonitorJpeg(jpeg, length))
        return {};
    jpeg_dec_config_t config = DEFAULT_JPEG_DEC_CONFIG();
    config.output_type = JPEG_PIXEL_FORMAT_RGB565_LE;
    jpeg_dec_handle_t decoder = nullptr;
    if (jpeg_dec_open(&config, &decoder) != JPEG_ERR_OK)
        return {};
    jpeg_dec_io_t io = {};
    io.inbuf = const_cast<uint8_t*>(jpeg);
    io.inbuf_len = length;
    jpeg_dec_header_info_t header = {};
    std::shared_ptr<LvglImage> image;
    if (jpeg_dec_parse_header(decoder, &io, &header) == JPEG_ERR_OK && header.width > 0 &&
        header.width <= 704 && header.height > 0 && header.height <= 272) {
        const size_t bytes = size_t(header.width) * header.height * 2;
        auto pixels = static_cast<uint8_t*>(
            heap_caps_aligned_alloc(16, bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (pixels) {
            io.outbuf = pixels;
            if (jpeg_dec_process(decoder, &io) == JPEG_ERR_OK)
                image =
                    std::make_shared<LvglAllocatedImage>(pixels, bytes, header.width, header.height,
                                                         header.width * 2, LV_COLOR_FORMAT_RGB565);
            else
                heap_caps_free(pixels);
        }
    }
    jpeg_dec_close(decoder);
    return image;
}
}  // namespace

bool PersonaDisplay::HandleMonitorMessage(const cJSON* root, const std::string& session) {
    std::string type, incoming, request;
    if (!String(root, "type", type, 40) || type.rfind("ui.image.", 0) != 0)
        return false;
    if (!String(root, "session_id", incoming, 128) || incoming != session || session.empty() ||
        !String(root, "request_id", request, 64))
        return true;
    std::shared_ptr<MonitorTransfer> complete;
    {
        std::lock_guard<std::mutex> guard(monitor_mutex_);
        if (type == "ui.image.begin") {
            std::string title, camera;
            auto count = cJSON_GetObjectItemCaseSensitive(root, "total_bytes");
            auto stamp = cJSON_GetObjectItemCaseSensitive(root, "captured_unix");
            if (monitor_decoding_.load() || !String(root, "title", title, 96) ||
                !String(root, "camera_id", camera, 32) || !persona::KnownPreviewCamera(camera) ||
                !cJSON_IsNumber(count) || count->valuedouble != count->valueint ||
                count->valueint <= 0 || count->valueint > 65536 || !cJSON_IsNumber(stamp) ||
                !std::isfinite(stamp->valuedouble) || stamp->valuedouble <= 0)
                return true;
            auto transfer = std::make_shared<MonitorTransfer>();
            transfer->capacity = count->valueint;
            transfer->data = static_cast<uint8_t*>(
                heap_caps_malloc(transfer->capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
            if (!transfer->data)
                return true;
            transfer->request = request;
            transfer->session = incoming;
            transfer->title = title;
            transfer->captured = stamp->valuedouble;
            transfer->generation = monitor_generation_.fetch_add(1) + 1;
            transfer->turn = Application::GetInstance().GetPersonaEventGeneration();
            transfer->deadline = esp_timer_get_time() + 10000000;
            monitor_transfer_ = transfer;
            return true;
        }
        auto transfer = monitor_transfer_;
        if (!transfer || transfer->request != request || transfer->session != incoming)
            return true;
        if (esp_timer_get_time() > transfer->deadline) {
            monitor_transfer_.reset();
            return true;
        }
        if (type == "ui.image.chunk") {
            std::string data;
            auto index = cJSON_GetObjectItemCaseSensitive(root, "index");
            if (!cJSON_IsNumber(index) || index->valuedouble != index->valueint ||
                index->valueint < 0 || unsigned(index->valueint) != transfer->index ||
                !String(root, "data", data, 4096)) {
                monitor_transfer_.reset();
                return true;
            }
            size_t written = 0;
            if (mbedtls_base64_decode(
                    transfer->data + transfer->size, transfer->capacity - transfer->size, &written,
                    reinterpret_cast<const uint8_t*>(data.data()), data.size()) != 0 ||
                written == 0) {
                monitor_transfer_.reset();
                return true;
            }
            transfer->size += written;
            transfer->index++;
            return true;
        }
        if (type != "ui.image.end")
            return true;
        monitor_transfer_.reset();
        if (transfer->size != transfer->capacity)
            return true;
        complete = transfer;
        monitor_decoding_.store(true);
    }
    struct Job {
        PersonaDisplay* display;
        std::shared_ptr<MonitorTransfer> transfer;
    };
    auto job = new Job{this, complete};
    if (xTaskCreatePinnedToCore(
            [](void* opaque) {
                {
                    std::unique_ptr<Job> job(static_cast<Job*>(opaque));
                    auto self = job->display;
                    auto transfer = job->transfer;
                    const int64_t start = esp_timer_get_time();
                    auto image = DecodeMonitor(transfer->data, transfer->size);
                    ESP_LOGI("PersonaImage", "decode ok=%d bytes=%u us=%lld", bool(image),
                             unsigned(transfer->size),
                             static_cast<long long>(esp_timer_get_time() - start));
                    Application::GetInstance().Schedule([self, transfer, image] {
                        DisplayLockGuard lock(self);
                        self->monitor_decoding_.store(false);
                        if (self->monitor_generation_.load() != transfer->generation ||
                            !Application::GetInstance().IsPersonaMessageCurrent(transfer->session,
                                                                                transfer->turn))
                            return;
                        if (image)
                            self->ShowMonitor(image, transfer->title, transfer->captured);
                        self->MonitorResult(transfer->session, transfer->request, bool(image));
                    });
                    job.reset();
                }  // Release worker references before FreeRTOS deletes its stack.
                vTaskDelete(nullptr);
            },
            "monitor_jpeg", 6144, job, 1, nullptr, 1) != pdPASS) {
        delete job;
        monitor_decoding_.store(false);
    }
    return true;
}

void PersonaDisplay::MonitorResult(const std::string& session, const std::string& request,
                                   bool ok) {
    auto event = cJSON_CreateObject();
    cJSON_AddStringToObject(event, "type", "ui.image.result");
    cJSON_AddStringToObject(event, "session_id", session.c_str());
    cJSON_AddStringToObject(event, "request_id", request.c_str());
    cJSON_AddBoolToObject(event, "ok", ok);
    Application::GetInstance().SendDeviceEvent(event);
    cJSON_Delete(event);
}

void PersonaDisplay::ShowMonitor(std::shared_ptr<LvglImage> image, const std::string& title,
                                 double captured) {
    if (!monitor_panel_) {
        auto card = persona::ui::CreateMonitorPreview(lv_display_get_screen_active(display_),
                                                      &font_xle_preview_20, &font_xle_preview_14,
                                                      Click, this);
        monitor_panel_ = card.panel;
        monitor_image_ = card.image;
        monitor_title_ = card.title;
        monitor_time_ = card.time;
    }
    // Replace the source while holding the LVGL lock, then release the old pixels.
    auto previous = monitor_pixels_;
    monitor_pixels_ = image;
    lv_image_set_src(monitor_image_, image->image_dsc());
    lv_obj_align(monitor_image_, LV_ALIGN_TOP_MID, 0, 52);
    lv_label_set_text(monitor_title_, title.c_str());
    const time_t stamp = static_cast<time_t>(captured) + 8 * 3600;
    struct tm value = {};
    gmtime_r(&stamp, &value);
    char caption[64];
    snprintf(caption, sizeof(caption), "抓拍 · %02d:%02d:%02d", value.tm_hour, value.tm_min,
             value.tm_sec);
    lv_label_set_text(monitor_time_, caption);
    persona::ui::OpenCompanionHomeMonitor(home_, monitor_panel_);
    if (settings_ && !lv_obj_has_flag(settings_, LV_OBJ_FLAG_HIDDEN))
        lv_obj_move_foreground(settings_);
    ESP_LOGI("PersonaImage", "displayed title=%s width=%u height=%u", title.c_str(),
             unsigned(image->image_dsc()->header.w), unsigned(image->image_dsc()->header.h));
}

void PersonaDisplay::CloseMonitor() {
    monitor_generation_.fetch_add(1);
    {
        std::lock_guard<std::mutex> guard(monitor_mutex_);
        monitor_transfer_.reset();
    }
    if (monitor_panel_) {
        persona::ui::DismissCompanionHomeMonitor(home_, monitor_panel_);
        lv_image_set_src(monitor_image_, nullptr);
        face_frame_valid_ = false;
        caption_dirty_ = true;
    }
    monitor_pixels_.reset();
}
