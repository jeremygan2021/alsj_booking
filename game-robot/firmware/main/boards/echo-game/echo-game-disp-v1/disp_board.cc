#include <driver/i2c_master.h>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>
#include <esp_lcd_touch_gt911.h>
#include <esp_log.h>
#include <esp_lvgl_port.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <ssid_manager.h>
#include <algorithm>
#include <cmath>
#include "application.h"
#include "codecs/es8311_audio_codec.h"
#include "config.h"
#include "persona_display.h"
#include "playback_progress.h"
#include "settings.h"
#include "wake_responses.h"
#include "wifi_board.h"

#if __has_include("game_secrets.h")
#include "game_secrets.h"
#endif
#ifndef ECHO_DEFAULT_DEVICE_TOKEN
#define ECHO_DEFAULT_DEVICE_TOKEN ""
#endif

std::atomic<int> persona_input_level{0};
std::atomic<int> persona_output_level{0};
std::atomic<int> persona_input_rms{0};

class PersonaCodec : public Es8311AudioCodec {
    static int Level(const std::vector<int16_t>& data) {
        if (data.empty())
            return 0;
        double power = 0;
        for (int16_t value : data)
            power += double(value) * value;
        return std::min(100, int(std::sqrt(power / data.size()) * 100 / 6000));
    }

public:
    explicit PersonaCodec(i2c_master_bus_handle_t bus)
        // Duplex ES8311 uses one shared clock; AudioService resamples uplink to 16k.
        : Es8311AudioCodec(bus, I2C_NUM_0, 24000, 24000, DISP_MCLK, DISP_BCLK, DISP_WS, DISP_DOUT,
                           DISP_DIN, GPIO_NUM_NC, ES8311_CODEC_DEFAULT_ADDR) {}
    void Start() override {
        Settings audio("audio");
        int volume = audio.GetInt("output_volume", 35);
        Es8311AudioCodec::Start();
        SetOutputVolume(std::clamp(volume, 0, 100));
    }
    bool InputData(std::vector<int16_t>& data) override {
        bool ok = Es8311AudioCodec::InputData(data);
        double power = 0;
        int peak = 0, clipped = 0;
        for (int16_t sample : data) {
            power += double(sample) * sample;
            peak = std::max(peak, std::abs(int(sample)));
            if (std::abs(int(sample)) >= 32700)
                ++clipped;
        }
        int rms = data.empty() ? 0 : int(std::sqrt(power / data.size()));
        persona_input_rms.store(ok ? rms : 0, std::memory_order_relaxed);
        persona_input_level.store(ok ? std::min(100, rms * 100 / 6000) : 0,
                                  std::memory_order_relaxed);
        static int64_t last_log = 0;
        auto now = esp_timer_get_time();
        if (now - last_log >= 5000000) {
            last_log = now;
            ESP_LOGI("PersonaAudio", "MIC rms=%d peak=%d clipped=%d/%u", rms, peak, clipped,
                     unsigned(data.size()));
        }
        return ok;
    }
    void OutputData(std::vector<int16_t>& data) override {
        persona_output_level.store(Level(data), std::memory_order_relaxed);
        Es8311AudioCodec::OutputData(data);
    }
    bool OutputDataChecked(std::vector<int16_t>& data) override {
        persona_output_level.store(Level(data), std::memory_order_relaxed);
        return Es8311AudioCodec::OutputDataChecked(data);
    }
    bool SupportsPlaybackTailFence() const override { return true; }
    bool DrainPlaybackTail() override {
        // i2s_channel_write returns after copying to DMA, not after the tail
        // leaves the pin. Advancing more than a complete ring with silence
        // makes the previous task's PCM leave DMA before we acknowledge it.
        std::vector<int16_t> silence(
            PlaybackTailFenceSamples(output_sample_rate(), AUDIO_CODEC_DMA_DESC_NUM,
                                     AUDIO_CODEC_DMA_FRAME_NUM),
            0);
        return OutputDataChecked(silence);
    }
};

class XLerobotDisp : public WifiBoard {
    i2c_master_bus_handle_t bus_ = nullptr;
    PersonaDisplay* display_ = nullptr;
    PwmBacklight* backlight_ = nullptr;
    size_t last_wake_response_ = 4;

public:
    WakeResponseClip GetWakeResponse() override {
        const auto clips = EchoWakeResponses();
        last_wake_response_ = ChooseWakeResponse(esp_random(), last_wake_response_, clips.size());
        return clips[last_wake_response_];
    }
    XLerobotDisp() {
        {
            Settings endpoint("websocket", true);
            const auto saved = endpoint.GetString("url");
            const int revision = endpoint.GetInt("host_rev", 0);
            if (persona::NeedsServerEndpointUpdate(saved, revision)) {
                endpoint.SetString("url", PERSONA_WS_URL);
                ESP_LOGI("Persona", "Server endpoint updated to deployment revision %d",
                         persona::kServerEndpointRevision);
            }
            if (revision < persona::kServerEndpointRevision)
                endpoint.SetInt("host_rev", persona::kServerEndpointRevision);
            endpoint.SetInt("version", 1);
            // Per-deployment device credential only; cloud model keys never
            // belong in firmware. Existing game settings remain authoritative.
            if (endpoint.GetString("token").empty() &&
                std::string(ECHO_DEFAULT_DEVICE_TOKEN).size() > 0)
                endpoint.SetString("token", ECHO_DEFAULT_DEVICE_TOKEN);
        }
        auto& ssids = SsidManager::GetInstance();
        if (ssids.GetSsidList().empty() && std::string(PERSONA_DEFAULT_SSID).size() > 0)
            ssids.AddSsid(PERSONA_DEFAULT_SSID, PERSONA_DEFAULT_PASSWORD);
        i2c_master_bus_config_t bus = {};
        bus.i2c_port = I2C_NUM_0;
        bus.sda_io_num = DISP_SDA;
        bus.scl_io_num = DISP_SCL;
        bus.clk_source = I2C_CLK_SRC_DEFAULT;
        bus.glitch_ignore_cnt = 7;
        bus.flags.enable_internal_pullup = true;
        ESP_ERROR_CHECK(i2c_new_master_bus(&bus, &bus_));
        ESP_LOGI("Persona", "ES8311 probe 0x18: %s",
                 esp_err_to_name(i2c_master_probe(bus_, 0x18, 100)));

        esp_lcd_rgb_panel_config_t rgb = {};
        rgb.clk_src = LCD_CLK_SRC_DEFAULT;
        rgb.timings.pclk_hz = 18000000;
        rgb.timings.h_res = DISP_WIDTH;
        rgb.timings.v_res = DISP_HEIGHT;
        rgb.timings.hsync_pulse_width = 40;
        rgb.timings.hsync_back_porch = 40;
        rgb.timings.hsync_front_porch = 48;
        rgb.timings.vsync_pulse_width = 23;
        rgb.timings.vsync_back_porch = 32;
        rgb.timings.vsync_front_porch = 13;
        rgb.timings.flags.pclk_active_neg = true;
        rgb.data_width = 16;
        rgb.in_color_format = LCD_COLOR_FMT_RGB565;
        rgb.out_color_format = LCD_COLOR_FMT_RGB565;
        rgb.num_fbs = 2;
        rgb.bounce_buffer_size_px = DISP_WIDTH * 10;
        rgb.dma_burst_size = 64;
        rgb.hsync_gpio_num = GPIO_NUM_17;
        rgb.vsync_gpio_num = GPIO_NUM_18;
        rgb.de_gpio_num = GPIO_NUM_21;
        rgb.pclk_gpio_num = GPIO_NUM_0;
        rgb.disp_gpio_num = GPIO_NUM_NC;
        const gpio_num_t pins[] = {GPIO_NUM_12, GPIO_NUM_13, GPIO_NUM_14, GPIO_NUM_15,
                                   GPIO_NUM_16, GPIO_NUM_6,  GPIO_NUM_7,  GPIO_NUM_8,
                                   GPIO_NUM_9,  GPIO_NUM_10, GPIO_NUM_11, GPIO_NUM_1,
                                   GPIO_NUM_2,  GPIO_NUM_3,  GPIO_NUM_4,  GPIO_NUM_5};
        std::copy(std::begin(pins), std::end(pins), rgb.data_gpio_nums);
        rgb.flags.fb_in_psram = true;
        esp_lcd_panel_handle_t panel;
        ESP_ERROR_CHECK(esp_lcd_new_rgb_panel(&rgb, &panel));
        ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
        display_ = new PersonaDisplay(panel);
        backlight_ = new PwmBacklight(DISP_BACKLIGHT);
        backlight_->RestoreBrightness();

        esp_lcd_panel_io_i2c_config_t io = ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG();
        io.scl_speed_hz = 100000;
        io.dev_addr = 0x5d;
        esp_lcd_panel_io_handle_t touch_io;
        ESP_ERROR_CHECK(esp_lcd_new_panel_io_i2c(bus_, &io, &touch_io));
        esp_lcd_touch_config_t touch = {};
        touch.x_max = DISP_WIDTH;
        touch.y_max = DISP_HEIGHT;
        touch.rst_gpio_num = GPIO_NUM_NC;
        touch.int_gpio_num = GPIO_NUM_NC;
        esp_lcd_touch_handle_t handle;
        ESP_ERROR_CHECK(esp_lcd_touch_new_i2c_gt911(touch_io, &touch, &handle));
        lvgl_port_touch_cfg_t cfg = {};
        cfg.disp = lv_display_get_default();
        cfg.handle = handle;
        auto indev = lvgl_port_add_touch(&cfg);
        ESP_ERROR_CHECK(indev ? ESP_OK : ESP_FAIL);
        // A transient shared-I2C read failure must not abort the whole terminal.
        lv_indev_set_user_data(indev, handle);
        lv_indev_set_read_cb(indev, [](lv_indev_t* input, lv_indev_data_t* data) {
            static int64_t last_poll = 0, last_touch_log = 0;
            const auto began = esp_timer_get_time();
            const auto poll_gap = last_poll ? began - last_poll : 0;
            last_poll = began;
            auto touch_handle = static_cast<esp_lcd_touch_handle_t>(lv_indev_get_user_data(input));
            data->state = LV_INDEV_STATE_RELEASED;
            if (esp_lcd_touch_read_data(touch_handle) != ESP_OK)
                return;
            esp_lcd_touch_point_data_t point = {};
            uint8_t count = 0;
            if (esp_lcd_touch_get_data(touch_handle, &point, &count, 1) != ESP_OK || count == 0)
                return;
            data->point.x = point.x;
            data->point.y = point.y;
            data->state = LV_INDEV_STATE_PRESSED;
            if (began - last_touch_log >= 250000) {
                last_touch_log = began;
                ESP_LOGI("PersonaTouch", "down x=%d y=%d state=%d poll_gap_us=%lld read_us=%lld",
                         point.x, point.y, int(Application::GetInstance().GetDeviceState()),
                         (long long)poll_gap, (long long)(esp_timer_get_time() - began));
            }
        });
        ESP_LOGI("Persona", "800x480 landscape RGB / GT911 ready");
    }
    AudioCodec* GetAudioCodec() override {
        // Keep Opus and I2S ahead of this board's priority-5 full-screen LVGL task.
        Application::GetInstance().GetAudioService().SetTaskPriorities(7, 6);
        static PersonaCodec codec(bus_);
        return &codec;
    }
    Display* GetDisplay() override { return display_; }
    Backlight* GetBacklight() override { return backlight_; }
};
DECLARE_BOARD(XLerobotDisp);
