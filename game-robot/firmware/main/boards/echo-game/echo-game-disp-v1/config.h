#pragma once
#include <driver/gpio.h>
#include "persona_endpoint.h"
// DISP v1.1, 50pin RGB panel; confirmed by bring-up 0.2.0.
#define DISP_WIDTH 800
#define DISP_HEIGHT 480
#define DISP_BACKLIGHT GPIO_NUM_46
#define DISP_SDA GPIO_NUM_47
#define DISP_SCL GPIO_NUM_48
#define DISP_MCLK GPIO_NUM_42
#define DISP_BCLK GPIO_NUM_41
#define DISP_WS GPIO_NUM_39
#define DISP_DOUT GPIO_NUM_38
#define DISP_DIN GPIO_NUM_40

#define PERSONA_WS_URL persona::kServerEndpoint

// Optional local defaults. This file must never be committed.
#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#endif
#ifndef PERSONA_DEFAULT_SSID
#define PERSONA_DEFAULT_SSID ""
#endif
#ifndef PERSONA_DEFAULT_PASSWORD
#define PERSONA_DEFAULT_PASSWORD ""
#endif
