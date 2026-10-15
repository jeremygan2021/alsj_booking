#pragma once
#include <cJSON.h>
#include <array>
#include <cstring>
#include <set>
#include <string>

namespace persona {
struct ChoiceMessage {
    std::string session, request, title;
    std::array<std::string, 4> ids{}, labels{};
    int count = 0;
    int ttl_ms = 0;
};
inline bool ReadText(const cJSON* root, const char* key, std::string& out, size_t max) {
    auto value = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(value) || !value->valuestring || !*value->valuestring ||
        std::strlen(value->valuestring) > max)
        return false;
    out = value->valuestring;
    return true;
}
inline bool ParseChoice(const cJSON* root, const std::string& session, ChoiceMessage& out) {
    ChoiceMessage value;
    if (session.empty() || !ReadText(root, "session_id", value.session, 128) ||
        value.session != session || !ReadText(root, "request_id", value.request, 128) ||
        !ReadText(root, "title", value.title, 192))
        return false;
    auto options = cJSON_GetObjectItemCaseSensitive(root, "options");
    auto ttl = cJSON_GetObjectItemCaseSensitive(root, "ttl_ms");
    if (!cJSON_IsArray(options) || cJSON_GetArraySize(options) < 1 ||
        cJSON_GetArraySize(options) > 4 || !cJSON_IsNumber(ttl) || ttl->valuedouble < 1000 ||
        ttl->valuedouble > 60000 || ttl->valuedouble != ttl->valueint)
        return false;
    value.count = cJSON_GetArraySize(options);
    value.ttl_ms = ttl->valueint;
    std::set<std::string> unique;
    for (int i = 0; i < value.count; ++i) {
        auto option = cJSON_GetArrayItem(options, i);
        if (!ReadText(option, "id", value.ids[i], 64) ||
            !ReadText(option, "label", value.labels[i], 96) || !unique.insert(value.ids[i]).second)
            return false;
    }
    out = std::move(value);
    return true;
}
}  // namespace persona
