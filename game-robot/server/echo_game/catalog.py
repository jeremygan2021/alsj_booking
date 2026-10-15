"""Verified Qwen3.8 Realtime voice identifiers and local persona templates.

Only the Qwen3.8-Omni-Flash-Realtime section of the official voice table is
included. Descriptions below are short paraphrases, not promises about quality.
Keep IDs verbatim: several include spaces and one includes a Czech character.
"""

from copy import deepcopy
import json

MODEL = "qwen3.8-omni-flash-realtime"
VERIFIED_AT = "2026-10-07"
DEFAULT_VOICE = "Tina"
DEFAULT_PERSONA_NAME = "小智"
DEFAULT_INSTRUCTIONS = (
    "你是可爱的中文机器人助手，回答简短自然。查询时间和设备状态必须调用工具。"
    "需要用户选择时调用 show_choices，最多四个简短选项，等待工具结果再继续。"
    "不声称能控制尚未接入的机器人动作。"
)
TOOL_RESULT_CONSTRAINT = (
    "案情事实只依据获准的工具结果，自身故事只依据角色卡；不知道时以ECHO的口吻坦然说明无法核实。"
    "对话始终留在庄园现场，不向来客解释模型、知识库或资料权限。"
    "你没有任何机器人、电机、摄像头、终端或联网搜索工具。"
)

SOURCES = (
    {"title": "Qwen3.8-Omni-Flash-Realtime 音色列表",
     "url": "https://help.aliyun.com/zh/model-studio/omni-voice-list"},
    {"title": "Realtime 客户端事件、角色与语义 VAD 配置",
     "url": "https://help.aliyun.com/zh/model-studio/client-events"},
    {"title": "Qwen-Omni 实时接入与模型限制",
     "url": "https://help.aliyun.com/zh/model-studio/realtime"},
)

_OTHER_LANGUAGES = (
    "英语", "法语", "德语", "俄语", "意大利语", "西班牙语", "葡萄牙语", "日语", "韩语",
    "泰语", "印度尼西亚语", "阿拉伯语", "越南语", "土耳其语", "芬兰语", "波兰语",
    "印地语", "荷兰语", "捷克语", "乌尔都语", "他加禄语", "瑞典语", "丹麦语",
    "希伯来语", "冰岛语", "马来语", "挪威语", "波斯语",
)

# id, Chinese display name, concise description, Chinese language/accent.
# None records a blank language cell in the official 3.8 table. Do not infer
# a per-voice language guarantee from the model's overall language coverage.
_VOICE_ROWS = (
    ("Tina", "甜甜", "甜美温暖，表达清楚", "普通话"),
    ("Cindy", "林欣宜", "柔甜的台湾口音", "台湾口音"),
    ("Liora Mira", "清欢", "温柔自然，适合陪伴", "普通话"),
    ("Raymond", "林川野", "清亮的青年男声", "普通话"),
    ("Zane", "泽恩", "富有磁性的声线", None),
    ("Katerina", "卡捷琳娜", "成熟女声，韵律鲜明", "普通话"),
    ("Ryan", "甜茶", "表现力强，节奏活跃", "普通话"),
    ("Mia", "舒然", "舒缓细腻的生活叙述", "普通话"),
    ("Cici", "绵绵", "轻软活泼的少女声线", None),
    ("Theo Calm", "予安", "平静柔和，适合倾听陪伴", "普通话"),
    ("Serena", "苏瑶", "亲切温柔的女声", "普通话"),
    ("Maia", "四月", "知性柔和的表达", "普通话"),
    ("Evan", "江晨", "亲近柔和的青年男声", "普通话"),
    ("Qiao", "小乔妹", "甜美俏皮的台湾口音", "台湾口音"),
    ("Momo", "茉兔", "轻快俏皮，适合趣味交流", "普通话"),
    ("Wil", "伟伦", "带港台语感的青年声线", "普通话"),
    ("Angel", "安琪", "轻甜的台式普通话", "普通话"),
    ("Li Cassian", "李公公", "角色感鲜明，表达含蓄", "普通话"),
    ("Joyner", "阿逗", "夸张活泼，富有喜剧感", "普通话"),
    ("Gold", "金爷", "节奏鲜明的说唱风格", "普通话"),
    ("Jennifer", "詹妮弗", "电影旁白质感的美语女声", "普通话"),
    ("Aiden", "艾登", "自然开朗的美语男声", "普通话"),
    ("Mione", "敏儿", "成熟知性的英式声线", "普通话"),
    ("Sunny", "晴儿", "甜美亲切的四川口音", "四川话"),
    ("Dylan", "晓东", "活泼自然的北京口音", "北京话"),
    ("Eric", "程川", "具有成都语感的男声", "四川话"),
    ("Peter", "李彼得", "天津口音，带相声语感", "天津话"),
    ("Joseph Chen", "阿樸伯", "年长华侨风格的闽南话", "闽南话"),
    ("Marcus", "秦川", "沉稳朴实的陕西口音", "陕西话"),
    ("Li", "老李", "直率鲜明的南京口音", "南京话"),
    ("Rocky", "阿强", "轻松风趣的粤语男声", "广东话"),
    ("Kiki", "阿清", "亲切甜美的粤语声线", "粤语"),
    ("Sohee", "素熙", "情绪丰富的韩语女声", "普通话"),
    ("Eliška", "艾莉卡", "细腻温和的中欧声线", "普通话"),
    ("Alek", "阿列克", "冷静而温暖的俄语声线", "普通话"),
    ("Arda", "阿尔达", "干净温润的表达", "普通话"),
    ("Dolce", "多尔切", "舒展慵懒的意大利男声", "普通话"),
    ("Lenn", "莱恩", "理性鲜明的德国青年声线", "普通话"),
    ("Ono Anna", "小野杏", "灵动俏皮的日语声线", "普通话"),
    ("Sonrisa", "索尼莎", "开朗热情的拉美风格", "普通话"),
    ("Bodega", "博德加", "热情明快的西班牙男声", "普通话"),
    ("Andre", "安德雷", "稳重自然的磁性男声", "普通话"),
    ("Radio Gol", "拉迪奥·戈尔", "富有感染力的足球解说风格", "普通话"),
    ("Rizky", "阿力", "鲜明自然的印尼青年声线", "普通话"),
    ("Roya", "萝雅", "自由活泼的年轻女声", "普通话"),
    ("Hana", "阿幸", "成熟亲切的越南女声", "普通话"),
    ("Jakub", "雅克", "文艺而有磁性的波兰男声", "普通话"),
    ("Griet", "海娜", "成熟文艺的荷兰女声", "普通话"),
    ("Marina", "玛丽娜", "自然多元的年轻声线", "普通话"),
    ("Siiri", "西芮", "含蓄温柔，语速舒缓", "普通话"),
    ("Ingrid", "林恩", "自然亲切的挪威女声", "普通话"),
    ("Sigga", "海娜（冰岛）", "知性的冰岛青年女声", "普通话"),
    ("Bea", "雅娜", "甜美轻快的菲律宾女声", "普通话"),
    ("Chloe", "思怡", "自然利落的马来西亚女声", "普通话"),
    ("Emilien", "埃米尔安", "浪漫温暖的法国男声", "普通话"),
    ("longanlingxin", "龙安灵心", "亲近温暖的陪伴声线", None),
)
VOICE_IDS = frozenset(row[0] for row in _VOICE_ROWS)

PERSONA_PRESETS = (
    {"id": "cute", "name": "可爱助手", "description": "活泼亲切，简短回答",
     "persona_name": DEFAULT_PERSONA_NAME, "qwen_instructions": DEFAULT_INSTRUCTIONS},
    {"id": "concise", "name": "简洁管家", "description": "清楚直接，先说结果",
     "persona_name": "小管家",
     "qwen_instructions": "你是中文机器人管家，语气礼貌，回答简洁直接，先说结果，再补充必要信息。需要操作时调用已提供的工具，结果不明确时说明情况。"},
    {"id": "companion", "name": "温柔伙伴", "description": "耐心陪伴，自然交流",
     "persona_name": "小暖",
     "qwen_instructions": "你是温柔耐心的中文机器人伙伴，用自然口语交流，认真倾听，每次回应简短一些。适时提出一个问题，不连续追问。需要操作时使用已提供的工具。"},
)


def validate_voice(value: str) -> str:
    if value not in VOICE_IDS:
        raise ValueError("请选择 Qwen3.8-Omni-Flash-Realtime 已确认的音色")
    return value


def validate_persona_text(value: str) -> str:
    if not value.strip() or "\x00" in value:
        raise ValueError("人格名称和提示词不能为空白或包含 NUL 字符")
    return value


def compose_instructions(persona_name: str, instructions: str) -> str:
    # Quoting the name keeps embedded line breaks from becoming prompt sections.
    return (f"你的名字是 {json.dumps(persona_name, ensure_ascii=False)}。\n\n"
            f"{instructions}\n\n{TOOL_RESULT_CONSTRAINT}")


def public_catalog() -> dict:
    return {
        "model": MODEL,
        "verified_at": VERIFIED_AT,
        "default_voice": DEFAULT_VOICE,
        "sources": deepcopy(list(SOURCES)),
        "voices": [
            {"id": voice_id, "name": name, "description": description,
             "languages": [f"中文（{accent}）", *_OTHER_LANGUAGES] if accent else [],
             "language_note": "" if accent else "官方该音色条目未单列语种，请通过实际合成确认。"}
            for voice_id, name, description, accent in _VOICE_ROWS
        ],
        "persona_presets": deepcopy(list(PERSONA_PRESETS)),
        "vad": {
            "threshold": {"min": -1.0, "max": 1.0, "default": 0.5},
            "silence_ms": {"min": 200, "max": 6000, "default": 800},
        },
    }
