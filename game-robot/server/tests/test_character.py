import json
import tempfile
import unittest
from pathlib import Path

from echo_game.character import SCENES, public_character
from echo_game.knowledge import CaseKnowledge
from echo_game.story import GameState, Story

STORY = Path(__file__).resolve().parents[3] / "server/story-materials.json"


class CharacterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.story = Story(STORY, Path(self.temp.name) / "state.json")

    def tearDown(self):
        self.temp.cleanup()

    def test_character_is_in_prompt_and_knowledge_without_replacing_six_peers(self):
        character = public_character()
        prompt = self.story.prompt()
        for memory in character["过去"]:
            self.assertIn(memory, prompt)
        self.assertIn(character["愿望"], prompt)
        self.assertNotIn("负责玩家语音问答", prompt)
        result = CaseKnowledge(self.story).execute("get_case_overview", "{}")
        self.assertEqual(result["data"]["self_character"], character)
        self.assertEqual(len(result["data"]["characters"]), 6)
        results = CaseKnowledge(self.story).execute("search_case_knowledge", '{"query":"ECHO"}')
        self.assertEqual(results["data"]["matches"][0]["kind"], "self_character")

    def test_scenes_follow_gm_phase_and_only_self_public_story_enters_prompt(self):
        for phase in range(1, 5):
            self.story.state = GameState(phase=phase, released_evidence=list(
                eid for eid, evidence in self.story.evidence.items() if evidence["phase"] <= phase))
            prompt = self.story.prompt()
            self.assertIn(SCENES[phase - 1], prompt)
            for other, scene in enumerate(SCENES, 1):
                if other != phase:
                    self.assertNotIn(scene, prompt)
            self.assertNotIn(self.story.materials["truth"], prompt)
            self.assertNotIn("20:58", prompt)
            self.assertNotIn("21:07", prompt)
            for evidence in self.story.evidence.values():
                if len(evidence["body"]) > 20:
                    self.assertNotIn(evidence["body"], prompt)
        character = json.dumps(public_character(), ensure_ascii=False)
        for secret in ("瑟琳娜", "莉娅", "死亡时间", "真凶", "20:58", "未授权", "处置声明"):
            self.assertNotIn(secret, character)

    def test_public_character_cannot_be_mutated_by_a_previous_tool_result(self):
        character = public_character()
        character["过去"].append("伪造记忆")
        self.assertNotIn("伪造记忆", self.story.prompt())
