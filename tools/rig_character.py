"""캐릭터 시안 이미지(정면 T자세 컨셉아트)를 "인형(퍼핏) 부품"으로 잘라 게임에서 관절대로 움직이게 만드는 도구.

사용:  python tools/rig_character.py            (모든 캐릭터)   /   python tools/rig_character.py scout   (하나만)
결과:  assets/characters/<id>.png (부품을 모은 한 장짜리 이미지, 배경 투명)  +  <id>.json (관절 위치·부품 위치)
시안 원본은 tools/character_src/<id>.png (1024x1024, 단색 회색 배경)에 둬요.

원리: ① 배경(회색)을 가장자리에서부터 지워서 투명하게 ② 관절 위치(아래 JOINTS)로 만든 "뼈"마다 가장 가까운 화소를 그 부품에 배정
(뼈의 두께를 고려한 거리) ③ 이웃 부품과 경계에서 조금씩 겹치게 해서 움직일 때 틈이 안 보이게 ④ 부품을 아틀라스 한 장에 모아 저장.
numpy 없이 Pillow만 써요 (느려도 한 번만 돌리면 돼요).
"""
import json, math, os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "character_src")
OUT = os.path.join(ROOT, "assets", "characters")
SCALE = 0.75                    # 게임에서 쓰기 좋게 줄여 저장 (1024 -> 768)

# 관절 위치(원본 1024 기준). 이미지 왼쪽 = L (화면 왼쪽). head=머리 중심, neck=목 아래, foot=발 중심(발목 아래 신발 가운데), tip=손끝
JOINTS = {
    "fire": dict(head=(512, 140), neck=(512, 232), sh_l=(420, 282), sh_r=(604, 282), el_l=(345, 432), el_r=(679, 432), wr_l=(272, 515), wr_r=(752, 515),
                 tip_l=(216, 578), tip_r=(808, 578), hip_l=(462, 560), hip_r=(562, 560), kn_l=(440, 735), kn_r=(584, 735), an_l=(425, 880), an_r=(600, 880),
                 foot_l=(425, 935), foot_r=(605, 935)),
    "neon": dict(head=(512, 215), neck=(512, 285), sh_l=(447, 322), sh_r=(584, 322), el_l=(352, 440), el_r=(675, 440), wr_l=(300, 495), wr_r=(727, 495),
                 tip_l=(228, 582), tip_r=(798, 582), hip_l=(466, 520), hip_r=(562, 520), kn_l=(440, 735), kn_r=(582, 735), an_l=(425, 865), an_r=(590, 865),
                 foot_l=(412, 930), foot_r=(612, 930)),
    "scout": dict(head=(512, 200), neck=(512, 318), sh_l=(436, 376), sh_r=(594, 376), el_l=(368, 446), el_r=(662, 446), wr_l=(292, 512), wr_r=(738, 512),
                  tip_l=(220, 585), tip_r=(806, 585), hip_l=(462, 598), hip_r=(560, 598), kn_l=(448, 790), kn_r=(574, 790), an_l=(432, 872), an_r=(588, 872),
                  foot_l=(428, 932), foot_r=(606, 932)),
}
# 뼈(이름, [(시작, 끝), ...], 두께(반지름, 원본 픽셀)). 두께가 클수록 더 넓은 영역을 그 부품이 가져가요
def bones(j):
    mid = lambda a, b: ((j[a][0] + j[b][0]) / 2, (j[a][1] + j[b][1]) / 2)
    sh, hp = mid("sh_l", "sh_r"), mid("hip_l", "hip_r")
    return {
        "head": ([(j["neck"], j["head"])], 78),
        "torso": ([(sh, hp)], 120),
        "arm_l": ([(j["sh_l"], j["el_l"])], 52), "arm_r": ([(j["sh_r"], j["el_r"])], 52),
        "fore_l": ([(j["el_l"], j["wr_l"]), (j["wr_l"], j["tip_l"])], 50), "fore_r": ([(j["el_r"], j["wr_r"]), (j["wr_r"], j["tip_r"])], 50),
        "thigh_l": ([(j["hip_l"], j["kn_l"])], 66), "thigh_r": ([(j["hip_r"], j["kn_r"])], 66),
        "shin_l": ([(j["kn_l"], j["an_l"]), (j["an_l"], j["foot_l"])], 62), "shin_r": ([(j["kn_r"], j["an_r"]), (j["an_r"], j["foot_r"])], 62),
    }

def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def remove_background(im):
    """가장자리에서 시작해 배경색과 비슷한 화소를 모두 지워요 (캐릭터 윤곽선이 어두워서 안 번져요)."""
    rgb = im.convert("RGB"); marker = (255, 0, 255)
    for seed in [(0, 0), (rgb.width - 1, 0), (0, rgb.height - 1), (rgb.width - 1, rgb.height - 1), (rgb.width // 2, 0)]:
        if rgb.getpixel(seed) != marker: ImageDraw.floodfill(rgb, seed, marker, thresh=14)
    px = rgb.load(); mask = Image.new("L", rgb.size, 255); mp = mask.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            if px[x, y] == marker: mp[x, y] = 0
    # 캐릭터와 이어지지 않은 작은 점(배경 얼룩)은 지워요: 몸통 한가운데에서 이어진 부분만 남김
    lab = mask.copy(); ImageDraw.floodfill(lab, (rgb.width // 2, int(rgb.height * 0.41)), 128, thresh=0)
    lp = lab.load(); mp2 = mask.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            mp2[x, y] = 255 if lp[x, y] == 128 else 0
    # 테두리에 남은 회색 섞인 화소(배경과 비슷한 색)는 가장자리부터 안쪽으로 4칸까지 더 지워요 (밝은 점 테두리 방지)
    bg = (197, 197, 197); r, g, b = rgb.split()
    diff = ImageChops.lighter(ImageChops.lighter(ImageChops.difference(r, Image.new("L", rgb.size, bg[0])), ImageChops.difference(g, Image.new("L", rgb.size, bg[1]))), ImageChops.difference(b, Image.new("L", rgb.size, bg[2])))
    bgish = diff.point(lambda v: 255 if v < 40 else 0)
    removed = ImageChops.invert(mask)
    for _ in range(4):
        removed = ImageChops.lighter(removed, ImageChops.multiply(removed.filter(ImageFilter.MaxFilter(3)), bgish))
    mask = ImageChops.invert(removed)
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))   # 회색 테두리 없애고 부드럽게
    out = im.convert("RGBA"); out.putalpha(mask)
    return out

def rig(cid, debug=False):
    j = JOINTS[cid]; B = bones(j)
    src = Image.open(os.path.join(SRC, cid + ".png")); im = remove_background(src)
    W, H = im.size; px = im.load()
    names = list(B.keys()); masks = {n: Image.new("L", (W, H), 0) for n in names}; mp = {n: masks[n].load() for n in names}
    MARGIN = 0.16                                           # 이웃 부품과 겹치는 폭(두께 대비)
    for y in range(H):
        for x in range(W):
            a = px[x, y][3]
            if a < 20: continue
            ds = {n: min(seg_dist(x, y, s, e) for s, e in B[n][0]) / B[n][1] for n in names}
            best = min(ds, key=ds.get)
            for n in names:
                if n == best or ds[n] - ds[best] < MARGIN: mp[n][x, y] = a
    # 부품 잘라내기 → 아틀라스
    parts = {}; cuts = {}
    for n in names:
        bb = masks[n].getbbox()
        if not bb: raise SystemExit("빈 부품: " + n)
        layer = im.copy(); layer.putalpha(Image.eval(masks[n], lambda v: v))
        # 알파는 원본×마스크
        r, g, b, _ = im.split(); a = Image.composite(masks[n], Image.new("L", (W, H), 0), masks[n])
        layer = Image.merge("RGBA", (r, g, b, a)).crop(bb)
        layer = layer.resize((max(1, round(layer.width * SCALE)), max(1, round(layer.height * SCALE))), Image.LANCZOS)
        cuts[n] = (bb, layer)
    # 선반(shelf) 방식으로 아틀라스에 채우기
    order = sorted(names, key=lambda n: -cuts[n][1].height); AW = 1024; x = y = 2; rowh = 0; place = {}
    for n in order:
        lw, lh = cuts[n][1].size
        if x + lw + 2 > AW: x = 2; y += rowh + 2; rowh = 0
        place[n] = (x, y); x += lw + 2; rowh = max(rowh, lh)
    AH = y + rowh + 2
    atlas = Image.new("RGBA", (AW, AH), (0, 0, 0, 0))
    for n in names:
        atlas.paste(cuts[n][1], place[n])
        bb = cuts[n][0]
        parts[n] = dict(x=place[n][0], y=place[n][1], w=cuts[n][1].width, h=cuts[n][1].height, ox=round(bb[0] * SCALE, 2), oy=round(bb[1] * SCALE, 2))
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, cid + ".png"), optimize=True)
    sj = {k: [round(v[0] * SCALE, 2), round(v[1] * SCALE, 2)] for k, v in j.items()}
    json.dump(dict(id=cid, scale=SCALE, size=[round(W * SCALE), round(H * SCALE)], joints=sj, parts=parts), open(os.path.join(OUT, cid + ".json"), "w"), ensure_ascii=False)
    print(cid, "아틀라스", atlas.size, "부품", len(parts), "용량", os.path.getsize(os.path.join(OUT, cid + ".png")) // 1024, "KB")
    if debug:                                               # 부품별 색으로 칠한 확인용 그림 + 관절 표시
        pal = [(255, 80, 80), (80, 200, 255), (255, 220, 60), (120, 255, 120), (255, 120, 255), (255, 160, 60), (160, 160, 255), (80, 255, 200), (255, 100, 160), (200, 255, 80)]
        dbg = Image.new("RGB", (W, H), (40, 40, 60)); dp = dbg.load()
        for y in range(H):
            for x in range(W):
                if px[x, y][3] < 20: continue
                ds = {n: min(seg_dist(x, y, s, e) for s, e in B[n][0]) / B[n][1] for n in names}
                dp[x, y] = pal[names.index(min(ds, key=ds.get)) % len(pal)]
        d = ImageDraw.Draw(dbg)
        for k, v in j.items(): d.ellipse([v[0] - 5, v[1] - 5, v[0] + 5, v[1] + 5], outline=(255, 255, 255)); d.text((v[0] + 6, v[1] - 6), k, fill=(255, 255, 255))
        dbg.save(os.path.join(os.environ.get("RIG_DEBUG_DIR", "."), cid + "_debug.png"))

if __name__ == "__main__":
    ids = [a for a in sys.argv[1:] if not a.startswith("-")] or list(JOINTS.keys())
    for cid in ids: rig(cid, debug="--debug" in sys.argv)
