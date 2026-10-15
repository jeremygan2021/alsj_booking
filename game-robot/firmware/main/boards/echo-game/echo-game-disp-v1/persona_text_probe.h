#pragma once

#include <lvgl.h>
#include "src/misc/lv_text_private.h"

namespace persona::ui {
inline constexpr char kTextGlyphProbe[] =
    "设置返回主页开始对话停止对话正在回答正在倾听连接与声音服务器设备令牌保存并重启"
    "重新配网录音回放测试音量亮度取消选择本轮对话已结束点击说话再继续"
    "好的，我会听你说话。现在可以显示左手、右手和头部摄像头，也可以查询时间。"
    "机器人停止任务无任务待确认已确认执行中等待工具等待对话已暂停等待恢复正在取消"
    "已取消已完成任务失败状态待确认当前没有任务返回对话暂停任务恢复任务取消任务"
    "已断开连接可在网页决策 agent 中创建任务任务由工作站管理停止请求已发送等待确认"
    "停止请求未发送请检查连接正在连接发送停止请求任务请求已发送任务请求未发送正在播放待机"
    "正在被决策Agent控制解除控制"
    "正在说话我在听你可以回答了正在理解刚才的回复现场对话已结束准备中"
    "小智你的机器人伙伴决策接管我在这里等待安排听完问题后直接回答就好"
    "由委派你随时可以解除控制现场回复陪你一起完成"
    "你好，请问你是阿甘吗？我是阿甘，是来参观公司的。"
    "通过小智询问路人是不是阿甘"
    "低速前进后退左转右转停止轮子动作完成最长五秒检查保护状态";
inline constexpr char kSmallGlyphProbe[] = "小智你说提示上下滑动语音伙伴 ·";

// Inspect the same resolved font that LVGL uses, including any dynamic fallback.
// No bitmap allocation or transcript content is logged by this check.
inline unsigned MissingTextGlyphs(const lv_font_t* font, const char* text) {
    unsigned missing = 0;
    uint32_t index = 0;
    while (const auto point = lv_text_encoded_next(text, &index)) {
        if (point < 32)
            continue;
        lv_font_glyph_dsc_t glyph{};
        if (!font || !lv_font_get_glyph_dsc(font, &glyph, point, 0) || glyph.is_placeholder)
            ++missing;
    }
    return missing;
}
}  // namespace persona::ui
