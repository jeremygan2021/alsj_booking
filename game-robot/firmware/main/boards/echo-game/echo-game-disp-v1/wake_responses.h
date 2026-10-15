#pragma once

#include <array>
#include "audio/wake_response.h"

extern const char wake_here_start[] asm("_binary_wake_here_ogg_start");
extern const char wake_here_end[] asm("_binary_wake_here_ogg_end");
extern const char wake_present_start[] asm("_binary_wake_present_ogg_start");
extern const char wake_present_end[] asm("_binary_wake_present_ogg_end");
extern const char wake_say_start[] asm("_binary_wake_say_ogg_start");
extern const char wake_say_end[] asm("_binary_wake_say_ogg_end");
extern const char wake_listening_start[] asm("_binary_wake_listening_ogg_start");
extern const char wake_listening_end[] asm("_binary_wake_listening_ogg_end");

inline std::array<WakeResponseClip, 4> EchoWakeResponses() {
    return {
        {{"在的，你说吧。", {wake_here_start, size_t(wake_here_end - wake_here_start)}},
         {"我在，你说吧。", {wake_present_start, size_t(wake_present_end - wake_present_start)}},
         {"你说，我听着呢。", {wake_say_start, size_t(wake_say_end - wake_say_start)}},
         {"嗯，我在听。",
          {wake_listening_start, size_t(wake_listening_end - wake_listening_start)}}}};
}
