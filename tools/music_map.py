# 곡 분석: 곡 파일에서 "박자 위치(소리가 터지는 순간)"와 그때의 특징을 뽑아 assets/music/<id>.beats.json 으로 저장해요.
# 특징(큐브 배치를 곡에 맞추는 데 써요):  s = 소리 세기(0~1, 강한 박자일수록 1)   p = 높낮이(0 낮은 소리 ~ 1 높은 소리, 곡 안에서의 순위)   e = 구간 에너지(0 잔잔 ~ 1 클라이막스)
# 실행:  python tools/music_map.py            (모든 곡)    python tools/music_map.py polka canon   (일부만)
# 필요한 것: ffmpeg (곡을 8kHz 모노로 풀어 읽어요). numpy 없이 표준 파이썬만 써요.
import array, json, math, os, subprocess, sys, tempfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
music = os.path.join(root, "assets", "music")
IDS = ["radetzky", "virus", "turkish", "saints", "canon", "polka", "funkorama", "carefree", "runamok", "monkeys"]
SR = 8000; HOP = 40; FPS = SR / HOP          # 5ms 칸


def decode(path):
    raw = os.path.join(tempfile.gettempdir(), "kk_" + os.path.basename(path) + ".raw")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", raw], check=True)
    a = array.array("h"); a.frombytes(open(raw, "rb").read()); os.remove(raw)
    return a


def onsets(a):
    """소리가 터지는 순간 찾기: 20ms 창 소리 크기 + 고음 변화량의 갑작스러운 증가를 지역 평균과 비교"""
    w = 160
    def rms(x, i): return math.sqrt(sum(v * v for v in x[i:i + w]) / w)
    d = array.array("h", [0]) + array.array("h", [max(-32768, min(32767, a[i] - a[i - 1])) for i in range(1, len(a))])
    env = [math.log(1 + rms(a, i)) for i in range(0, len(a) - w, HOP)]
    envh = [math.log(1 + rms(d, i)) for i in range(0, len(d) - w, HOP)]
    n = len(env)
    def flux(e, lag=8): return [max(0, e[i] - min(e[max(0, i - lag):i + 1])) if i > 0 else 0 for i in range(len(e))]
    f1, f2 = flux(env), flux(envh)
    on = [f1[i] + f2[i] for i in range(n)]
    W = int(0.5 * FPS); peaks = []
    for i in range(2, n - 2):
        if on[i] >= on[i - 1] and on[i] > on[i + 1] and on[i] > on[i - 2] and on[i] >= on[i + 2]:
            lo, hi = max(0, i - W), min(n, i + W); m = sum(on[lo:hi]) / (hi - lo)
            if on[i] > m * 1.4: peaks.append((i / FPS - 0.02, on[i] / (m + 1e-9)))
    return [(t, s) for t, s in peaks if t > 0.3]


def pick(peaks, gap, seed=()):
    chosen = list(seed)
    for t, s in sorted(peaks, key=lambda p: -p[1]):
        if all(abs(t - c) >= gap for c in chosen): chosen.append(t)
    return sorted(chosen)


def bands(a):
    """10ms마다 저음/중음/고음 에너지 (간단한 한 극 필터)"""
    a1 = 1 - math.exp(-2 * math.pi * 300 / SR); a2 = 1 - math.exp(-2 * math.pi * 2000 / SR)
    l1 = l2 = 0.0; lo = []; mi = []; hi = []
    fr = 80; el = em = eh = 0.0; k = 0
    for x in a:
        l1 += a1 * (x - l1); l2 += a2 * (x - l2)
        low = l1; mid = l2 - l1; high = x - l2
        el += low * low; em += mid * mid; eh += high * high; k += 1
        if k == fr: lo.append(el); mi.append(em); hi.append(eh); el = em = eh = 0.0; k = 0
    return lo, mi, hi


def rank01(vals):
    order = sorted(range(len(vals)), key=lambda i: vals[i]); out = [0.0] * len(vals)
    for r, i in enumerate(order): out[i] = r / max(1, len(vals) - 1)
    return out


def features(times, strength_of, lo, mi, hi, a):
    fr = SR / 80                                     # 10ms 칸
    n = len(lo)
    # 구간 에너지: ±3초 이동 평균 (소리 크기)
    tot = [lo[i] + mi[i] + hi[i] for i in range(n)]
    pre = [0.0]
    for v in tot: pre.append(pre[-1] + v)
    def avg(t0, t1):
        i0, i1 = max(0, int(t0 * 100)), min(n, int(t1 * 100)); return (pre[i1] - pre[i0]) / max(1, i1 - i0)
    raw_p, raw_e, raw_s = [], [], []
    for t in times:
        i = int(t * 100); i1 = min(n, i + 8)
        l, m, h = sum(lo[i:i1]), sum(mi[i:i1]), sum(hi[i:i1]); tt = l + m + h + 1e-9
        raw_p.append((h + 0.5 * m) / tt)             # 높은 소리 비중
        raw_e.append(avg(t - 3, t + 3))
        raw_s.append(strength_of(t))
    return rank01(raw_s), rank01(raw_p), rank01(raw_e)


def build(song):
    path = os.path.join(music, song + ".mp3")
    a = decode(path)
    peaks = onsets(a)
    notes = pick(peaks, 0.46)
    dense = pick(peaks, 0.27, notes)
    lo, mi, hi = bands(a)
    strength = {round(t, 3): s for t, s in peaks}
    def strength_of(t):
        best = min(peaks, key=lambda p: abs(p[0] - t)); return best[1]
    out = {"v": 2, "notes": [round(t, 3) for t in notes], "dense": [round(t, 3) for t in dense]}
    for key, ts in (("notes", notes), ("dense", dense)):
        s, p, e = features(ts, strength_of, lo, mi, hi, a)
        out["f_" + key] = [[round(s[i], 2), round(p[i], 2), round(e[i], 2)] for i in range(len(ts))]
    json.dump(out, open(os.path.join(music, song + ".beats.json"), "w"), separators=(",", ":"))
    print(song, "notes", len(notes), "dense", len(dense), "→", os.path.getsize(os.path.join(music, song + ".beats.json")) // 1024, "KB")


if __name__ == "__main__":
    for s in (sys.argv[1:] or IDS): build(s)
