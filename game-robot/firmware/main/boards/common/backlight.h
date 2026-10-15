#pragma once

#include <cstdint>
#include <functional>

#include <driver/gpio.h>
#include <esp_timer.h>
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
#include <mutex>
#endif

class Backlight {
public:
    Backlight();
    ~Backlight();

    void RestoreBrightness();
    void SetBrightness(uint8_t brightness, bool permanent = false);
    inline uint8_t brightness() const {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        std::lock_guard<std::mutex> lock(transition_mutex_);
#endif
        return brightness_;
    }

protected:
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    mutable std::mutex transition_mutex_;
#endif
    void OnTransitionTimer();
    virtual void SetBrightnessImpl(uint8_t brightness) = 0;

    esp_timer_handle_t transition_timer_ = nullptr;
    uint8_t brightness_ = 0;
    uint8_t target_brightness_ = 0;
    uint8_t step_ = 1;
};

class PwmBacklight : public Backlight {
public:
    PwmBacklight(gpio_num_t pin, bool output_invert = false, uint32_t freq_hz = 25000);
    ~PwmBacklight();

    void SetBrightnessImpl(uint8_t brightness) override;
};
