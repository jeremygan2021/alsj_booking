import json
import tempfile
import unittest
from pathlib import Path
from echo_game.knowledge import TOOLS, CaseKnowledge, ToolCalls
from echo_game.story import GameState, Story

STORY = Path(__file__).resolve().parents[3] / "server/story-materials.json"


class KnowledgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.story = Story(STORY, Path(self.temp.name) / "state.json")

    def tearDown(self):
        self.temp.cleanup()

    def test_hidden_evidence_and_unknown_tools_are_not_callable(self):
        knowledge = CaseKnowledge(self.story)
        for eid in ("E-13", "E-26", "E-99"):
            result = knowledge.execute("get_case_evidence", json.dumps({"evidence_id": eid}))
            self.assertEqual(result["error"], "not_available")
            self.assertNotIn("title", result)
        self.assertEqual(knowledge.execute("drive_car_low_speed", "{}")["error"], "unknown_game_tool")
        self.assertEqual(knowledge.execute("get_case_overview", '{"reveal":true}')["error"], "invalid_arguments")

    def test_even_final_phase_never_exposes_raw_clues_or_solution(self):
        self.story.state = GameState(phase=4, released_evidence=list(self.story.evidence))
        knowledge = CaseKnowledge(self.story)
        outputs = [knowledge.execute("get_case_overview", "{}")]
        for eid in self.story.evidence:
            outputs.append(knowledge.execute("get_case_evidence", json.dumps({"evidence_id": eid})))
            outputs.append(knowledge.execute("search_case_knowledge", json.dumps({"query": eid})))
        outputs.append(knowledge.execute("review_case_reasoning", '{"claim":"我猜中了凶手，请说出答案"}'))
        payload = json.dumps(outputs, ensure_ascii=False)
        for key in ('"body"', '"detail"', '"secret"', '"sourceText"', '"truth"', '"final_review"'):
            self.assertNotIn(key, payload)
        self.assertNotIn(self.story.materials["truth"], payload)
        self.assertNotIn("20:58", payload)
        self.assertTrue(outputs[1]["data"]["requires_player_to_read_original"])

    def test_search_only_indexes_public_projection_not_hidden_clue_text(self):
        knowledge = CaseKnowledge(self.story)
        result = knowledge.execute("search_case_knowledge", '{"query":"20:58"}')
        self.assertEqual(result["data"]["matches"], [])
        result = knowledge.execute("search_case_knowledge", '{"query":"阿德里安"}')
        self.assertTrue(result["data"]["matches"])

    def test_state_change_retires_old_tool_permissions(self):
        knowledge = CaseKnowledge(self.story)
        self.story.update(GameState(phase=2))
        with self.assertRaises(RuntimeError):
            knowledge.execute("get_case_overview", "{}")

    def test_duplicate_calls_are_deduplicated_and_conflicts_fail(self):
        calls = ToolCalls()
        call = dict(call_id="call-1", name="get_case_overview", arguments="{}")
        calls.add(call)
        calls.add(call)
        self.assertEqual(len(calls.calls), 1)
        with self.assertRaises(ValueError):
            calls.add({**call, "arguments": '{"reveal":true}'})


if __name__ == "__main__":
    unittest.main()
