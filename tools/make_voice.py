# 안내 음성을 미리 만들어 둬요 (무료 Edge 신경망 음성 SunHi). 실행: python tools/make_voice.py
# main.js 의 speak("고정 문장")과 INTRO 문장을 찾아 assets/voice/*.mp3 와 index.json 으로 저장해요. 파일이 없는 문장은 브라우저 음성으로 말해요.
import re, json, os, asyncio, hashlib, edge_tts
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'main.js'), encoding='utf-8').read()
texts = set(re.findall(r'speak\("([^"$`\\]+)"', src))
m = re.search(r'const INTRO = \{(.*?)\n\};', src, re.S)
if m: texts |= set(re.findall(r':\s*"([^"]+)"', m.group(1)))
# --- 이름·숫자가 들어가는 말도 조각으로 미리 만들어 둬요 ---
import subprocess, json as _j
def josa(word, has, no):
    c = ord(word.strip()[-1]); b = (c - 0xac00) % 28 != 0 if 0xac00 <= c <= 0xd7a3 else word.strip()[-1] in '013678'
    return word + (has if b else no)
# main.js 의 speak 줄에 있는 모든 고정 문장(삼항식 안의 문장 포함)
for line in src.splitlines():
    if 'speak(' in line and 'function speak' not in line:
        for t in re.findall(r'"([^"$`\\]*[가-힣][^"$`\\]*)"', line):
            if len(t) > 2 and not t.startswith(('assets', 'speak')): texts.add(t)
# 자세 이름, 레벨 안내, 틀린 곳 안내
names = _j.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import('./poses.js').then(m=>console.log(JSON.stringify(m.POSES.map(p=>p.name))))"], cwd=root))
texts |= set(names)
texts |= {f"레벨 {n}!" for n in range(1, 6)}
limbs = ["왼팔을", "왼쪽 아래팔을", "오른팔을", "오른쪽 아래팔을", "왼쪽 허벅지를", "왼쪽 종아리를", "오른쪽 허벅지를", "오른쪽 종아리를"]
dirs = ["위로 올려요", "아래로 내려요", "왼쪽으로 뻗어요", "오른쪽으로 뻗어요"]
texts |= {f"{l} {d}" for l in limbs for d in dirs}
texts |= {"발끝까지 보이게 한두 걸음 뒤로 가 주세요", "팔이 잘 보이게 서 주세요", "무릎을 더 굽혀서 앉아요", "왼쪽 무릎을 더 높이 올려요", "오른쪽 무릎을 더 높이 올려요"}
# 샌드백 타격 수, 등수, 등급
texts |= {f"{n} 타격 달성! 불타오르는 콤보 러시!" for n in range(20, 401, 20)}
texts |= {f"{n}등!" for n in range(2, 11)}
texts |= {f"{r} 등급 클리어!" for r in ["C", "B", "A", "S", "S+", "SSS"]}
# 커스튬 이름이 들어가는 말 (조사는 받침에 맞게)
for nm, tier in re.findall(r'name: "([^"]+)", slot: "\w+", tier: "(\w+)"', src):
    if tier != 'common':
        texts.add(f"등수가 밀려 {josa(nm, '을', '를')} 뺏겼습니다! 다시 순위를 탈환하세요!")
        texts.add(f"1등 보상으로 {josa(nm, '을', '를')} 획득하셨습니다! 축하합니다!")
out = os.path.join(root, 'assets', 'voice'); os.makedirs(out, exist_ok=True)
idx = {}
async def one(t):
    h = hashlib.md5(t.encode('utf-8')).hexdigest()[:10]
    f = os.path.join(out, h + '.mp3')
    if not os.path.exists(f):
        await edge_tts.Communicate(t, 'ko-KR-SunHiNeural', rate='+0%', pitch='+0Hz').save(f)
    idx[t] = h + '.mp3'
async def main():
    for t in sorted(texts): await one(t)
asyncio.run(main())
json.dump(idx, open(os.path.join(out, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(idx), 'clips', sum(os.path.getsize(os.path.join(out, v)) for v in idx.values()) // 1024, 'KB')
