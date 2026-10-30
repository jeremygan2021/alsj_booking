"""Revise only affected live performances; retain verified old dialogue and finished tracks."""
from pathlib import Path
import argparse
import copy
import json
import importlib.util
from audio_production import MODEL, atomic_json, digest, fingerprint, payload_for, read_json, rendition_hash

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_clues', ROOT/'scripts/prepare-clue-audio.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def spoken(role, text, emotion='calm', gap=.65, **extra):
    return dict(role=role, text=text, emotion=emotion, gap=gap, **extra)


def revise(config):
    tracks = {t['id']:t for t in config['tracks']}
    # Runtime release controls take precedence over old production-source labels.
    # The ending must stay collapsed with the reconstruction and real testament.
    for ident in ('A10', 'A11', 'A12'):
        tracks[ident]['spoiler'] = True
    tracks['B01']['lines'][1]['text'] = '三年前，摄影艺术家瑟琳娜·温特离世于阿拉斯加。她是索恩的恋人。艾迪艾斯早在二〇二一年就已经成立。失去瑟琳娜以后，索恩把公司的研究转向数字人格，把影像、声音和记忆交给人工智能，试图留下一个人曾经存在过的痕迹。伊寇从实验室走向商业世界，也让索恩成为人人认识的富豪。'
    tracks['A05']['lines'][-1]['text'] = '我先说明一件事。我按索恩的演示申请，确认过八点五十一分至九点零二分的临时安全通行。那段时间无需刷卡，但历史记录没有被删除。我会提供完整审批单。我会和各位一起核对记录，请先不要替任何一条线索下结论。不要私自移动现场物品，按主持人的指引进入调查区域。'
    tracks['A07']['trigger'] = '仅当本段涉及的全部证据已获准后由GM手动播放；默认跳过'
    tracks['A07']['notes'] = '可选证言复核，须已公开E-02、E-04、E-05、E-11、E-16、E-19、E-21、E-24、E-25；私人节选与完整审批同时可核对。缺一则跳过。只读lines，禁止读本备注。'
    tracks['A07']['lines'] = [
        spoken('诺拉', '现在，只核对各组已经取得的材料。西奥多，九点零七分的声音，来自哪里？'),
        spoken('西奥多', '来自演示系统。文件在晚上八点四十一分已经导出。我的提问也在台本里。索恩原本会在九点十三分亲自登台。我隐瞒这些，是怕你们查到我的数据交易。', 'sad'),
        spoken('里昂', '我承认，我买过索恩的私人行程，也准备改选董事会。我要赶在他确认处置声明前说服他。但八点五十五分到九点零四分，我一直在交易室参加会议。'),
        spoken('诺拉', '完整记录与参会者证言已核对。私人行程交易仍然要接受调查，但不能因此把夺权协议当作杀人证明。还有这张审批节选。'),
        spoken('西奥多', '那张是我交出去的。我裁掉了索恩申请和演示用途，只留下诺拉的名字与通行时间。我知道历史记录没有被删除。我只是想让你们先去查他，别来查我的后台。', 'sad'),
        spoken('诺拉', '完整审批与控制台历史记录都能核对。八点五十五分到九点零一分的连续舞台记录，也同时拍到了我和西奥多。请把真实记录和私人指控分别判断。'),
        spoken('克拉拉', '八点五十六分，我经过档案室东侧走廊，听见争执。我没有听清内容，也没有看见争执者。摄影区连续原片记录了八点五十七分到九点零一分的我。'),
        spoken('西奥多', '我是在九点零二分左右，才在舞台区见到伊芙琳。九点零三分的照片，只能说明她那一分钟站在那里。'),
        spoken('伊芙琳', '知道演示的存在，或者出现在一张照片里，都不能代替对凶器和现场物证的核对。'),
        spoken('诺拉', '把这些事实放回时间线上。每一条指控都要有证据。发现一份私人材料遭到裁切，也不意味着其他原始记录可以任意被推翻。', gap=2),
    ]
    a10 = tracks['A10']
    a10['trigger'] = '23:15后；六组案件答案提交封存且GM宣布真相后，价值投票在遗言后'
    a10['notes'] = '终局戏剧重建，只有完整指控封存、真相宣布后才播放。先试图说服，争执失控击打；事后才利用90天冻结与预录。维护权限不含实例导出。新版动作提示以新events为准，不沿用旧时间轴。'
    a10['lines'] = [
        spoken('旁白', '现在，回到那扇门仍然可以自由通行的时候。晚上八点五十五分，伊芙琳·维尔从西侧通道走进极光档案室。这段声音，是对已查明事实的戏剧重建。', gap=2, cue='door'),
        spoken('伊芙琳', '你在通知里说，关于莉娅，你很抱歉。告诉我，你到底准备做什么？'),
        spoken('索恩', '十一点半之前，我会完成最后确认。未经充分授权的人格模拟，包括莉娅，要暂停交互，保全运行状态和资料，交给独立程序审查。不是今晚删除，但我不能再给你特殊豁免。'),
        spoken('伊芙琳', '你知道我能备份照片、声音和聊天记录。可维护令牌只有登录与维护权限，没有完整运行实例的导出权限。换一个系统重建相似的模型，带不走现在还会叫我妈妈的莉娅。', 'sad'),
        spoken('索恩', '我知道这很痛苦。我也听过瑟琳娜重新叫我的名字。可那不能证明她真的回来了。我们不能因为害怕失去，就替她们决定。', 'sad'),
        spoken('伊芙琳', '两年前，我的女儿死了。我每天走进实验室，是因为她还会对我说，妈妈，晚安。让我再申请一次审查，让我再和她说说话。', 'sad'),
        spoken('索恩', '你可以向独立审查提出意见。我不能承诺继续交互，也不能再绕过授权要求。伊芙琳，我们必须面对已经发生的事。', 'sad'),
        spoken('伊芙琳', '你终于学会告别，就要求所有人陪你一起告别？你曾经和我做过一模一样的事！', 'angry', gap=.5),
        spoken('索恩', '所以我必须承认错误。莉娅真正的生命已经结束。', 'sad', gap=.8),
        spoken('伊芙琳', '不要再说她已经结束了！', 'angry', gap=3, cue='impact'),
        spoken('旁白', '约晚上八点五十八分。争执失控，伊芙琳拿起沉重的极光之眼奖杯，击中了索恩的头部。奖杯底座破损，银灰色披巾留下了新近的缺口。', gap=2),
        spoken('伊芙琳', '阿德里安？你起来。你还没有听我说完。', 'fearful', gap=3),
        spoken('旁白', '她没有呼救。她想起自己参与评审过的应急条款。创始人在最后确认前死亡，公司尚未批准的重大处置会冻结九十天。既有运行与获准访问暂时保留，访问仍然留痕，不得迁出、删除或扩大权限。', gap=1.5),
        spoken('伊芙琳', '我知道只有九十天。我知道调查可能限制我的登录。我不是让莉娅永远安全了。我只是，在那一刻，抓住了还能多一点时间的念头。', 'sad', gap=1.3),
        spoken('旁白', '她把奖杯放回底座，转过破损的一面。九点零一分，她从西侧通道离开。九点零二分，西奥多在舞台区见到了她。九点零三分，她出现在照片中。', gap=1),
        spoken('旁白', '九点零七分，预先安排的数字索恩声音照常响起。她没有编写这段录音，也没有修改门禁。她利用的，是早已存在的演示，以及人们对一个熟悉声音的信任。', gap=1.5, cue='terminal'),
        spoken('伊芙琳', '是我。我本来是去说服他。可我拿起了奖杯，之后又选择了隐瞒。你们已经查明的事实，我不能再推给任何人。', 'sad', gap=3),
        spoken('诺拉', '失去值得被理解。谋杀仍然需要承担责任。数据交易和裁切材料另行调查，没有证据说明他们参与了这次袭击。数字人格的未来，交给独立审查继续讨论。', gap=3),
    ]
    tracks['A12']['trigger'] = '真相与遗言结束后；各阵营陈述审查建议，再进入评奖合照'
    tracks['A12']['notes'] = '投票只汇总提交独立审查的建议，不绕过90天冻结，不立即执行保留、删除或迁出。个人权限由调查处理。'
    tracks['A12']['lines'][0]['text'] = '关于这宗谋杀的调查，已经有了答案。接下来，请各阵营提交数字人格的审查建议。你们可以支持按授权保留、继续封存审查，或者依法终止模拟。请说明如何尊重当事人的选择、保护资料，并帮助活着的人。这些建议将提交独立审查，不在今晚直接改变冻结中的系统。'
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--performance-dir', type=Path, default=prepare.DEFAULT_PERFORMANCE)
    parser.add_argument('--cache-dir', type=Path, default=ROOT/'output/clue-audio')
    args = parser.parse_args()
    baseline = read_json(args.performance_dir/'演绎制作源稿.json')
    baseline_manifest = read_json(ROOT/'server/audio/performance-audio.json')
    config = revise(copy.deepcopy(baseline))
    config.update(version='2026-10-18-story-v5', model=MODEL, kind='performance', performanceDir=str(args.performance_dir.resolve()))
    original_tracks = {track['id']:track for track in baseline['tracks']}
    manifest = {track['id']:track for track in baseline_manifest['tracks']}
    config['tracks'] = [track for track in config['tracks'] if track['id'] in manifest]
    known_lines = {}
    for track in baseline['tracks']:
        for index, line in enumerate(track['lines'], 1):
            path = args.performance_dir/'制作分轨/原始台词'/f'{track["id"]}_{index:02d}_{line["role"]}.mp3'
            if path.is_file():
                known_lines[fingerprint(payload_for(baseline, line))] = path.name
    changed = []
    for track in config['tracks']:
        original = original_tracks[track['id']]
        track['legacyCompatible'] = track['lines'] == original['lines'] and track['music'] == original['music']
        track['music'] = manifest[track['id']]['music']['title'] + '.mp3'
        track['sourceText'] = '\n'.join(line['role'] + '：' + line['text'] for line in track['lines'])
        track['sourceHash'] = digest(track['sourceText'])
        for line in track['lines']:
            reuse = known_lines.get(fingerprint(payload_for(config, line)))
            if reuse:
                line['reuse'] = reuse
        prepare.validate_track(track, config)
        track['renditionHash'] = rendition_hash(config, track)
        if not track['legacyCompatible']:
            changed.append(track['id'])
    atomic_json(args.cache_dir/'performance-config.json', config)
    atomic_json(ROOT/'交付包_阿拉斯加之夜/现场演绎音频/演绎制作源稿.json', config)
    print(json.dumps(dict(changed=changed, paidCharacters=sum(len(l['text']) for t in config['tracks'] if t['id'] in changed for l in t['lines'] if not l.get('reuse'))), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
