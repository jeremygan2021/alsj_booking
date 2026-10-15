#include "application.h"
#include "assets.h"
#include "assets/lang_config.h"
#include "audio_codec.h"
#include "board.h"
#include "cjson_utils.h"
#include "display.h"
#include "mcp_server.h"
#include "mqtt_protocol.h"
#include "settings.h"
#include "system_info.h"
#include "text_glyph_payload.h"
#include "websocket_protocol.h"

#include <driver/gpio.h>
#include <esp_log.h>
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
#include <esp_netif_sntp.h>
#endif
#include <arpa/inet.h>
#include <cJSON.h>
#include <cstring>
#include <limits>

#define TAG "Application"

Application::Application() : notify_player_(audio_service_) {
    event_group_ = xEventGroupCreate();

#if CONFIG_USE_DEVICE_AEC && CONFIG_USE_SERVER_AEC
#error "CONFIG_USE_DEVICE_AEC and CONFIG_USE_SERVER_AEC cannot be enabled at the same time"
#elif CONFIG_USE_DEVICE_AEC
    aec_mode_ = kAecOnDeviceSide;
#elif CONFIG_USE_SERVER_AEC
    aec_mode_ = kAecOnServerSide;
#else
    aec_mode_ = kAecOff;
#endif

    esp_timer_create_args_t clock_timer_args = {.callback =
                                                    [](void* arg) {
                                                        Application* app = (Application*)arg;
                                                        xEventGroupSetBits(app->event_group_,
                                                                           MAIN_EVENT_CLOCK_TICK);
                                                    },
                                                .arg = this,
                                                .dispatch_method = ESP_TIMER_TASK,
                                                .name = "clock_timer",
                                                .skip_unhandled_events = true};
    esp_timer_create(&clock_timer_args, &clock_timer_handle_);
}

Application::~Application() {
    notify_player_.Stop();
    if (clock_timer_handle_ != nullptr) {
        esp_timer_stop(clock_timer_handle_);
        esp_timer_delete(clock_timer_handle_);
    }
    vEventGroupDelete(event_group_);
}

bool Application::SetDeviceState(DeviceState state) { return state_machine_.TransitionTo(state); }

void Application::Initialize() {
    auto& board = Board::GetInstance();
    SetDeviceState(kDeviceStateStarting);

    // Setup the display
    auto display = board.GetDisplay();
    display->SetupUI();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    // Load the common CJK font locally so provisioning UI works without Wi-Fi.
    Assets::GetInstance().Apply();
#endif
    // Print board name/version info
    display->SetChatMessage("system", SystemInfo::GetUserAgent().c_str());

    // Setup the audio service
    auto codec = board.GetAudioCodec();
    audio_service_.Initialize(codec);
    audio_service_.Start();
    ESP_LOGI(TAG, "After board/audio init");
    SystemInfo::PrintHeapStats();

    AudioServiceCallbacks callbacks;
    callbacks.on_send_queue_available = [this]() {
        xEventGroupSetBits(event_group_, MAIN_EVENT_SEND_AUDIO);
    };
    callbacks.on_wake_word_detected = [this](const std::string& wake_word) {
        xEventGroupSetBits(event_group_, MAIN_EVENT_WAKE_WORD_DETECTED);
    };
    callbacks.on_vad_change = [this](bool speaking) {
        xEventGroupSetBits(event_group_, MAIN_EVENT_VAD_CHANGE);
    };
    callbacks.on_playback_drained = [this]() {
        xEventGroupSetBits(event_group_, MAIN_EVENT_PLAYBACK_DRAINED);
    };
    callbacks.on_playback_progress = [this](uint32_t playback_id, uint32_t media_position_ms) {
        notify_player_.OnPlaybackProgress(playback_id, media_position_ms);
    };
    callbacks.on_playback_task_progress = [this]() {
        xEventGroupSetBits(event_group_, MAIN_EVENT_TASK_PLAYBACK);
    };
    audio_service_.SetCallbacks(callbacks);

    // Add state change listeners
    state_machine_.AddStateChangeListener([this](DeviceState old_state, DeviceState new_state) {
        xEventGroupSetBits(event_group_, MAIN_EVENT_STATE_CHANGED);
    });

    // Start the clock timer to update the status bar
    esp_timer_start_periodic(clock_timer_handle_, 1000000);

    // Add MCP common tools (only once during initialization)
    auto& mcp_server = McpServer::GetInstance();
    mcp_server.AddCommonTools();
    mcp_server.AddUserOnlyTools();

    // Set network event callback for UI updates and network state handling
    board.SetNetworkEventCallback([this](NetworkEvent event, const std::string& data) {
        auto display = Board::GetInstance().GetDisplay();

        switch (event) {
            case NetworkEvent::Scanning:
                display->ShowNotification(Lang::Strings::SCANNING_WIFI, 30000);
                xEventGroupSetBits(event_group_, MAIN_EVENT_NETWORK_DISCONNECTED);
                break;
            case NetworkEvent::Connecting: {
                if (data.empty()) {
                    // Cellular network - registering without carrier info yet
                    display->SetStatus(Lang::Strings::REGISTERING_NETWORK);
                } else {
                    // WiFi or cellular with carrier info
                    std::string msg = Lang::Strings::CONNECT_TO;
                    msg += data;
                    msg += "...";
                    display->ShowNotification(msg.c_str(), 30000);
                }
                break;
            }
            case NetworkEvent::Connected: {
                std::string msg = Lang::Strings::CONNECTED_TO;
                msg += data;
                display->ShowNotification(msg.c_str(), 30000);
                xEventGroupSetBits(event_group_, MAIN_EVENT_NETWORK_CONNECTED);
                break;
            }
            case NetworkEvent::Disconnected:
                xEventGroupSetBits(event_group_, MAIN_EVENT_NETWORK_DISCONNECTED);
                break;
            case NetworkEvent::WifiConfigModeEnter:
                // WiFi config mode enter is handled by WifiBoard internally
                break;
            case NetworkEvent::WifiConfigModeExit:
                // WiFi config mode exit is handled by WifiBoard internally
                break;
            // Cellular modem specific events
            case NetworkEvent::ModemDetecting:
                display->SetStatus(Lang::Strings::DETECTING_MODULE);
                break;
            case NetworkEvent::ModemErrorNoSim:
                Alert(Lang::Strings::ERROR, Lang::Strings::PIN_ERROR, "warning",
                      Lang::Sounds::OGG_ERR_PIN);
                break;
            case NetworkEvent::ModemErrorRegDenied:
                Alert(Lang::Strings::ERROR, Lang::Strings::REG_ERROR, "warning",
                      Lang::Sounds::OGG_ERR_REG);
                break;
            case NetworkEvent::ModemErrorInitFailed:
                Alert(Lang::Strings::ERROR, Lang::Strings::MODEM_INIT_ERROR, "warning",
                      Lang::Sounds::OGG_EXCLAMATION);
                break;
            case NetworkEvent::ModemErrorTimeout:
                display->SetStatus(Lang::Strings::REGISTERING_NETWORK);
                break;
        }
    });

    // Start network asynchronously
    board.StartNetwork();

    // Update the status bar immediately to show the network state
    display->UpdateStatusBar(true);
}

void Application::Run() {
    // Set the priority of the main task to 10
    vTaskPrioritySet(nullptr, 10);

    const EventBits_t ALL_EVENTS =
        MAIN_EVENT_SCHEDULE | MAIN_EVENT_SEND_AUDIO | MAIN_EVENT_WAKE_WORD_DETECTED |
        MAIN_EVENT_VAD_CHANGE | MAIN_EVENT_CLOCK_TICK | MAIN_EVENT_ERROR |
        MAIN_EVENT_NETWORK_CONNECTED | MAIN_EVENT_NETWORK_DISCONNECTED | MAIN_EVENT_TOGGLE_CHAT |
        MAIN_EVENT_START_LISTENING | MAIN_EVENT_STOP_LISTENING | MAIN_EVENT_ACTIVATION_DONE |
        MAIN_EVENT_STATE_CHANGED | MAIN_EVENT_PLAYBACK_DRAINED | MAIN_EVENT_PERSONA_OPENED |
        MAIN_EVENT_END_CONVERSATION | MAIN_EVENT_TASK_PLAYBACK | MAIN_EVENT_AGENT_RELEASE;

    while (true) {
        auto bits = xEventGroupWaitBits(event_group_, ALL_EVENTS, pdTRUE, pdFALSE, portMAX_DELAY);

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        // Release must precede playback/capture terminal ACKs and queued task
        // callbacks: any of those can retire the server mission's owner.
        if ((bits & MAIN_EVENT_AGENT_RELEASE) && persona_agent_release_pending_.load()) {
            EndAgentControl("user_release", true, true);
            bits &= ~(MAIN_EVENT_TOGGLE_CHAT | MAIN_EVENT_START_LISTENING |
                      MAIN_EVENT_WAKE_WORD_DETECTED | MAIN_EVENT_PLAYBACK_DRAINED);
        }
        if (bits & MAIN_EVENT_END_CONVERSATION) {
            HandleEndConversationEvent();
            bits &= ~(MAIN_EVENT_TOGGLE_CHAT | MAIN_EVENT_START_LISTENING |
                      MAIN_EVENT_WAKE_WORD_DETECTED | MAIN_EVENT_PLAYBACK_DRAINED);
        }
#endif

        if (bits & MAIN_EVENT_ERROR) {
            CancelWakeResponse();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            EndAgentControl("network_error", false);
            CancelCaptureTask("network_error");
            CancelPlaybackTask("network_error");
            if (!persona_open_running_ && !persona_user_stopped_.load()) {
                ++persona_mcp_generation_;
                persona_turn_.Abort();
                pending_listening_start_ = false;
#endif
                if (GetDeviceState() == kDeviceStateNotifying) {
                    StopNotification();
                }
                SetDeviceState(kDeviceStateIdle);
                Alert(Lang::Strings::ERROR, last_error_message_.c_str(), "cancel",
                      Lang::Sounds::OGG_EXCLAMATION);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            }
#endif
        }

        if (bits & MAIN_EVENT_NETWORK_CONNECTED) {
            HandleNetworkConnectedEvent();
        }

        if (bits & MAIN_EVENT_NETWORK_DISCONNECTED) {
            HandleNetworkDisconnectedEvent();
        }

        if (bits & MAIN_EVENT_ACTIVATION_DONE) {
            HandleActivationDoneEvent();
        }

        if (bits & MAIN_EVENT_STATE_CHANGED) {
            HandleStateChangedEvent();
        }

        if (bits & MAIN_EVENT_PLAYBACK_DRAINED) {
            AdvanceWakeResponse();
            if (audio_service_.IsPlaybackIdle()) {
                notify_player_.OnPlaybackDrained();
            }
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            AdvancePlaybackTask();
            CompletePersonaPlayback();
#endif
            // Deferred listening start (auto mode): the playback queue has
            // drained, so it is now safe to enable voice processing.
            if (pending_listening_start_ && GetDeviceState() == kDeviceStateListening &&
                audio_service_.IsPlaybackIdle()) {
                pending_listening_start_ = false;
                StartListeningAudio();
            }
        }

        if (bits & MAIN_EVENT_TASK_PLAYBACK) {
            AdvanceWakeResponse();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            AdvancePlaybackTask();
#endif
        }

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        if (bits & MAIN_EVENT_PERSONA_OPENED) {
            persona_open_running_ = false;
            FlushPendingRobotStop();
            if (persona_reset_pending_) {
                persona_reset_pending_ = false;
                persona_pending_wake_.clear();
                ResetProtocol();
            } else if (protocol_ && protocol_->control_only()) {
                // Keep a silent management channel after a deliberate robot
                // stop. A later explicit conversation start opens a new session.
                persona_pending_wake_.clear();
                persona_turn_.EndSession();
                persona_retry_at_ = 0;
                if (!persona_open_success_.load() || !persona_network_ready_)
                    protocol_->CloseAudioChannel();
                SetDeviceState(kDeviceStateIdle);
            } else if (persona_user_stopped_.load()) {
                persona_pending_wake_.clear();
                if (protocol_)
                    protocol_->CloseAudioChannel();
                persona_turn_.EndSession();
                persona_retry_at_ = 0;
                SetDeviceState(kDeviceStateIdle);
            } else if (!persona_network_ready_) {
                persona_pending_wake_.clear();
                if (protocol_)
                    protocol_->CloseAudioChannel();
                if (GetDeviceState() == kDeviceStateConnecting)
                    SetDeviceState(kDeviceStateIdle);
            } else if (persona_open_success_.load() && GetDeviceState() == kDeviceStateConnecting) {
                persona_retry_at_ = 0;
                persona_retry_delay_ = 5;
                DismissAlert();
                if (!persona_pending_wake_.empty()) {
                    auto wake = std::move(persona_pending_wake_);
                    persona_pending_wake_.clear();
                    ContinueWakeWordInvoke(wake);
                } else if (persona_reconnect_only_)
                    SetDeviceState(kDeviceStateIdle);
                else
                    SetListeningMode(listening_mode_);
            } else {
                persona_pending_wake_.clear();
                SetDeviceState(kDeviceStateIdle);
                persona_retry_at_ = clock_ticks_ + persona_retry_delay_;
                persona_retry_delay_ = std::min(30, persona_retry_delay_ * 2);
                if (!last_error_message_.empty())
                    Alert(Lang::Strings::ERROR, last_error_message_.c_str(), "cancel");
            }
        }
#endif
        if (bits & MAIN_EVENT_TOGGLE_CHAT) {
            HandleToggleChatEvent();
        }

        if (bits & MAIN_EVENT_START_LISTENING) {
            HandleStartListeningEvent();
        }

        if (bits & MAIN_EVENT_STOP_LISTENING) {
            HandleStopListeningEvent();
        }

        if (bits & MAIN_EVENT_SEND_AUDIO) {
            while (auto packet = audio_service_.PopPacketFromSendQueue()) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
                if (persona_agent_release_pending_.load())
                    continue;
                if (persona_capture_engaged_.load()) {
                    persona_capture_.CheckTimeout(esp_timer_get_time() / 1000);
                    if (!protocol_ || !audio_service_.IsAudioProcessorRunning())
                        persona_capture_.Fail("input_unavailable");
                    if (!persona_capture_.AcceptsFrame(packet->input_generation,
                                                       esp_timer_get_time() / 1000) ||
                        !protocol_ || !audio_service_.IsAudioProcessorRunning()) {
                        AdvanceCaptureTask();
                        continue;
                    }
                    if (!protocol_->SendAudio(std::move(packet))) {
                        persona_capture_.Fail("send_failed");
                        AdvanceCaptureTask();
                        break;
                    }
                    persona_capture_.FrameSent();
                    continue;
                }
                if (persona_user_stopped_.load() || GetDeviceState() != kDeviceStateListening ||
                    Board::GetInstance().GetDisplay()->IsAwaitingInput() ||
                    !audio_service_.IsAudioProcessorRunning())
                    continue;
#endif
                if (protocol_ && !protocol_->SendAudio(std::move(packet))) {
                    // Drop the remaining packets. Leaving them in the queue would
                    // stall the Opus codec task (it waits for queue space), which in
                    // turn deadlocks the whole audio input pipeline, as no new
                    // MAIN_EVENT_SEND_AUDIO event would ever be triggered again.
                    while (audio_service_.PopPacketFromSendQueue())
                        ;
                    break;
                }
            }
        }

        if (bits & MAIN_EVENT_WAKE_WORD_DETECTED) {
            HandleWakeWordDetectedEvent();
        }

        if (bits & MAIN_EVENT_VAD_CHANGE) {
            if (GetDeviceState() == kDeviceStateListening) {
                auto led = Board::GetInstance().GetLed();
                led->OnStateChanged();
            }
        }

        if (bits & MAIN_EVENT_SCHEDULE) {
            std::unique_lock<std::mutex> lock(mutex_);
            auto tasks = std::move(main_tasks_);
            lock.unlock();
            for (auto& task : tasks) {
                task();
            }
        }

        if (bits & MAIN_EVENT_CLOCK_TICK) {
            clock_ticks_++;
            AdvanceWakeResponse();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            AdvanceCaptureTask();
            AdvancePlaybackTask();
            // Offline boot must not depend on a cloud activation to validate OTA.
            if (clock_ticks_ == 30) {
                Ota health;
                health.MarkCurrentVersionValid();
            }
            // WebSocket control pings do not update Protocol's application-message
            // timeout. A small JSON ping keeps both the 120 s device timeout and
            // the server's idle timeout honest while awaiting another turn.
            if (clock_ticks_ % 30 == 0 && persona_network_ready_ && !persona_open_running_ &&
                protocol_ && protocol_->IsAudioChannelOpened()) {
                cJSON* event = cJSON_CreateObject();
                cJSON_AddStringToObject(event, "type", "ping");
                protocol_->SendDeviceEvent(event);
                cJSON_Delete(event);
            }
            if (!persona_user_stopped_.load() && persona_retry_at_ &&
                clock_ticks_ >= persona_retry_at_ && persona_network_ready_ &&
                !persona_open_running_ && protocol_ && GetDeviceState() == kDeviceStateIdle) {
                persona_retry_at_ = 0;
                persona_reconnect_only_ = true;
                SetDeviceState(kDeviceStateConnecting);
                ContinueOpenAudioChannel(kListeningModeAutoStop);
            }
#endif
            auto display = Board::GetInstance().GetDisplay();
            display->UpdateStatusBar();

            // Print debug info every 10 seconds
            if (clock_ticks_ % 10 == 0) {
                SystemInfo::PrintHeapStats();
                // SystemInfo::PrintTaskList();
                // SystemInfo::PrintTaskCpuUsage(pdMS_TO_TICKS(1000));
            }
        }
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        // Also reconcile same-state exits (Idle -> Idle) after stop, release,
        // output drain or a late socket callback. No state event is emitted there.
        RefreshStandbyWake();
#endif
    }
}

void Application::HandleNetworkConnectedEvent() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    // WSS certificate validation needs real time; no public Xiaozhi OTA server
    // supplies it in this independent game product. SNTP starts asynchronously.
    static bool time_sync_started = false;
    if (!time_sync_started) {
        esp_sntp_config_t config = ESP_NETIF_SNTP_DEFAULT_CONFIG("ntp.aliyun.com");
        config.wait_for_sync = false;
        const auto result = esp_netif_sntp_init(&config);
        time_sync_started = result == ESP_OK;
        if (!time_sync_started)
            ESP_LOGW(TAG, "Game SNTP initialization: %s", esp_err_to_name(result));
    }
    persona_network_ready_ = true;
    if (protocol_)
        persona_retry_at_ = clock_ticks_ + 1;
#endif
    ESP_LOGI(TAG, "Network connected");
    auto state = GetDeviceState();

    if (state == kDeviceStateStarting || state == kDeviceStateWifiConfiguring) {
        // Network is ready, start activation
        SetDeviceState(kDeviceStateActivating);
        if (activation_task_handle_ != nullptr) {
            ESP_LOGW(TAG, "Activation task already running");
            return;
        }

        xTaskCreate(
            [](void* arg) {
                Application* app = static_cast<Application*>(arg);
                app->ActivationTask();
                app->activation_task_handle_ = nullptr;
                vTaskDelete(NULL);
            },
            "activation", 4096 * 2, this, 2, &activation_task_handle_);
    }

    // Update the status bar immediately to show the network state
    auto display = Board::GetInstance().GetDisplay();
    display->UpdateStatusBar(true);
}

void Application::HandleNetworkDisconnectedEvent() {
    CancelWakeResponse();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    persona_network_ready_ = false;
    EndAgentControl("disconnected", false);
    CancelCaptureTask("disconnected", false);
    CancelPlaybackTask("disconnected", false);
    ++persona_mcp_generation_;
    persona_turn_.BeginSession("", false);
    pending_listening_start_ = false;
    if (persona_open_running_) {
        Board::GetInstance().GetDisplay()->OnSessionClosed();
        audio_service_.ResetDecoder();
        return;
    }
#endif
    // Close current conversation when network disconnected
    auto state = GetDeviceState();
    if (state == kDeviceStateNotifying) {
        StopNotification();
    }
    if (state == kDeviceStateConnecting || state == kDeviceStateListening ||
        state == kDeviceStateSpeaking) {
        ESP_LOGI(TAG, "Closing audio channel due to network disconnection");
        protocol_->CloseAudioChannel();
    }

    // Update the status bar immediately to show the network state
    auto display = Board::GetInstance().GetDisplay();
    display->UpdateStatusBar(true);
}

void Application::HandleActivationDoneEvent() {
    ESP_LOGI(TAG, "Activation done");

    SystemInfo::PrintHeapStats();
    SetDeviceState(kDeviceStateIdle);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_network_ready_)
        persona_retry_at_ = clock_ticks_ + 1;
#endif

    has_server_time_ = ota_->HasServerTime();

    // Protocol start may have already raised MAIN_EVENT_ERROR. Do not replace
    // that alert with the "ready" UI/sound — the main loop can process both
    // events back-to-back because the activation task is lower priority.
    const bool has_error = !last_error_message_.empty();
    if (!has_error) {
        auto display = Board::GetInstance().GetDisplay();
        std::string message = std::string(Lang::Strings::VERSION) + ota_->GetCurrentVersion();
        display->ShowNotification(message.c_str());
        display->SetChatMessage("system", "");
    }

    // Release OTA object after activation is complete
    ota_.reset();
    auto& board = Board::GetInstance();
    board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);

    if (!has_error) {
        Schedule([this]() {
            // Play the success sound to indicate the device is ready
            audio_service_.PlaySound(Lang::Sounds::OGG_SUCCESS);
        });
    }
}

void Application::ActivationTask() {
    // Create OTA object for activation process
    ota_ = std::make_unique<Ota>();

    // Check for new assets version
    CheckAssetsVersion();

    // Check for new firmware version
#ifndef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    CheckNewVersion();
#else
    // Independent endpoint: no public Xiaozhi activation/OTA discovery.
    // Main loop validates the new image after 30 seconds of healthy runtime.
#endif

    // Initialize the protocol
    InitializeProtocol();

    // Signal completion to main loop
    xEventGroupSetBits(event_group_, MAIN_EVENT_ACTIVATION_DONE);
}

void Application::CheckAssetsVersion() {
    // Only allow CheckAssetsVersion to be called once
    if (assets_version_checked_) {
        return;
    }
    assets_version_checked_ = true;

    auto& board = Board::GetInstance();
    auto display = board.GetDisplay();
    auto& assets = Assets::GetInstance();

    if (!assets.partition_valid()) {
        ESP_LOGW(TAG, "Assets partition is disabled for board %s", BOARD_NAME);
        return;
    }

    Settings settings("assets", true);
    // Check if there is a new assets need to be downloaded
    std::string download_url = settings.GetString("download_url");

    if (!download_url.empty()) {
        settings.EraseKey("download_url");

        char message[256];
        snprintf(message, sizeof(message), Lang::Strings::FOUND_NEW_ASSETS, download_url.c_str());
        Alert(Lang::Strings::LOADING_ASSETS, message, "cloud_download", Lang::Sounds::OGG_UPGRADE);

        // Wait for the audio service to be idle for 3 seconds
        vTaskDelay(pdMS_TO_TICKS(3000));
        SetDeviceState(kDeviceStateUpgrading);
        board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);
        display->SetChatMessage("system", Lang::Strings::PLEASE_WAIT);

        bool success =
            assets.Download(download_url, [this, display](int progress, size_t speed) -> void {
                char buffer[32];
                snprintf(buffer, sizeof(buffer), "%d%% %uKB/s", progress, speed / 1024);
                Schedule([display, message = std::string(buffer)]() {
                    display->SetChatMessage("system", message.c_str());
                });
            });

        board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);
        vTaskDelay(pdMS_TO_TICKS(1000));

        if (!success) {
            Alert(Lang::Strings::ERROR, Lang::Strings::DOWNLOAD_ASSETS_FAILED, "cancel",
                  Lang::Sounds::OGG_EXCLAMATION);
            vTaskDelay(pdMS_TO_TICKS(2000));
            SetDeviceState(kDeviceStateActivating);
            return;
        }
    }

    // Apply assets
    assets.Apply();
    display->SetChatMessage("system", "");
    display->SetEmotion("robot_2");
}

void Application::CheckNewVersion() {
    const int MAX_RETRY = 10;
    int retry_count = 0;
    int retry_delay = 10;  // Initial retry delay in seconds

    auto& board = Board::GetInstance();
    while (true) {
        auto display = board.GetDisplay();
        display->SetStatus(Lang::Strings::CHECKING_NEW_VERSION);

        auto check = ota_->CheckVersion();
        if (!check) {
            retry_count++;
            if (retry_count >= MAX_RETRY) {
                ESP_LOGE(TAG, "Too many retries, exit version check");
                return;
            }

            const auto& err = check.error();
            char error_message[160];
            int error_message_length =
                snprintf(error_message, sizeof(error_message), "%s", err.ToString().c_str());
            if (error_message_length < 0 ||
                error_message_length >= static_cast<int>(sizeof(error_message))) {
                snprintf(error_message, sizeof(error_message), "%s", err.Message());
            }

            char buffer[320];
            int alert_message_length =
                snprintf(buffer, sizeof(buffer), Lang::Strings::CHECK_NEW_VERSION_FAILED,
                         retry_delay, error_message);
            if (alert_message_length < 0 ||
                alert_message_length >= static_cast<int>(sizeof(buffer))) {
                snprintf(buffer, sizeof(buffer), "%s", err.Message());
            }
            Alert(Lang::Strings::ERROR, buffer, "cloud_off", Lang::Sounds::OGG_EXCLAMATION);

            ESP_LOGW(TAG, "Check new version failed, retry in %d seconds (%d/%d)", retry_delay,
                     retry_count, MAX_RETRY);
            for (int i = 0; i < retry_delay; i++) {
                vTaskDelay(pdMS_TO_TICKS(1000));
                if (GetDeviceState() == kDeviceStateIdle) {
                    break;
                }
            }
            retry_delay *= 2;  // Double the retry delay
            continue;
        }
        retry_count = 0;
        retry_delay = 10;  // Reset retry delay

        if (ota_->HasNewVersion()) {
            if (UpgradeFirmware(ota_->GetFirmwareUrl(), ota_->GetFirmwareVersion())) {
                return;  // This line will never be reached after reboot
            }
            // If upgrade failed, continue to normal operation
        }

        // No new version, mark the current version as valid
        ota_->MarkCurrentVersionValid();
        if (!ota_->HasActivationCode() && !ota_->HasActivationChallenge()) {
            // Exit the loop if done checking new version
            break;
        }

        display->SetStatus(Lang::Strings::ACTIVATION);
        // Activation code is shown to the user and waiting for the user to input
        if (ota_->HasActivationCode()) {
            ShowActivationCode(ota_->GetActivationCode(), ota_->GetActivationMessage());
        }

        // This will block the loop until the activation is done or timeout
        for (int i = 0; i < 10; ++i) {
            ESP_LOGI(TAG, "Activating... %d/%d", i + 1, 10);
            esp_err_t err = ota_->Activate();
            if (err == ESP_OK) {
                break;
            } else if (err == ESP_ERR_TIMEOUT) {
                vTaskDelay(pdMS_TO_TICKS(3000));
            } else {
                vTaskDelay(pdMS_TO_TICKS(10000));
            }
            if (GetDeviceState() == kDeviceStateIdle) {
                break;
            }
        }
    }
}

void Application::InitializeProtocol() {
    auto& board = Board::GetInstance();
    auto display = board.GetDisplay();
    auto codec = board.GetAudioCodec();

    display->SetStatus(Lang::Strings::LOADING_PROTOCOL);

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    protocol_ = std::make_unique<WebsocketProtocol>();
#else
    if (ota_->HasMqttConfig()) {
        protocol_ = std::make_unique<MqttProtocol>();
    } else if (ota_->HasWebsocketConfig()) {
        protocol_ = std::make_unique<WebsocketProtocol>();
    } else {
        ESP_LOGW(TAG, "No protocol specified in the OTA config, using MQTT");
        protocol_ = std::make_unique<MqttProtocol>();
    }

#endif

    protocol_->OnConnected([this]() { DismissAlert(); });

    protocol_->OnNetworkError([this](const std::string& message) {
        last_error_message_ = message;
        xEventGroupSetBits(event_group_, MAIN_EVENT_ERROR);
    });

    protocol_->OnIncomingAudio([this](std::unique_ptr<AudioStreamPacket> packet) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        if (persona_agent_release_pending_.load())
            return;
        if (persona_playback_engaged_.load()) {
            if (persona_playback_.AcceptFrame(packet->payload.size())) {
                packet->sample_rate = 16000;
                packet->frame_duration = 60;
                packet->playback_id = persona_playback_.LocalId();
                // Never block the network callback or the independent stop path.
                if (!audio_service_.PushPacketToDecodeQueue(std::move(packet), false))
                    persona_playback_.Fail("queue_full");
            }
            xEventGroupSetBits(event_group_, MAIN_EVENT_TASK_PLAYBACK);
            return;
        }
        if (persona_user_stopped_.load() || persona_playback_silent_.load())
            return;
#endif
        if (GetDeviceState() == kDeviceStateSpeaking) {
            audio_service_.PushPacketToDecodeQueue(std::move(packet));
        }
    });

    protocol_->OnAudioChannelOpened([this, codec, &board]() {
        board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        Schedule([this, session = protocol_->session_id(),
                  enabled = protocol_->explicit_listen_control()]() {
            if (!persona_user_stopped_.load() && protocol_ && !protocol_->control_only() &&
                protocol_->session_id() == session) {
                persona_turn_.BeginSession(session, enabled);
                pending_listening_start_ = false;
            }
        });
#endif
        if (protocol_->server_sample_rate() != codec->output_sample_rate()) {
            ESP_LOGW(TAG,
                     "Server sample rate %d does not match device output sample rate %d, "
                     "resampling may cause distortion",
                     protocol_->server_sample_rate(), codec->output_sample_rate());
        }
    });

    protocol_->OnAudioChannelClosed([this, &board]() {
        board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);
        Schedule([this
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
                  ,
                  closed_session = protocol_ ? protocol_->session_id() : std::string()
#endif
        ]() {
            auto display = Board::GetInstance().GetDisplay();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            const auto action = persona::ClosedSessionPolicy(
                closed_session, protocol_ ? protocol_->session_id() : std::string(),
                GetDeviceState(), wake_response_.active());
            if (action == persona::ClosedSessionAction::Ignore)
                return;
            if (action == persona::ClosedSessionAction::KeepWakeResponse) {
                // The retiring cloud session does not own the local wake cue.
                // Resetting its decoder here used to truncate the cue at once.
                Board::GetInstance().SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);
                ESP_LOGI(TAG, "Retired session closed; local wake response preserved");
                return;
            }
            EndAgentControl("disconnected", false);
            CancelCaptureTask("disconnected", false);
            CancelPlaybackTask("disconnected", false);
            ++persona_mcp_generation_;
            persona_retry_at_ =
                persona_user_stopped_.load() ? 0 : clock_ticks_ + persona_retry_delay_;
            persona_turn_.BeginSession("", false);
            pending_listening_start_ = false;
#endif
            display->OnSessionClosed();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            if (action == persona::ClosedSessionAction::KeepLocalTest)
                return;
#endif
            audio_service_.ResetDecoder();
            display->SetChatMessage("system", "");
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            if (action == persona::ClosedSessionAction::KeepConnecting)
                return;
#endif
            SetDeviceState(kDeviceStateIdle);
        });
    });

    protocol_->OnIncomingJson([this, display](const cJSON* root) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        auto management_kind = cJSON_GetObjectItemCaseSensitive(root, "type");
        if (cJSON_IsString(management_kind) &&
            strcmp(management_kind->valuestring, "agent.dialogue") == 0) {
            persona::AgentDialogueRequest request;
            if (protocol_ &&
                persona::ParseAgentDialogueRequest(root, protocol_->session_id(), request)) {
                const auto generation = persona_mcp_generation_.load();
                Schedule([this, request = std::move(request), generation]() {
                    if (protocol_ && protocol_->IsAudioChannelOpened() &&
                        protocol_->session_id() == request.session &&
                        persona_mcp_generation_.load() == generation &&
                        !persona_agent_release_pending_.load() &&
                        persona_agent_control_.AcceptDialogue(request)) {
                        Board::GetInstance().GetDisplay()->SetAgentDialogue(
                            request.role.c_str(), request.phase.c_str(), request.text.c_str());
                    }
                });
            }
            return;
        }
        if (cJSON_IsString(management_kind) &&
            strcmp(management_kind->valuestring, "agent.control") == 0) {
            persona::AgentControlRequest request;
            if (protocol_ &&
                persona::ParseAgentControlRequest(root, protocol_->session_id(), request)) {
                const auto generation = persona_mcp_generation_.load();
                Schedule([this, request = std::move(request), generation]() {
                    if (protocol_ && protocol_->IsAudioChannelOpened() &&
                        protocol_->session_id() == request.session &&
                        persona_mcp_generation_.load() == generation)
                        HandleAgentControl(request);
                });
            }
            return;
        }
        if (cJSON_IsString(management_kind) &&
            (strcmp(management_kind->valuestring, "mission.status") == 0 ||
             strcmp(management_kind->valuestring, "robot.drive.status") == 0)) {
            if (protocol_)
                display->HandleDeviceMessage(root, protocol_->session_id());
            return;
        }
        if (cJSON_IsString(management_kind) &&
            strcmp(management_kind->valuestring, "capture.task") == 0) {
            persona::CaptureRequest request;
            if (protocol_ && persona::ParseCaptureRequest(root, protocol_->session_id(), request)) {
                const auto generation = persona_mcp_generation_.load();
                Schedule([this, request = std::move(request), generation]() {
                    if (protocol_ && protocol_->IsAudioChannelOpened() &&
                        protocol_->session_id() == request.session &&
                        persona_mcp_generation_.load() == generation)
                        HandleCaptureTask(request);
                });
            }
            return;
        }
        if (cJSON_IsString(management_kind) &&
            strcmp(management_kind->valuestring, "playback.task") == 0) {
            persona::PlaybackRequest request;
            if (protocol_ &&
                persona::ParsePlaybackRequest(root, protocol_->session_id(), request)) {
                const auto generation = persona_mcp_generation_.load();
                Schedule([this, request = std::move(request), generation]() {
                    if (protocol_ && protocol_->IsAudioChannelOpened() &&
                        protocol_->session_id() == request.session &&
                        persona_mcp_generation_.load() == generation)
                        HandlePlaybackTask(request);
                });
            }
            return;
        }
        if ((persona_capture_engaged_.load() || persona_playback_engaged_.load() ||
             persona_playback_silent_.load()) &&
            (!cJSON_IsString(management_kind) || strcmp(management_kind->valuestring, "mcp") != 0))
            return;
        if (persona_user_stopped_.load() || (protocol_ && protocol_->control_only()) ||
            GetDeviceState() == kDeviceStateAudioTesting)
            return;
        auto sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
        if (!protocol_ || !cJSON_IsString(sid) || protocol_->session_id() != sid->valuestring)
            return;
        auto schedule_message =
            [this, session = std::string(sid->valuestring),
             generation = persona_turn_.EventGeneration()](std::function<void()>&& task) {
                Schedule([this, session, generation, task = std::move(task)]() {
                    if (!persona_user_stopped_.load() && protocol_ &&
                        protocol_->session_id() == session &&
                        persona_turn_.AcceptsEvent(session, generation))
                        task();
                });
            };
        if (protocol_->explicit_listen_control()) {
            auto kind = cJSON_GetObjectItemCaseSensitive(root, "type");
            auto state = cJSON_GetObjectItemCaseSensitive(root, "state");
            auto response = cJSON_GetObjectItemCaseSensitive(root, "response_id");
            const bool valid_response = cJSON_IsString(response) && response->valuestring[0] &&
                                        strlen(response->valuestring) <= 128;
            if (cJSON_IsString(kind) && strcmp(kind->valuestring, "persona.state") == 0 &&
                cJSON_IsString(state)) {
                if (strcmp(state->valuestring, "thinking") == 0 && valid_response) {
                    schedule_message([this, session = std::string(sid->valuestring),
                                      id = std::string(response->valuestring)]() {
                        if (persona_turn_.MatchesSession(session))
                            persona_turn_.Announce(id);
                    });
                } else if (strcmp(state->valuestring, "error") == 0) {
                    schedule_message([this, session = std::string(sid->valuestring)]() {
                        if (persona_turn_.MatchesSession(session)) {
                            persona_turn_.Abort(false);
                            pending_listening_start_ = false;
                        }
                    });
                }
            } else if (cJSON_IsString(kind) && strcmp(kind->valuestring, "listen.control") == 0) {
                if (cJSON_IsString(state) && strcmp(state->valuestring, "start") == 0 &&
                    valid_response) {
                    schedule_message([this, session = std::string(sid->valuestring),
                                      id = std::string(response->valuestring)]() {
                        if (!protocol_ || protocol_->session_id() != session ||
                            !persona_turn_.MatchesSession(session) ||
                            !persona_turn_.GrantListening(id))
                            return;
                        // Text-only replies can leave the state in Listening with capture off.
                        if (GetDeviceState() == kDeviceStateListening) {
                            Board::GetInstance().GetDisplay()->SetStatus(Lang::Strings::LISTENING);
                            StartListeningAudio();
                        } else {
                            SetListeningMode(GetDefaultListeningMode());
                        }
                    });
                }
                return;
            } else if (cJSON_IsString(kind) && strcmp(kind->valuestring, "tts") == 0 &&
                       cJSON_IsString(state) &&
                       (strcmp(state->valuestring, "start") == 0 ||
                        strcmp(state->valuestring, "stop") == 0)) {
                if (!valid_response)
                    return;
                const bool start = strcmp(state->valuestring, "start") == 0;
                schedule_message([this, session = std::string(sid->valuestring),
                                  id = std::string(response->valuestring), start,
                                  schedule_message]() {
                    if (!protocol_ || protocol_->session_id() != session ||
                        !persona_turn_.MatchesSession(session))
                        return;
                    if (start) {
                        if (!persona_turn_.StartAudio(id))
                            return;
                        aborted_ = false;
                        pending_listening_start_ = false;
                        audio_service_.EnableVoiceProcessing(false);
                        // Tool follow-up audio can begin while already Speaking. Each
                        // server response has a fresh Opus encoder; reset this stream
                        // before ready, when no new audio frames can have arrived.
                        if (GetDeviceState() == kDeviceStateSpeaking)
                            audio_service_.ResetDecoder();
                        SetDeviceState(kDeviceStateSpeaking);
                        // Let the Speaking transition reset the decoder before acknowledging.
                        schedule_message([this, session, id]() {
                            if (!protocol_ || protocol_->session_id() != session ||
                                !persona_turn_.MatchesSession(session) ||
                                persona_turn_.response() != id ||
                                GetDeviceState() != kDeviceStateSpeaking)
                                return;
                            cJSON* event = cJSON_CreateObject();
                            cJSON_AddStringToObject(event, "type", "tts.ready");
                            cJSON_AddStringToObject(event, "response_id", id.c_str());
                            protocol_->SendDeviceEvent(event);
                            cJSON_Delete(event);
                        });
                    } else if (persona_turn_.StopAudio(id)) {
                        // Stay out of capture until the server grants the next turn.
                        audio_service_.EnableVoiceProcessing(false);
                        pending_listening_start_ = false;
                        CompletePersonaPlayback();
                    }
                });
                return;
            }
        }
#else
        auto schedule_message = [this](std::function<void()>&& task) { Schedule(std::move(task)); };
#endif
        if (protocol_ && display->HandleDeviceMessage(root, protocol_->session_id()))
            return;
        // Parse JSON data
        auto type = cJSON_GetObjectItem(root, "type");
        if (!cJSON_IsString(type)) {
            ESP_LOGW(TAG, "Incoming JSON message has no type");
            return;
        }
        if (strcmp(type->valuestring, "notify") == 0) {
            auto audio_url = cJSON_GetObjectItem(root, "audio_url");
            if (!cJSON_IsString(audio_url) || audio_url->valuestring[0] == '\0') {
                ESP_LOGW(TAG, "Notify message requires audio_url");
                return;
            }

            std::vector<NotifySubtitle> subtitles;
            auto subtitles_json = cJSON_GetObjectItem(root, "subtitles");
            if (subtitles_json != nullptr && !cJSON_IsArray(subtitles_json)) {
                ESP_LOGW(TAG, "Notify subtitles must be an array");
                return;
            }
            if (cJSON_IsArray(subtitles_json)) {
                cJSON* item = nullptr;
                cJSON_ArrayForEach (item, subtitles_json) {
                    auto start_ms = cJSON_GetObjectItem(item, "start_ms");
                    auto text = cJSON_GetObjectItem(item, "text");
                    if (!cJSON_IsNumber(start_ms) || start_ms->valuedouble < 0 ||
                        start_ms->valuedouble > std::numeric_limits<uint32_t>::max() ||
                        !cJSON_IsString(text)) {
                        ESP_LOGW(TAG, "Ignoring invalid notify subtitle");
                        continue;
                    }
                    subtitles.push_back({.start_ms = static_cast<uint32_t>(start_ms->valuedouble),
                                         .text = text->valuestring});
                }
            }

            schedule_message([this, url = std::string(audio_url->valuestring),
                              subtitles = std::move(subtitles)]() mutable {
                StartNotification(std::move(url), std::move(subtitles));
            });
        } else if (strcmp(type->valuestring, "tts") == 0) {
            auto state = cJSON_GetObjectItem(root, "state");
            if (!cJSON_IsString(state)) {
                return;
            }
            if (strcmp(state->valuestring, "start") == 0) {
                schedule_message([this, schedule_message]() {
                    aborted_ = false;
                    SetDeviceState(kDeviceStateSpeaking);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
                    schedule_message([this]() {
                        if (!protocol_ || GetDeviceState() != kDeviceStateSpeaking)
                            return;
                        cJSON* event = cJSON_CreateObject();
                        cJSON_AddStringToObject(event, "type", "tts.ready");
                        protocol_->SendDeviceEvent(event);
                        cJSON_Delete(event);
                    });
#endif
                });
            } else if (strcmp(state->valuestring, "stop") == 0) {
                schedule_message([this]() {
                    if (GetDeviceState() == kDeviceStateSpeaking) {
                        if (listening_mode_ == kListeningModeManualStop) {
                            SetDeviceState(kDeviceStateIdle);
                        } else {
                            SetDeviceState(kDeviceStateListening);
                        }
                    }
                });
            } else if (strcmp(state->valuestring, "sentence_start") == 0) {
                auto text = cJSON_GetObjectItem(root, "text");
                if (cJSON_IsString(text)) {
                    std::vector<TextGlyph> glyphs;
                    uint8_t bpp = 0;
                    if (!TextGlyphPayload::Parse(root, glyphs, bpp)) {
                        glyphs.clear();
                    }
                    ESP_LOGI(TAG, "<< %s", text->valuestring);
                    schedule_message([display, message = std::string(text->valuestring),
                                      glyphs = std::move(glyphs), bpp]() {
                        display->AddTextGlyphs(glyphs, bpp);
                        display->SetChatMessage("assistant", message.c_str());
                    });
                }
            }
        } else if (strcmp(type->valuestring, "stt") == 0) {
            auto text = cJSON_GetObjectItem(root, "text");
            if (cJSON_IsString(text)) {
                std::vector<TextGlyph> glyphs;
                uint8_t bpp = 0;
                if (!TextGlyphPayload::Parse(root, glyphs, bpp)) {
                    glyphs.clear();
                }
                ESP_LOGI(TAG, ">> %s", text->valuestring);
                schedule_message([display, message = std::string(text->valuestring),
                                  glyphs = std::move(glyphs), bpp]() {
                    display->AddTextGlyphs(glyphs, bpp);
                    display->SetChatMessage("user", message.c_str());
                });
            }
        } else if (strcmp(type->valuestring, "llm") == 0) {
            auto emotion = cJSON_GetObjectItem(root, "emotion");
            if (cJSON_IsString(emotion)) {
                schedule_message([display, emotion_str = std::string(emotion->valuestring)]() {
                    display->SetEmotion(emotion_str.c_str());
                });
            }
        } else if (strcmp(type->valuestring, "mcp") == 0) {
            auto payload = cJSON_GetObjectItem(root, "payload");
            if (cJSON_IsObject(payload)) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
                CJsonStringUniquePtr text(cJSON_PrintUnformatted(payload));
                if (!text)
                    return;
                auto current = [this, session = std::string(sid->valuestring),
                                generation = persona_mcp_generation_.load()]() {
                    return protocol_ &&
                           persona::IsCurrentMcpRequest(generation, persona_mcp_generation_.load(),
                                                        session, protocol_->session_id(),
                                                        protocol_->IsAudioChannelOpened());
                };
                // Parsing, execution and response all stay on the main task and the
                // originating channel. A queued old tool must not affect a new turn.
                Schedule([this, message = std::string(text.get()), current]() {
                    if (!current())
                        return;
                    McpServer::GetInstance().ParseMessage(
                        message,
                        [this, current](const std::string& result) {
                            if (!current())
                                return;
                            CJsonUniquePtr response(cJSON_CreateObject());
                            CJsonUniquePtr body(cJSON_Parse(result.c_str()));
                            if (!response || !body)
                                return;
                            cJSON_AddStringToObject(response.get(), "type", "mcp");
                            if (!cJSON_AddItemToObject(response.get(), "payload", body.get()))
                                return;
                            body.release();
                            protocol_->SendDeviceEvent(response.get());
                        },
                        current);
                });
#else
                McpServer::GetInstance().ParseMessage(payload);
#endif
            }
        } else if (strcmp(type->valuestring, "system") == 0) {
            auto command = cJSON_GetObjectItem(root, "command");
            if (cJSON_IsString(command)) {
                ESP_LOGI(TAG, "System command: %s", command->valuestring);
                if (strcmp(command->valuestring, "reboot") == 0) {
                    // Do a reboot if user requests a OTA update
                    schedule_message([this]() { Reboot(); });
                } else {
                    ESP_LOGW(TAG, "Unknown system command: %s", command->valuestring);
                }
            }
        } else if (strcmp(type->valuestring, "alert") == 0) {
            auto status = cJSON_GetObjectItem(root, "status");
            auto message = cJSON_GetObjectItem(root, "message");
            auto emotion = cJSON_GetObjectItem(root, "emotion");
            if (cJSON_IsString(status) && cJSON_IsString(message) && cJSON_IsString(emotion)) {
                Alert(status->valuestring, message->valuestring, emotion->valuestring,
                      Lang::Sounds::OGG_VIBRATION);
            } else {
                ESP_LOGW(TAG, "Alert command requires status, message and emotion");
            }
#if CONFIG_RECEIVE_CUSTOM_MESSAGE
        } else if (strcmp(type->valuestring, "custom") == 0) {
            auto payload = cJSON_GetObjectItem(root, "payload");
            CJsonStringUniquePtr root_json(cJSON_PrintUnformatted(root));
            ESP_LOGI(TAG, "Received custom message: %s", root_json ? root_json.get() : "");
            if (cJSON_IsObject(payload)) {
                CJsonStringUniquePtr payload_json(cJSON_PrintUnformatted(payload));
                if (payload_json) {
                    schedule_message(
                        [this, display, payload_str = std::string(payload_json.get())]() {
                            display->SetChatMessage("system", payload_str.c_str());
                        });
                }
            } else {
                ESP_LOGW(TAG, "Invalid custom message format: missing payload");
            }
#endif
        } else {
            ESP_LOGW(TAG, "Unknown message type: %s", type->valuestring);
        }
    });

    protocol_->Start();
}

void Application::ShowActivationCode(const std::string& code, const std::string& message) {
    struct digit_sound {
        char digit;
        const std::string_view& sound;
    };
    static const std::array<digit_sound, 10> digit_sounds{
        {digit_sound{'0', Lang::Sounds::OGG_0}, digit_sound{'1', Lang::Sounds::OGG_1},
         digit_sound{'2', Lang::Sounds::OGG_2}, digit_sound{'3', Lang::Sounds::OGG_3},
         digit_sound{'4', Lang::Sounds::OGG_4}, digit_sound{'5', Lang::Sounds::OGG_5},
         digit_sound{'6', Lang::Sounds::OGG_6}, digit_sound{'7', Lang::Sounds::OGG_7},
         digit_sound{'8', Lang::Sounds::OGG_8}, digit_sound{'9', Lang::Sounds::OGG_9}}};

    // This sentence uses 9KB of SRAM, so we need to wait for it to finish
    Alert(Lang::Strings::ACTIVATION, message.c_str(), "link", Lang::Sounds::OGG_ACTIVATION);

    for (const auto& digit : code) {
        auto it = std::find_if(digit_sounds.begin(), digit_sounds.end(),
                               [digit](const digit_sound& ds) { return ds.digit == digit; });
        if (it != digit_sounds.end()) {
            audio_service_.PlaySound(it->sound);
        }
    }
}

void Application::Alert(const char* status, const char* message, const char* emotion,
                        const std::string_view& sound) {
    ESP_LOGW(TAG, "Alert [%s] %s: %s", emotion, status, message);
    auto display = Board::GetInstance().GetDisplay();
    display->SetStatus(status);
    display->SetEmotion(emotion);
    display->SetChatMessage("system", message);
    if (!sound.empty()) {
        audio_service_.PlaySound(sound);
    }
}

void Application::DismissAlert() {
    last_error_message_.clear();
    if (GetDeviceState() == kDeviceStateIdle) {
        auto display = Board::GetInstance().GetDisplay();
        display->SetStatus(Lang::Strings::STANDBY);
        display->SetEmotion("neutral");
        display->SetChatMessage("system", "");
    }
}

void Application::ToggleChatState() { xEventGroupSetBits(event_group_, MAIN_EVENT_TOGGLE_CHAT); }

void Application::StartListening() { xEventGroupSetBits(event_group_, MAIN_EVENT_START_LISTENING); }

void Application::StopListening() { xEventGroupSetBits(event_group_, MAIN_EVENT_STOP_LISTENING); }

void Application::HandleToggleChatEvent() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_agent_owned_.load())
        return;
#endif
    auto state = GetDeviceState();

    if (state == kDeviceStateNotifying) {
        StopNotification();
        state = kDeviceStateIdle;
    }

    if (state == kDeviceStateActivating) {
        SetDeviceState(kDeviceStateIdle);
        return;
    } else if (state == kDeviceStateWifiConfiguring) {
        audio_service_.EnableAudioTesting(true);
        SetDeviceState(kDeviceStateAudioTesting);
        return;
    } else if (state == kDeviceStateAudioTesting) {
        audio_service_.EnableAudioTesting(false);
        SetDeviceState(kDeviceStateWifiConfiguring);
        return;
    }

    if (!protocol_) {
        ESP_LOGE(TAG, "Protocol not initialized");
        return;
    }

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_capture_engaged_.load()) {
        CancelCaptureTask("user_interrupt");
        state = GetDeviceState();
    }
    if (persona_playback_engaged_.load()) {
        CancelPlaybackTask("user_interrupt");
        state = GetDeviceState();
    }
    if (persona::CanStartPersonaTurn(state)) {
        if ((persona_user_stopped_.load() || protocol_->control_only()) && persona_open_running_)
            return;  // The cancelled connection must retire before a new start.
        persona_user_stopped_.store(false);
        persona_playback_silent_.store(false);
        RetireControlOnlyChannel();
    }
    if (persona_turn_.enabled() && persona::CanStartPersonaTurn(state)) {
        AbortSpeaking(kAbortReasonNone);
        StartPersonaListening(GetDefaultListeningMode());
        return;
    }
#endif

    if (state == kDeviceStateIdle) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        persona_reconnect_only_ = false;
        if (persona_turn_.enabled() && !persona_turn_.response().empty())
            AbortSpeaking(kAbortReasonNone);
#endif
        ListeningMode mode = GetDefaultListeningMode();
        if (!protocol_->IsAudioChannelOpened()) {
            SetDeviceState(kDeviceStateConnecting);
            // Schedule to let the state change be processed first (UI update)
            Schedule([this, mode]() { ContinueOpenAudioChannel(mode); });
            return;
        }
        SetListeningMode(mode);
    } else if (state == kDeviceStateSpeaking) {
        AbortSpeaking(kAbortReasonNone);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        audio_service_.ResetDecoder();
        SetListeningMode(kListeningModeAutoStop);
#endif
    } else if (state == kDeviceStateListening) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        if (persona_turn_.enabled())
            AbortSpeaking(kAbortReasonNone);
        audio_service_.ResetDecoder();
        StartListeningAudio();
#else
        protocol_->CloseAudioChannel();
#endif
    }
}

void Application::ContinueOpenAudioChannel(ListeningMode mode) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (GetDeviceState() != kDeviceStateConnecting || persona_open_running_ || !protocol_)
        return;
    if (protocol_->IsAudioChannelOpened()) {
        if (persona_reconnect_only_)
            SetDeviceState(kDeviceStateIdle);
        else
            SetListeningMode(mode);
        return;
    }
    listening_mode_ = mode;
    persona_open_running_ = true;
    auto result = xTaskCreate(
        [](void* arg) {
            auto app = static_cast<Application*>(arg);
            const bool interrupted = app->persona_reopen_after_abort_.exchange(false);
            const int64_t began = esp_timer_get_time();
            bool opened = false;
            unsigned attempts = 0;
            do {
                opened = app->protocol_->OpenAudioChannel();
                ++attempts;
                if (opened || !interrupted ||
                    !persona::RetryInterruptedSession(attempts,
                                                      (esp_timer_get_time() - began) / 1000))
                    break;
                vTaskDelay(pdMS_TO_TICKS(persona::ReconnectDelayMs(attempts - 1)));
            } while (
                persona::RetryInterruptedSession(attempts, (esp_timer_get_time() - began) / 1000));
            app->persona_open_success_.store(opened);
            xEventGroupSetBits(app->event_group_, MAIN_EVENT_PERSONA_OPENED);
            vTaskDelete(nullptr);
        },
        "persona_connect", 8192, this, 2, nullptr);
    if (result != pdPASS) {
        persona_open_running_ = false;
        SetDeviceState(kDeviceStateIdle);
        persona_retry_at_ = clock_ticks_ + 5;
    }
    return;
#endif
    // Check state again in case it was changed during scheduling
    if (GetDeviceState() != kDeviceStateConnecting) {
        return;
    }

    // Switch to performance mode before connecting to reduce latency
    auto& board = Board::GetInstance();
    board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);

    if (!protocol_->IsAudioChannelOpened()) {
        if (!protocol_->OpenAudioChannel()) {
            // Return to idle so the device is not stuck in the connecting
            // state (not every failure path reports a network error)
            SetDeviceState(kDeviceStateIdle);
            return;
        }
    }

    SetListeningMode(mode);
}

void Application::HandleStartListeningEvent() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_agent_owned_.load())
        return;
#endif
    auto state = GetDeviceState();

    if (state == kDeviceStateNotifying) {
        StopNotification();
        state = kDeviceStateIdle;
    }

    if (state == kDeviceStateActivating) {
        SetDeviceState(kDeviceStateIdle);
        return;
    } else if (state == kDeviceStateWifiConfiguring) {
        audio_service_.EnableAudioTesting(true);
        SetDeviceState(kDeviceStateAudioTesting);
        return;
    }

    if (!protocol_) {
        ESP_LOGE(TAG, "Protocol not initialized");
        return;
    }

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_capture_engaged_.load()) {
        CancelCaptureTask("user_interrupt");
        state = GetDeviceState();
    }
    if (persona_playback_engaged_.load()) {
        CancelPlaybackTask("user_interrupt");
        state = GetDeviceState();
    }
    if (persona::CanStartPersonaTurn(state)) {
        if ((persona_user_stopped_.load() || protocol_->control_only()) && persona_open_running_)
            return;
        persona_user_stopped_.store(false);
        persona_playback_silent_.store(false);
        RetireControlOnlyChannel();
    }
    if (persona_turn_.enabled() && persona::CanStartPersonaTurn(state)) {
        AbortSpeaking(kAbortReasonNone);
        StartPersonaListening(kListeningModeManualStop);
        return;
    }
#endif

    if (state == kDeviceStateIdle) {
        if (!protocol_->IsAudioChannelOpened()) {
            SetDeviceState(kDeviceStateConnecting);
            // Schedule to let the state change be processed first (UI update)
            Schedule([this]() { ContinueOpenAudioChannel(kListeningModeManualStop); });
            return;
        }
        SetListeningMode(kListeningModeManualStop);
    } else if (state == kDeviceStateSpeaking) {
        AbortSpeaking(kAbortReasonNone);
        SetListeningMode(kListeningModeManualStop);
    }
}

void Application::HandleStopListeningEvent() {
    auto state = GetDeviceState();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_capture_engaged_.load()) {
        CancelCaptureTask("user_stop");
        return;
    }
#endif

    if (state == kDeviceStateNotifying) {
        StopNotification();
    } else if (state == kDeviceStateAudioTesting) {
        audio_service_.EnableAudioTesting(false);
        SetDeviceState(kDeviceStateWifiConfiguring);
        return;
    } else if (state == kDeviceStateListening) {
        if (protocol_) {
            protocol_->SendStopListening();
        }
        SetDeviceState(kDeviceStateIdle);
    }
}

void Application::HandleWakeWordDetectedEvent() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_agent_owned_.load() || persona_agent_release_pending_.load() ||
        persona_capture_engaged_.load() || persona_playback_engaged_.load()) {
        audio_service_.EnableWakeWordDetection(false);
        return;
    }
#endif
    if (!protocol_) {
        return;
    }

    auto state = GetDeviceState();
    auto wake_word = audio_service_.GetLastWakeWord();
    ESP_LOGI(TAG, "Wake word detected: %s (state: %d)", wake_word.c_str(), (int)state);

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona::CanStartPersonaTurn(state)) {
        // A real keyword is an explicit new conversation request, just like
        // touching Start. Keep the retiring transport alive until its worker ends.
        if (persona_open_running_)
            return;
        persona_user_stopped_.store(false);
        persona_playback_silent_.store(false);
        RetireControlOnlyChannel();
    }
    if (persona_turn_.enabled() && persona::CanStartPersonaTurn(state)) {
        AbortSpeaking(kAbortReasonWakeWordDetected);
        if (StartWakeResponse(wake_word))
            return;
        BeginWakeWordInvoke(wake_word);
        return;
    }
#endif

    if (state == kDeviceStateIdle) {
        if (StartWakeResponse(wake_word))
            return;
        BeginWakeWordInvoke(wake_word);
    } else if (state == kDeviceStateNotifying) {
        StopNotification();
        if (StartWakeResponse(wake_word))
            return;
        BeginWakeWordInvoke(wake_word);
    } else if (state == kDeviceStateSpeaking || state == kDeviceStateListening) {
        AbortSpeaking(kAbortReasonWakeWordDetected);
        // Clear send queue to avoid sending residues to server
        while (audio_service_.PopPacketFromSendQueue())
            ;

        if (state == kDeviceStateListening) {
            protocol_->SendStartListening(GetDefaultListeningMode());
            audio_service_.ResetDecoder();
            audio_service_.PlaySound(Lang::Sounds::OGG_POPUP);
            // Re-enable wake word detection as it was stopped by the detection itself
            audio_service_.EnableWakeWordDetection(true);
        } else {
            // Play popup sound and start listening again
            play_popup_on_listening_ = true;
            SetListeningMode(GetDefaultListeningMode());
        }
    } else if (state == kDeviceStateActivating) {
        // Restart the activation check if the wake word is detected during activation
        SetDeviceState(kDeviceStateIdle);
    }
}

bool Application::StartWakeResponse(const std::string& wake_word) {
    auto& board = Board::GetInstance();
    if (wake_response_.active())
        return true;
    auto clip = board.GetWakeResponse();
    if (clip.sound.empty() || !board.GetAudioCodec()->SupportsPlaybackTailFence())
        return false;
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    audio_service_.ResetDecoder();
    if (!SetDeviceState(kDeviceStateConnecting))
        return false;
    uint32_t id = ++wake_response_sequence_;
    if (!id)
        id = ++wake_response_sequence_;
    auto frames = audio_service_.PlaySoundTask(clip.sound, id);
    if (!frames || !wake_response_.Begin(id, frames, esp_timer_get_time() / 1000)) {
        audio_service_.ResetDecoder();
        return false;
    }
    wake_response_word_ = wake_word;
    board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);
    board.GetDisplay()->SetChatMessage("assistant", std::string(clip.text).c_str());
    ESP_LOGI(TAG, "Wake response started: %.*s frames=%lu mic=off", int(clip.text.size()),
             clip.text.data(), static_cast<unsigned long>(frames));
    return true;
}

void Application::CancelWakeResponse() {
    if (!wake_response_.active())
        return;
    const bool owns_output = audio_service_.GetTaskPlaybackProgress().id == wake_response_.id();
    wake_response_.Cancel();
    wake_response_word_.clear();
    if (owns_output)
        audio_service_.ResetDecoder();
    ESP_LOGI(TAG, "Wake response cancelled; no listening continuation");
}

void Application::AdvanceWakeResponse() {
    if (!wake_response_.active())
        return;
    if (GetDeviceState() != kDeviceStateConnecting) {
        CancelWakeResponse();
        return;
    }
    const auto progress = audio_service_.GetTaskPlaybackProgress();
    const auto action = wake_response_.Advance(progress, audio_service_.IsPlaybackIdle(),
                                               esp_timer_get_time() / 1000);
    if (action == WakeResponseGate::Action::QueueTail) {
        if (audio_service_.QueueTaskPlaybackTail(wake_response_.id()))
            wake_response_.TailQueued();
        return;
    }
    if (action == WakeResponseGate::Action::Failed) {
        CancelWakeResponse();
        SetDeviceState(kDeviceStateIdle);
        ESP_LOGW(TAG, "Wake response did not complete; microphone remains off");
    } else if (action == WakeResponseGate::Action::Complete) {
        const auto word = std::move(wake_response_word_);
        wake_response_.Cancel();
        ESP_LOGI(TAG, "Wake response completed: frames=%lu dma_tail=true mic=off",
                 static_cast<unsigned long>(progress.written_frames));
        BeginWakeWordInvoke(word);
    }
}

void Application::BeginWakeWordInvoke(const std::string& wake_word) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_agent_owned_.load() || persona_user_stopped_.load() ||
        persona_playback_engaged_.load() || persona_playback_silent_.load()) {
        audio_service_.EnableWakeWordDetection(false);
        return;
    }
    if (protocol_ && protocol_->control_only() && persona_open_running_) {
        audio_service_.EnableWakeWordDetection(true);
        return;
    }
    persona_reconnect_only_ = false;
    RetireControlOnlyChannel();
#endif
    // Must run in the main task with the device in idle state
    audio_service_.EncodeWakeWord();

    // Always pass through the connecting state, even if the audio channel is
    // already opened. ContinueWakeWordInvoke() rejects any other state, so
    // skipping this transition would silently drop the wake word invocation.
    if (!SetDeviceState(kDeviceStateConnecting)) {
        // Wake word detection was stopped by the detection itself; restore it
        // so the device does not become unresponsive to wake words.
        audio_service_.EnableWakeWordDetection(true);
        return;
    }

    if (!protocol_->IsAudioChannelOpened()) {
        // Schedule to let the state change be processed first (UI update),
        // then continue with OpenAudioChannel which may block for ~1 second
        Schedule([this, wake_word]() { ContinueWakeWordInvoke(wake_word); });
        return;
    }
    // Channel already opened, continue directly
    ContinueWakeWordInvoke(wake_word);
}

void Application::ContinueWakeWordInvoke(const std::string& wake_word) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (protocol_ && !protocol_->IsAudioChannelOpened()) {
        persona_pending_wake_ = wake_word;
        ContinueOpenAudioChannel(GetDefaultListeningMode());
        return;
    }
#endif
    // Check state again in case it was changed during scheduling
    if (GetDeviceState() != kDeviceStateConnecting) {
        return;
    }

    // Switch to performance mode before connecting to reduce latency
    auto& board = Board::GetInstance();
    board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);

    if (!protocol_->IsAudioChannelOpened()) {
        if (!protocol_->OpenAudioChannel()) {
            // Return to idle so the device is not stuck in the connecting
            // state (not every failure path reports a network error), and
            // wake word detection is re-enabled by the idle state handler.
            SetDeviceState(kDeviceStateIdle);
            return;
        }
    }

    ESP_LOGI(TAG, "Wake word detected: %s", wake_word.c_str());
#if CONFIG_SEND_WAKE_WORD_DATA
    // Encode and send the wake word data to the server
    while (auto packet = audio_service_.PopWakeWordPacket()) {
        protocol_->SendAudio(std::move(packet));
    }
    // Set the chat state to wake word detected
    protocol_->SendWakeWordDetected(wake_word);
    SetListeningMode(GetDefaultListeningMode());
#else
    // Set flag to play popup sound after state changes to listening
    // (PlaySound here would be cleared by ResetDecoder in EnableVoiceProcessing)
    play_popup_on_listening_ = true;
    SetListeningMode(GetDefaultListeningMode());
#endif
}

void Application::HandleStateChangedEvent() {
    DeviceState new_state = state_machine_.GetState();
    if (new_state != kDeviceStateConnecting)
        CancelWakeResponse();
    clock_ticks_ = 0;
    // Any state change invalidates a pending deferred listening start;
    // the Listening case below re-arms it when needed.
    pending_listening_start_ = false;

    auto& board = Board::GetInstance();
    auto display = board.GetDisplay();
    auto led = board.GetLed();
    led->OnStateChanged();
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_capture_engaged_.load()) {
        display->SetStatus(Lang::Strings::LISTENING);
        display->SetEmotion("neutral");
        audio_service_.EnableWakeWordDetection(false);
        return;
    }
    if ((persona_playback_engaged_.load() || persona_playback_silent_.load()) &&
        (new_state == kDeviceStateIdle || new_state == kDeviceStateListening ||
         new_state == kDeviceStateSpeaking)) {
        display->SetStatus(persona_playback_engaged_.load() ? "正在播放"
                           : persona_user_stopped_.load()   ? "对话已结束"
                                                            : "待机");
        display->SetEmotion("neutral");
        audio_service_.EnableVoiceProcessing(false);
        audio_service_.EnableWakeWordDetection(false);
        return;
    }
    if (persona_user_stopped_.load() && new_state != kDeviceStateAudioTesting) {
        display->SetStatus("对话已结束");
        display->SetEmotion("neutral");
        audio_service_.EnableVoiceProcessing(false);
        audio_service_.EnableWakeWordDetection(false);
        return;
    }
#endif

    switch (new_state) {
        case kDeviceStateUnknown:
        case kDeviceStateIdle:
            // Keep a just-raised network error visible. SetDeviceState(idle)
            // queues STATE_CHANGED after Alert(), and the idle handler would
            // otherwise wipe the status, emotion, and chat message.
            if (last_error_message_.empty()) {
                display->SetStatus(Lang::Strings::STANDBY);
                display->ClearChatMessages();  // Clear messages first
                display->SetEmotion(
                    "neutral");  // Then set emotion (wechat mode checks child count)
            }
            audio_service_.EnableVoiceProcessing(false);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
            RefreshStandbyWake();
#else
            audio_service_.EnableWakeWordDetection(true);
#endif
            break;
        case kDeviceStateConnecting:
            display->SetStatus(wake_response_.active() ? Lang::Strings::SPEAKING
                                                       : Lang::Strings::CONNECTING);
            display->SetEmotion("neutral");
            if (!wake_response_.active())
                display->SetChatMessage("system", "");
            break;
        case kDeviceStateListening:
            display->SetStatus(Lang::Strings::LISTENING);
            display->SetEmotion("neutral");

            // Make sure the audio processor is running
            if (play_popup_on_listening_ || !audio_service_.IsAudioProcessorRunning()) {
                // For auto mode, wait for the playback queue to drain before enabling
                // voice processing. This prevents audio truncation when STOP arrives
                // late due to network jitter. Instead of blocking the main loop here,
                // defer the start until MAIN_EVENT_PLAYBACK_DRAINED arrives.
                if (listening_mode_ == kListeningModeAutoStop && !audio_service_.IsPlaybackIdle()) {
                    pending_listening_start_ = true;
                } else {
                    StartListeningAudio();
                }
            } else {
                ConfigureWakeWordForListening();
            }
            break;
        case kDeviceStateSpeaking:
            display->SetStatus(Lang::Strings::SPEAKING);

            if (listening_mode_ != kListeningModeRealtime) {
                audio_service_.EnableVoiceProcessing(false);
                // Only AFE wake word can be detected in speaking mode
                audio_service_.EnableWakeWordDetection(
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
                    false
#else
                    audio_service_.IsAfeWakeWord()
#endif
                );
            }
            audio_service_.ResetDecoder();
            break;
        case kDeviceStateNotifying:
            display->SetStatus(Lang::Strings::SPEAKING);
            audio_service_.EnableVoiceProcessing(false);
            audio_service_.EnableWakeWordDetection(
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
                false
#else
                audio_service_.IsAfeWakeWord()
#endif
            );
            break;
        case kDeviceStateWifiConfiguring:
            audio_service_.EnableVoiceProcessing(false);
            audio_service_.EnableWakeWordDetection(false);
            break;
        default:
            // Do nothing
            break;
    }
}

void Application::StartListeningAudio() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_user_stopped_.load() || persona_playback_engaged_.load() ||
        persona_playback_silent_.load())
        return;
#endif
    // Runs in the main loop, either directly from HandleStateChangedEvent or
    // deferred via MAIN_EVENT_PLAYBACK_DRAINED once the playback queue drains.
    if (GetDeviceState() != kDeviceStateListening ||
        Board::GetInstance().GetDisplay()->IsAwaitingInput()) {
        return;
    }

    // A granted continuation identifies its completed response; user starts keep
    // the existing listen message after an explicit abort where needed.
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    auto response = persona_turn_.ConsumeGrant();
    if (persona_turn_.enabled() && !persona_turn_.response().empty())
        return;
    if (!response.empty()) {
        cJSON* event = cJSON_CreateObject();
        cJSON_AddStringToObject(event, "type", "listen");
        cJSON_AddStringToObject(event, "state", "start");
        cJSON_AddStringToObject(event, "mode",
                                listening_mode_ == kListeningModeRealtime   ? "realtime"
                                : listening_mode_ == kListeningModeAutoStop ? "auto"
                                                                            : "manual");
        cJSON_AddStringToObject(event, "response_id", response.c_str());
        protocol_->SendDeviceEvent(event);
        cJSON_Delete(event);
    } else
#endif
    {
        protocol_->SendStartListening(listening_mode_);
    }
    audio_service_.EnableVoiceProcessing(true);

    ConfigureWakeWordForListening();

    // Play popup sound after ResetDecoder (in EnableVoiceProcessing) has been called
    if (play_popup_on_listening_) {
        play_popup_on_listening_ = false;
        audio_service_.PlaySound(Lang::Sounds::OGG_POPUP);
    }
}

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
void Application::StartPersonaListening(ListeningMode mode) {
    if (!protocol_ || persona_user_stopped_.load())
        return;
    persona_reconnect_only_ = false;
    if (!protocol_->IsAudioChannelOpened()) {
        SetDeviceState(kDeviceStateConnecting);
        ContinueOpenAudioChannel(mode);
    } else {
        SetListeningMode(mode);
    }
}

void Application::CompletePersonaPlayback() {
    if (persona_playback_engaged_.load() || persona_playback_silent_.load() || !protocol_ ||
        !persona_turn_.MatchesSession(protocol_->session_id()))
        return;
    const auto response = persona_turn_.PlaybackDrained(audio_service_.IsPlaybackIdle());
    if (response.empty())
        return;
    cJSON* event = cJSON_CreateObject();
    cJSON_AddStringToObject(event, "type", "tts.played");
    cJSON_AddStringToObject(event, "response_id", response.c_str());
    protocol_->SendDeviceEvent(event);
    cJSON_Delete(event);
}

void Application::SendPlaybackAck(const cJSON* ack) {
    const auto session = cJSON_GetObjectItemCaseSensitive(ack, "session_id");
    if (protocol_ && cJSON_IsString(session) && protocol_->session_id() == session->valuestring)
        protocol_->SendDeviceEvent(ack);
}

void Application::HandlePlaybackTask(const persona::PlaybackRequest& request) {
    if (request.state == "start" &&
        (persona_agent_release_pending_.load() ||
         !persona_agent_control_.AllowsTask(request.session, request.control, request.mission))) {
        persona::PlaybackTask rejected;
        rejected.Start(request, 0, esp_timer_get_time() / 1000);
        rejected.Fail("not_owner");
        auto ack = rejected.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
        return;
    }
    cJSON* replay = nullptr;
    bool matched = false;
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        matched = persona_playback_.Matches(request);
        if (matched && request.state == "start")
            replay = persona_playback_.Ack();
        else if (matched && request.state == "end")
            persona_playback_.End();
        else if (matched && request.state == "cancel")
            persona_playback_.Cancel("server_cancel");
    }
    if (replay) {
        SendPlaybackAck(replay);
        cJSON_Delete(replay);
        return;
    }
    if (request.state != "start") {
        if (matched)
            AdvancePlaybackTask();
        return;
    }
    const auto state = GetDeviceState();
    const bool available = !persona_playback_engaged_.load() && !persona_capture_engaged_.load() &&
                           !persona_open_running_ &&
                           (state == kDeviceStateIdle || state == kDeviceStateListening) &&
                           persona_turn_.response().empty() && !notify_player_.IsBusy() &&
                           audio_service_.IsPlaybackIdle();
    if (!available) {
        persona::PlaybackTask rejected;
        rejected.Start(request, 0, esp_timer_get_time() / 1000);
        rejected.Fail("busy");
        auto ack = rejected.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
        return;
    }
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    while (audio_service_.PopPacketFromSendQueue()) {
    }
    pending_listening_start_ = false;
    persona_turn_.Abort();  // Invalidate scheduled ordinary TTS/listen callbacks.
    persona_playback_silent_.store(true);
    audio_service_.ResetDecoder();
    if (++persona_playback_sequence_ == 0)
        ++persona_playback_sequence_;
    const auto local_id = persona_playback_sequence_;
    if (!audio_service_.BeginTaskPlayback(local_id)) {
        persona::PlaybackTask rejected;
        rejected.Start(request, 0, esp_timer_get_time() / 1000);
        rejected.Fail("output_unavailable");
        auto ack = rejected.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
        SetDeviceState(kDeviceStateIdle);
        return;
    }
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        persona_playback_.Start(request, local_id, esp_timer_get_time() / 1000);
        persona_playback_engaged_.store(true);
        persona_playback_ack_state_.clear();
    }
    SetDeviceState(kDeviceStateSpeaking);
    AdvancePlaybackTask();  // Received is the barrier after decoder/capture setup.
}

void Application::AdvancePlaybackTask() {
    if (persona_agent_release_pending_.load() && persona_agent_control_.Active())
        return;  // Let the priority release request precede any future-waking ACK.
    if (!persona_playback_engaged_.load())
        return;
    const auto progress = audio_service_.GetTaskPlaybackProgress();
    cJSON* ack = nullptr;
    bool finished = false, completed_without_playing = false;
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        persona_playback_.CheckTimeout(esp_timer_get_time() / 1000);
        persona_playback_.Progress(progress.id, progress.written_frames, progress.tail_complete,
                                   progress.error);
        if (persona_playback_.NeedsFence() &&
            audio_service_.QueueTaskPlaybackTail(persona_playback_.LocalId()))
            persona_playback_.FenceQueued();
        if (persona_playback_.State() != persona_playback_ack_state_) {
            completed_without_playing = persona_playback_.State() == "completed" &&
                                        persona_playback_ack_state_ == "received";
            ack = persona_playback_.Ack();
            persona_playback_ack_state_ = persona_playback_.State();
        }
        finished = !persona_playback_.Active();
    }
    if (ack) {
        if (completed_without_playing) {
            auto playing = cJSON_Duplicate(ack, true);
            cJSON_ReplaceItemInObject(playing, "state", cJSON_CreateString("playing"));
            SendPlaybackAck(playing);
            cJSON_Delete(playing);
        }
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
    }
    if (finished) {
        {
            std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
            persona_playback_engaged_.store(false);
            audio_service_.ResetDecoder();
        }
        audio_service_.EnableVoiceProcessing(false);
        audio_service_.EnableWakeWordDetection(false);
        pending_listening_start_ = false;
        SetDeviceState(kDeviceStateIdle);
    }
}

void Application::CancelPlaybackTask(const char* reason, bool notify) {
    if (!persona_playback_engaged_.load())
        return;
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        persona_playback_.Cancel(reason);
        if (!notify)
            persona_playback_ack_state_ = persona_playback_.State();
    }
    AdvancePlaybackTask();
}

void Application::HandleCaptureTask(const persona::CaptureRequest& request) {
    if (request.state == "start" &&
        (persona_agent_release_pending_.load() ||
         !persona_agent_control_.AllowsTask(request.session, request.control, request.mission))) {
        persona::CaptureTask rejected;
        rejected.Start(request, 0, esp_timer_get_time() / 1000);
        rejected.Fail("not_owner");
        auto ack = rejected.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
        return;
    }
    if (persona_capture_.Matches(request)) {
        if (request.state == "start" || !persona_capture_engaged_.load()) {
            auto ack = persona_capture_.Ack();
            SendPlaybackAck(ack);
            cJSON_Delete(ack);
            return;
        }
        if (request.state == "end")
            persona_capture_.End();
        else
            persona_capture_.Cancel("server_cancel");
        AdvanceCaptureTask();
        return;
    }
    if (request.state != "start")
        return;
    const auto state = GetDeviceState();
    const bool available =
        !persona_capture_engaged_.load() && !persona_playback_engaged_.load() &&
        !persona_open_running_ && (state == kDeviceStateIdle || state == kDeviceStateListening) &&
        persona_turn_.response().empty() && !notify_player_.IsBusy() &&
        audio_service_.IsPlaybackIdle() && !audio_service_.IsAudioProcessorRunning();
    if (!available) {
        persona::CaptureTask rejected;
        rejected.Start(request, 0, esp_timer_get_time() / 1000);
        rejected.Fail("busy");
        auto ack = rejected.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
        return;
    }
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    const auto input_generation = audio_service_.ResetInputQueue();
    pending_listening_start_ = false;
    play_popup_on_listening_ = false;
    persona_turn_.Abort();
    // Capture is the only explicit exception to this silent task latch. It does
    // not clear the user's terminal stop or open a normal conversation.
    persona_playback_silent_.store(true);
    persona_capture_.Start(request, input_generation, esp_timer_get_time() / 1000);
    persona_capture_engaged_.store(true);
    if (!SetDeviceState(kDeviceStateListening)) {
        persona_capture_.Fail("invalid_state");
        AdvanceCaptureTask();
        return;
    }
    audio_service_.EnableVoiceProcessing(true);
    audio_service_.EnableWakeWordDetection(false);
    if (!audio_service_.IsAudioProcessorRunning()) {
        persona_capture_.Fail("input_unavailable");
        AdvanceCaptureTask();
        return;
    }
    auto ack = persona_capture_.Ack();
    SendPlaybackAck(ack);  // ACK is after actual capture setup, before any upload.
    cJSON_Delete(ack);
}

void Application::AdvanceCaptureTask() {
    if (persona_agent_release_pending_.load() && persona_agent_control_.Active())
        return;
    if (!persona_capture_engaged_.load())
        return;
    persona_capture_.CheckTimeout(esp_timer_get_time() / 1000);
    if (persona_capture_.Active())
        return;
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    audio_service_.ResetInputQueue();
    persona_capture_engaged_.store(false);
    pending_listening_start_ = false;
    SetDeviceState(kDeviceStateIdle);
    auto ack = persona_capture_.Ack();
    SendPlaybackAck(ack);  // Terminal ACK proves capture was closed first.
    cJSON_Delete(ack);
}

void Application::CancelCaptureTask(const char* reason, bool notify) {
    if (!persona_capture_engaged_.load())
        return;
    persona_capture_.Cancel(reason);
    if (notify) {
        AdvanceCaptureTask();
    } else {
        audio_service_.EnableVoiceProcessing(false);
        audio_service_.EnableWakeWordDetection(false);
        audio_service_.ResetInputQueue();
        persona_capture_engaged_.store(false);
        pending_listening_start_ = false;
    }
}

void Application::HandleAgentControl(const persona::AgentControlRequest& request) {
    if (persona_agent_control_.Matches(request)) {
        if (request.state == "end" && persona_agent_control_.Active()) {
            EndAgentControl("server_end");
        } else {
            auto ack = persona_agent_control_.Ack();
            SendPlaybackAck(ack);
            cJSON_Delete(ack);
        }
        return;
    }
    if (request.state != "start")
        return;
    const auto state = GetDeviceState();
    const bool available = !persona_agent_owned_.load() && !persona_open_running_ &&
                           !persona_capture_engaged_.load() && !persona_playback_engaged_.load() &&
                           !notify_player_.IsBusy() &&
                           (state == kDeviceStateIdle || state == kDeviceStateListening ||
                            state == kDeviceStateSpeaking);
    if (!available) {
        persona::AgentControlTask rejected;
        rejected.Start(request);
        rejected.Fail("busy");
        auto ack = rejected.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
        return;
    }
    persona_agent_control_.Start(request);
    const auto epoch = persona_agent_epoch_.fetch_add(1) + 1;
    persona_agent_owned_.store(true);
    persona_agent_release_pending_.store(false);
    persona_user_stopped_.store(true);
    persona_playback_silent_.store(true);
    persona_turn_.Abort();
    pending_listening_start_ = false;
    play_popup_on_listening_ = false;
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    audio_service_.ResetInputQueue();
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        audio_service_.ResetDecoder();
    }
    SetDeviceState(kDeviceStateIdle);
    Board::GetInstance().GetDisplay()->SetAgentControlView(true, request.title.c_str(), epoch);
    auto ack = persona_agent_control_.Ack();
    SendPlaybackAck(ack);  // Ownership ACK follows capture shutdown and the full-screen view.
    cJSON_Delete(ack);
}

void Application::ReleaseAgentControl(uint32_t local_epoch) {
    if (!persona_agent_owned_.load() || persona_agent_epoch_.load() != local_epoch ||
        persona_agent_release_pending_.exchange(true))
        return;
    // Drop late upload/playback immediately, before the LVGL callback schedules
    // priority main-task teardown. The immutable epoch rejects a stale button.
    xEventGroupSetBits(event_group_, MAIN_EVENT_AGENT_RELEASE);
}

void Application::EndAgentControl(const char* reason, bool notify, bool user_release) {
    if (!persona_agent_control_.Active())
        return;
    persona_agent_release_pending_.store(true);
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    audio_service_.ResetInputQueue();
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        audio_service_.ResetDecoder();  // Local output stops before any potentially slow send.
    }
    if (notify && user_release) {
        auto release = persona_agent_control_.Event("agent.release");
        const auto request_id = "release-" + std::to_string(persona_agent_epoch_.load()) + "-" +
                                std::to_string(esp_timer_get_time());
        cJSON_AddStringToObject(release, "request_id", request_id.c_str());
        // This request precedes cancellation ACKs, which can resume the mission
        // coroutine and retire its owner before the release is processed.
        SendPlaybackAck(release);
        cJSON_Delete(release);
    }
    persona_agent_control_.Release(reason);  // No late START may use this owner during teardown.
    CancelCaptureTask(reason, notify);
    CancelPlaybackTask(reason, notify);
    persona_user_stopped_.store(true);
    persona_playback_silent_.store(true);
    persona_turn_.Abort();
    ++persona_mcp_generation_;  // Retire queued task messages from the old owner.
    pending_listening_start_ = false;
    play_popup_on_listening_ = false;
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    audio_service_.ResetInputQueue();
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        audio_service_.ResetDecoder();
    }
    persona_agent_owned_.store(false);
    SetDeviceState(kDeviceStateIdle);
    Board::GetInstance().GetDisplay()->SetAgentControlView(false, "", 0);
    if (notify) {
        auto ack = persona_agent_control_.Ack();
        SendPlaybackAck(ack);
        cJSON_Delete(ack);
    }
    persona_agent_release_pending_.store(false);
}
#endif

void Application::ConfigureWakeWordForListening() {
#ifdef CONFIG_WAKE_WORD_DETECTION_IN_LISTENING
    // Enable wake word detection in listening mode (configured via Kconfig)
    audio_service_.EnableWakeWordDetection(
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        false
#else
        audio_service_.IsAfeWakeWord()
#endif
    );
#else
    // Disable wake word detection in listening mode
    audio_service_.EnableWakeWordDetection(false);
#endif
}

void Application::StartNotification(std::string audio_url, std::vector<NotifySubtitle> subtitles) {
    if (GetDeviceState() != kDeviceStateIdle || notify_player_.IsBusy()) {
        ESP_LOGW(TAG, "Ignoring notify message while device is busy");
        return;
    }

    auto& board = Board::GetInstance();
    board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        false
#else
        audio_service_.IsAfeWakeWord()
#endif
    );
    audio_service_.ReleaseWakeWordResources();
    while (audio_service_.PopPacketFromSendQueue()) {
        // Discard microphone audio left over from a previous conversation.
    }

    if (!SetDeviceState(kDeviceStateNotifying)) {
        board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);
        return;
    }

    audio_service_.ResetDecoder();
    uint32_t playback_id = ++notification_playback_id_;
    if (playback_id == 0) {
        playback_id = ++notification_playback_id_;
    }
    audio_service_.PlaySound(Lang::Sounds::OGG_POPUP);

    bool started = notify_player_.Start(
        std::move(audio_url), std::move(subtitles), playback_id,
        [this](uint32_t id, const std::string& text) {
            Schedule([this, id, text]() {
                if (GetDeviceState() == kDeviceStateNotifying && notification_playback_id_ == id) {
                    Board::GetInstance().GetDisplay()->SetChatMessage("assistant", text.c_str());
                }
            });
        },
        [this](uint32_t id, bool success) {
            Schedule([this, id, success]() { HandleNotificationFinished(id, success); });
        });

    if (!started) {
        ESP_LOGE(TAG, "Failed to start notification playback");
        StopNotification();
    }
}

void Application::StopNotification() {
    notify_player_.Stop();
    audio_service_.ResetDecoder();
    auto& board = Board::GetInstance();
    board.GetDisplay()->SetChatMessage("assistant", "");
    board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);
    if (GetDeviceState() == kDeviceStateNotifying) {
        SetDeviceState(kDeviceStateIdle);
    }
}

void Application::HandleNotificationFinished(uint32_t playback_id, bool success) {
    if (GetDeviceState() != kDeviceStateNotifying || notification_playback_id_ != playback_id) {
        return;
    }
    ESP_LOGI(TAG, "Notification playback %lu %s", static_cast<unsigned long>(playback_id),
             success ? "completed" : "failed");
    StopNotification();
}

void Application::Schedule(std::function<void()>&& callback) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        main_tasks_.push_back(std::move(callback));
    }
    xEventGroupSetBits(event_group_, MAIN_EVENT_SCHEDULE);
}

#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
bool Application::SendManagementEvent(const cJSON* event) {
    (void)event;
    return false;  // Game firmware has no robot management transport.
}

void Application::FlushPendingRobotStop() {
    if (persona_pending_robot_stop_.empty())
        return;
    auto payload = std::move(persona_pending_robot_stop_);
    persona_pending_robot_stop_.clear();
    auto event = cJSON_Parse(payload.c_str());
    const bool sent = protocol_ && persona_network_ready_ && persona_open_success_.load() &&
                      protocol_->SendDeviceEvent(event);
    cJSON_Delete(event);
    Board::GetInstance().GetDisplay()->ShowNotification(
        sent ? "停止请求已发送，等待确认" : "停止请求未发送，请检查连接", 6000);
}

void Application::RetireControlOnlyChannel() {
    if (protocol_ && protocol_->control_only() && !persona_open_running_) {
        CancelCaptureTask("conversation_start");
        CancelPlaybackTask("conversation_start");
        protocol_->CloseAudioChannel();
        protocol_->SetControlOnly(false);
    }
}

void Application::EndConversation() {
    // Reject late callbacks as soon as the UI requests a terminal stop.
    if (persona_user_stopped_.exchange(true) && !persona_playback_engaged_.load() &&
        !persona_capture_engaged_.load() && !persona_agent_owned_.load())
        return;
    xEventGroupSetBits(event_group_, MAIN_EVENT_END_CONVERSATION);
}

void Application::RefreshStandbyWake() {
    if (GetDeviceState() != kDeviceStateIdle)
        return;
    const bool capture = persona_capture_engaged_.load();
    const bool arm = persona::ShouldArmStandbyWake(
        GetDeviceState(), persona_agent_owned_.load() || persona_agent_release_pending_.load(),
        capture || persona_playback_engaged_.load() || wake_response_.active(),
        notify_player_.IsBusy() || !audio_service_.IsPlaybackIdle());
    if (!capture && audio_service_.IsAudioProcessorRunning())
        audio_service_.EnableVoiceProcessing(false);
    // Re-enabling an already active WakeNet resets its input resampler. Avoid
    // doing that on every main-loop tick; only change a real enable/disable edge.
    if (audio_service_.IsWakeWordRunning() != arm) {
        audio_service_.EnableWakeWordDetection(arm);
        ESP_LOGI(TAG, "Standby wake: enabled=%d stopped=%d cloud_capture=%d", arm,
                 persona_user_stopped_.load(), audio_service_.IsAudioProcessorRunning());
    }
}

void Application::HandleEndConversationEvent() {
    CancelWakeResponse();
    EndAgentControl("user_stop", true, true);
    CancelCaptureTask("user_stop");
    CancelPlaybackTask("user_stop");
    ESP_LOGI(TAG, "End conversation: local playback stopped; session retired");
    aborted_ = true;
    ++persona_mcp_generation_;
    persona_turn_.EndSession();
    pending_listening_start_ = false;
    xEventGroupClearBits(event_group_, MAIN_EVENT_START_LISTENING | MAIN_EVENT_TOGGLE_CHAT |
                                           MAIN_EVENT_WAKE_WORD_DETECTED);
    play_popup_on_listening_ = false;
    persona_pending_wake_.clear();
    persona_retry_at_ = 0;
    persona_reconnect_only_ = false;
    // The next explicit start may need to wait for server disconnect cleanup.
    persona_reopen_after_abort_.store(true);
    last_error_message_.clear();
    if (GetDeviceState() == kDeviceStateNotifying)
        StopNotification();
    SetDeviceState(kDeviceStateIdle);
    audio_service_.EnableVoiceProcessing(false);
    audio_service_.EnableWakeWordDetection(false);
    {
        std::lock_guard<std::mutex> audio_gate(persona_audio_mutex_);
        audio_service_.ResetDecoder();
    }
    while (audio_service_.PopPacketFromSendQueue()) {
    }
    auto display = Board::GetInstance().GetDisplay();
    display->OnSessionClosed();
    display->ClearChatMessages();
    // Never destroy a transport while its background connect task is using it.
    // MAIN_EVENT_PERSONA_OPENED retires that channel when the task finishes.
    if (protocol_ && !persona_open_running_) {
        if (protocol_->IsAudioChannelOpened()) {
            cJSON* event = cJSON_CreateObject();
            cJSON_AddStringToObject(event, "type", "session.stop");
            protocol_->SendDeviceEvent(event);
            cJSON_Delete(event);
        }
        protocol_->CloseAudioChannel();
    }
    // Cloud capture stays off. The local keyword is a deliberate new start.
    RefreshStandbyWake();
    ESP_LOGI(TAG, "Conversation stopped: capture=%d wake=%d playback_idle=%d",
             audio_service_.IsAudioProcessorRunning(), audio_service_.IsWakeWordRunning(),
             audio_service_.IsPlaybackIdle());
}
#endif

void Application::AbortSpeaking(AbortReason reason) {
    ESP_LOGI(TAG, "Abort speaking");
    aborted_ = true;
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    CancelCaptureTask("user_interrupt");
    CancelPlaybackTask("user_interrupt");
    const bool reset_session = persona_turn_.enabled();
    ++persona_mcp_generation_;
    persona_turn_.Abort();
    pending_listening_start_ = false;
    if (reset_session) {
        audio_service_.EnableVoiceProcessing(false);
        audio_service_.EnableWakeWordDetection(false);
        audio_service_.ResetDecoder();
        while (audio_service_.PopPacketFromSendQueue()) {
        }
        persona_turn_.BeginSession("", false);
        persona_reopen_after_abort_.store(true);
        SetDeviceState(kDeviceStateIdle);
    }
#endif
    if (protocol_) {
        protocol_->SendAbortSpeaking(reason);
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        if (reset_session)
            protocol_->CloseAudioChannel();
#endif
    }
}

void Application::SetListeningMode(ListeningMode mode) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    if (persona_user_stopped_.load() || persona_playback_engaged_.load() ||
        persona_playback_silent_.load())
        return;
#endif
    listening_mode_ = mode;
    SetDeviceState(kDeviceStateListening);
}

ListeningMode Application::GetDefaultListeningMode() const {
    return aec_mode_ == kAecOff ? kListeningModeAutoStop : kListeningModeRealtime;
}

void Application::Reboot() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    EndAgentControl("reboot", false);
    CancelCaptureTask("reboot");
    CancelPlaybackTask("reboot");
#endif
    ESP_LOGI(TAG, "Rebooting...");
    if (GetDeviceState() == kDeviceStateNotifying) {
        StopNotification();
    }
    // Disconnect the audio channel
    if (protocol_ && protocol_->IsAudioChannelOpened()) {
        protocol_->CloseAudioChannel();
    }
    protocol_.reset();
    audio_service_.Stop();

    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
}

bool Application::UpgradeFirmware(const std::string& url, const std::string& version) {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
    EndAgentControl("upgrade", false);
    CancelCaptureTask("upgrade");
    CancelPlaybackTask("upgrade");
#endif
    auto& board = Board::GetInstance();
    auto display = board.GetDisplay();

    std::string upgrade_url = url;
    std::string version_info = version.empty() ? "(Manual upgrade)" : version;

    if (GetDeviceState() == kDeviceStateNotifying) {
        StopNotification();
    }

    // Close audio channel if it's open
    if (protocol_ && protocol_->IsAudioChannelOpened()) {
        ESP_LOGI(TAG, "Closing audio channel before firmware upgrade");
        protocol_->CloseAudioChannel();
    }
    ESP_LOGI(TAG, "Starting firmware upgrade from URL: %s", upgrade_url.c_str());

    Alert(Lang::Strings::OTA_UPGRADE, Lang::Strings::UPGRADING, "download",
          Lang::Sounds::OGG_UPGRADE);
    vTaskDelay(pdMS_TO_TICKS(3000));

    SetDeviceState(kDeviceStateUpgrading);

    std::string message = std::string(Lang::Strings::NEW_VERSION) + version_info;
    display->SetChatMessage("system", message.c_str());

    board.SetPowerSaveLevel(PowerSaveLevel::PERFORMANCE);
    audio_service_.Stop();
    vTaskDelay(pdMS_TO_TICKS(1000));

    bool upgrade_success = Ota::Upgrade(upgrade_url, [this, display](int progress, size_t speed) {
        char buffer[32];
        snprintf(buffer, sizeof(buffer), "%d%% %uKB/s", progress, speed / 1024);
        Schedule([display, message = std::string(buffer)]() {
            display->SetChatMessage("system", message.c_str());
        });
    });

    if (!upgrade_success) {
        // Upgrade failed, restart audio service and continue running
        ESP_LOGE(TAG,
                 "Firmware upgrade failed, restarting audio service and continuing operation...");
        audio_service_.Start();                              // Restart audio service
        board.SetPowerSaveLevel(PowerSaveLevel::LOW_POWER);  // Restore power save level
        Alert(Lang::Strings::ERROR, Lang::Strings::UPGRADE_FAILED, "cancel",
              Lang::Sounds::OGG_EXCLAMATION);
        vTaskDelay(pdMS_TO_TICKS(3000));
        return false;
    } else {
        // Upgrade success, reboot immediately
        ESP_LOGI(TAG, "Firmware upgrade successful, rebooting...");
        display->SetChatMessage("system", "Upgrade successful, rebooting...");
        vTaskDelay(pdMS_TO_TICKS(1000));  // Brief pause to show message
        Reboot();
        return true;
    }
}

void Application::WakeWordInvoke(const std::string& wake_word) {
    if (!protocol_) {
        return;
    }

    auto state = GetDeviceState();

    if (state == kDeviceStateIdle) {
        // May be called from outside the main task (e.g. board button
        // callbacks), so schedule the invocation instead of running it here
        Schedule([this, wake_word]() {
            if (GetDeviceState() == kDeviceStateIdle) {
                BeginWakeWordInvoke(wake_word);
            }
        });
    } else if (state == kDeviceStateNotifying) {
        Schedule([this, wake_word]() {
            if (GetDeviceState() == kDeviceStateNotifying) {
                StopNotification();
                BeginWakeWordInvoke(wake_word);
            }
        });
    } else if (state == kDeviceStateSpeaking) {
        Schedule([this]() { AbortSpeaking(kAbortReasonNone); });
    } else if (state == kDeviceStateListening) {
        Schedule([this]() {
            if (protocol_) {
                protocol_->CloseAudioChannel();
            }
        });
    }
}

bool Application::CanEnterSleepMode() {
    if (GetDeviceState() != kDeviceStateIdle) {
        return false;
    }

    if (protocol_ && protocol_->IsAudioChannelOpened()) {
        return false;
    }

    if (!audio_service_.IsIdle()) {
        return false;
    }

    // Now it is safe to enter sleep mode
    return true;
}

void Application::RegisterMcpBroadcastCallback(std::function<void(const std::string&)> callback) {
    mcp_broadcast_callback_ = std::move(callback);
}

void Application::SendMcpMessage(const std::string& payload) {
    // Always schedule to run in main task for thread safety
    Schedule([this, payload]() {
        if (protocol_) {
            protocol_->SendMcpMessage(payload);
        }
        if (mcp_broadcast_callback_) {
            mcp_broadcast_callback_(payload);
        }
    });
}

void Application::SetAecMode(AecMode mode) {
    aec_mode_ = mode;
    Schedule([this]() {
        auto& board = Board::GetInstance();
        auto display = board.GetDisplay();
        switch (aec_mode_) {
            case kAecOff:
                audio_service_.EnableDeviceAec(false);
                display->ShowNotification(Lang::Strings::RTC_MODE_OFF);
                break;
            case kAecOnServerSide:
                audio_service_.EnableDeviceAec(false);
                display->ShowNotification(Lang::Strings::RTC_MODE_ON);
                break;
            case kAecOnDeviceSide:
                audio_service_.EnableDeviceAec(true);
                display->ShowNotification(Lang::Strings::RTC_MODE_ON);
                break;
        }

        // If the AEC mode is changed, close the audio channel
        if (protocol_ && protocol_->IsAudioChannelOpened()) {
            protocol_->CloseAudioChannel();
        }
    });
}

void Application::PlaySound(const std::string_view& sound) { audio_service_.PlaySound(sound); }

void Application::ResetProtocol() {
    Schedule([this]() {
#ifdef CONFIG_BOARD_TYPE_ECHO_GAME_DISP_V1
        EndAgentControl("protocol_reset", false);
        CancelCaptureTask("protocol_reset");
        if (persona_open_running_) {
            persona_reset_pending_ = true;
            return;
        }
        persona_retry_at_ = 0;
        CancelPlaybackTask("protocol_reset");
        ++persona_mcp_generation_;
        persona_turn_.BeginSession("", false);
        pending_listening_start_ = false;
        Board::GetInstance().GetDisplay()->OnSessionClosed();
        audio_service_.ResetDecoder();
#endif
        if (GetDeviceState() == kDeviceStateNotifying) {
            StopNotification();
        }
        // Close audio channel if opened
        if (protocol_ && protocol_->IsAudioChannelOpened()) {
            protocol_->CloseAudioChannel();
        }
        // Reset protocol
        protocol_.reset();
    });
}

bool Application::SendDeviceEvent(const cJSON* event) {
    // Called on the application task by display callbacks.
    auto expected = cJSON_GetObjectItemCaseSensitive(event, "session_id");
    return protocol_ && cJSON_IsString(expected) &&
           protocol_->session_id() == expected->valuestring && protocol_->SendDeviceEvent(event);
}
