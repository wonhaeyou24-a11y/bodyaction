# 안내 음성을 미리 만들어 둬요 (무료 Edge 신경망 음성 SunHi). 실행: python tools/make_voice.py
# main.js 의 speak("고정 문장")과 INTRO 문장을 찾아 assets/voice/*.mp3 와 index.json 으로 저장해요. 파일이 없는 문장은 브라우저 음성으로 말해요.
import re, json, os, asyncio, hashlib, edge_tts
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'main.js'), encoding='utf-8').read()
texts = set(re.findall(r'speak\("([^"$`\\]+)"', src))
m = re.search(r'const INTRO = \{(.*?)\n\};', src, re.S)
if m: texts |= set(re.findall(r':\s*"([^"]+)"', m.group(1)))
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
