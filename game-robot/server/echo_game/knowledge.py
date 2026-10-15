"""Read-only Function Calling into the ALSJ story knowledge base."""
import json
import inspect
import re


def function(name, description, properties, required=()):
    return {"type": "function", "function": {"name": name, "description": description,
        "parameters": {"type": "object", "additionalProperties": False,
                       "properties": properties, "required": list(required)}}}


TOOLS = [
    function("get_case_overview", "查询游戏当前幕、公开人物和可查证据编号。谈论案情前先查询知识库。", {}),
    function("search_case_knowledge", "搜索游戏知识库的公开人物和已公开证据目录。隐藏正文和答案永不返回，只提供推理引导。",
             {"query": {"type": "string", "minLength": 1, "maxLength": 200}}, ["query"]),
    function("get_case_evidence", "按编号获取已公开证据的分析方法，不返回正文、鉴定结论或答案。请玩家自己提供已拿到的内容。",
             {"evidence_id": {"type": "string", "pattern": "^E-[0-9]{2}$"}}, ["evidence_id"]),
    function("get_investigation_question", "从当前公开资料获取一个适合反问玩家的调查问题。",
             {"topic": {"type": "string", "enum": ["人物", "时间线", "证据", "一般"]}}),
    function("review_case_reasoning", "帮助检查玩家论证的证据缺口，不能判断嫌疑人正误或给出案情答案。",
             {"claim": {"type": "string", "minLength": 1, "maxLength": 600},
              "evidence_id": {"type": "string", "pattern": "^E-[0-9]{2}$"}}, ["claim"]),
]


class CaseKnowledge:
    def __init__(self, story):
        self.story = story
        self.revision = story.state.revision

    def execute(self, name, raw_arguments):
        if self.story.state.revision != self.revision:
            raise RuntimeError("Game knowledge changed; retire this session")
        try:
            if not isinstance(raw_arguments, str) or len(raw_arguments.encode()) > 4096:
                raise ValueError()
            arguments = json.loads(raw_arguments)
            if not isinstance(arguments, dict):
                raise ValueError()
            spec = next((t["function"] for t in TOOLS if t["function"]["name"] == name), None)
            if spec is None:
                return {"ok": False, "error": "unknown_game_tool"}
            schema = spec["parameters"]
            if set(arguments) - set(schema["properties"]) or any(k not in arguments for k in schema["required"]):
                raise ValueError()
            for key, value in arguments.items():
                rules = schema["properties"][key]
                if (not isinstance(value, str) or not rules.get("minLength", 0) <= len(value) <= rules.get("maxLength", 200)
                    or "enum" in rules and value not in rules["enum"]
                    or "pattern" in rules and not re.fullmatch(rules["pattern"], value)):
                    raise ValueError()
        except (ValueError, TypeError, RecursionError):
            return {"ok": False, "error": "invalid_arguments"}
        context = self.story.public_context()
        available = context["已公开证据"]
        if name == "get_case_overview":
            result = {"phase": context["当前幕"], "self_character": context["角色"],
                      "characters": context["公开人物"],
                      "policy": "只帮助推理。任何幕数都不提供新线索、凶手、手法、隐藏动机或终局答案。"}
            if "事件" in context:
                result["event"] = context["事件"]
        elif name == "get_case_evidence":
            result = next((e for e in available if e["clueId"] == arguments["evidence_id"]), None)
            if result is None:
                return {"ok": False, "error": "not_available", "message": "这一段还无法核实，不要据此猜测内容；请来客说说自己实际见到的部分。"}
            result = {"id": result["clueId"], "title": result["title"],
                      "guidance": "先请来客把自己手里那段读给你听，再抓住他已说出的一点追问来源或推理缺口。用ECHO的口吻，只问一个具体问题；不照读方法清单，不替他补充正文。",
                      "requires_player_to_read_original": True}
        elif name == "review_case_reasoning":
            eid = arguments.get("evidence_id")
            if eid and not any(e["clueId"] == eid for e in available):
                return {"ok": False, "error": "not_available", "message": "这一段还无法核实，只能根据来客已经实际获得的内容讨论。"}
            result = {"verdict": "不判定是否猜中真相，不补充玩家尚未提供的案情事实。",
                      "questions": ["你直接观察到的事实是什么？", "哪份你已拿到的证据支持这一步推论？",
                                    "是否还有其他解释，或尚未核对的证据缺口？"],
                      "player_statement_is_verified": False}
        elif name == "get_investigation_question":
            topic = arguments.get("topic", "一般")
            if available and topic != "人物":
                evidence = available[-1]
                question = f"根据已经公开的《{evidence['title']}》，你认为它能确认什么，又不能确认什么？"
            elif self.story.state.phase < 3:
                question = "今晚到现在，有哪位来客的话让你一直记着？"
            else:
                question = "你目前的判断来自哪份已经公开的证据？还有哪一步需要核对？"
            result = {"question": question, "topic": topic}
        else:
            query = arguments["query"].strip().lower()
            if not query:
                return {"ok": False, "error": "invalid_arguments"}
            terms = set(re.findall(r"e-\d+|[a-z]+|\d{1,2}:\d{2}|\d+", query))
            for run in re.findall(r"[\u3400-\u9fff]+", query):
                terms.update(run[i:i + 2] for i in range(max(1, len(run) - 1)))
            # Never send evidence body/detail, actor knowledge, truth, or source
            # text to the speaking model. This holds even in the final phase.
            documents = [dict(kind="self_character", **context["角色"])] + [dict(kind="character", **n) for n in context["公开人物"]] + [
                dict(kind="evidence", id=e["clueId"], title=e["title"],
                     guidance="请玩家提供自己已获得的原文，只帮助检查论证缺口。") for e in available]
            ranked = []
            for document in documents:
                text = json.dumps(document, ensure_ascii=False).lower()
                score = sum(term in text for term in terms) + 10 * (query in text)
                if score:
                    ranked.append((score, document))
            result = {"matches": [d for _, d in sorted(ranked, key=lambda x: x[0], reverse=True)[:5]],
                      "scope": "当前全场公开资料；空结果不能当作案情不存在"}
        return {"ok": True, "revision": self.revision, "data": result}


class ToolCalls:
    def __init__(self):
        self.calls = {}

    def add(self, item):
        cid, name, arguments = item.get("call_id"), item.get("name"), item.get("arguments")
        if (not isinstance(cid, str) or not 1 <= len(cid) <= 128 or not isinstance(name, str)
                or len(name) > 80 or not isinstance(arguments, str) or len(arguments.encode()) > 4096
                or cid not in self.calls and len(self.calls) >= 4):
            raise ValueError("Invalid game function call")
        value = (name, arguments)
        if cid in self.calls and self.calls[cid] != value:
            raise ValueError("Conflicting function call ID")
        self.calls[cid] = value

    async def respond(self, provider, knowledge):
        for cid, (name, arguments) in self.calls.items():
            result = knowledge.execute(name, arguments)
            if inspect.isawaitable(result):
                result = await result
            await provider.send({"type": "conversation.item.create", "item": {
                "type": "function_call_output", "call_id": cid,
                "output": json.dumps(result, ensure_ascii=False)}})
        await provider.send({"type": "response.create"})
