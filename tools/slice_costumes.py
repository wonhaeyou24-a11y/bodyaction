# 코스튬 스프라이트 시트 → 아이템별 투명 PNG 변환 도구
# 사용법: python tools/slice_costumes.py
#  - assets/costumes/_src/sheet_XX.jpg  : 3열×2행 시트 (배경 순자홍 #FF00FF)
#  - assets/costumes/_src/single_<id>.jpg : 단일 아이템 이미지
# 결과: assets/costumes/<id>.png (투명 배경, 가장자리 정리, 최대 512px)
# 새 시트를 만들면 아래 SHEETS 에 순서(좌→우, 위→아래)대로 아이템 ID만 추가하면 돼요.
import os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "costumes")
SRC = os.path.join(ROOT, "_src")
COLS, ROWS = 3, 2

SHEETS = {
    "sheet_01": ["head_crown", "head_poop", "head_chicken", "head_chef", "head_frog", "head_cat_neon"],
    "sheet_02": ["head_cowboy_cyber", "cap_cyber", "helm_visor", "head_phones", "head_guard", "head_foxmask"],
    "sheet_03": ["head_astro", "helm_cyber", "helm_miner", "head_tiara", "head_cap", "head_partyhat"],
    "sheet_04": ["face_mustache", "face_clown_nose", "face_thug_glasses", "body_nano", "body_rainbow_tee", "body_hawaiian"],
    "sheet_05": ["jersey_neon", "robe_master", "body_shinobi", "body_adventurer", "jersey_keeper", "body_belt"],
    "sheet_06": ["legs_boxer_shorts", "legs_disco_pants", "feet_slippers", "feet_duck_shoes", "hand_rubber_gloves", "hand_repulsor"],
    "sheet_07": ["hand_toy_hammer", "hand_drumstick", "bat_gold", "hand_sabers", "hand_katana", "hand_wand"],
    "sheet_08": ["gloves_tiger", "hand_firebox", "hand_shield", "hand_laserpaddle", "hand_goldenkeeper", "back_jetpack"],
    "sheet_09": ["back_angel", "back_pixel_wings", "back_cape", "back_wings", "back_propeller", "back_fairy"],
    "sheet_10": ["back_balloonbundle", "aura_fireworks", "aura_dragon", "shoes_neon", "aura_neonspark", "aura_starlight"],
}
# 단일 이미지가 있으면 시트보다 우선 (해상도가 더 높아서)
SINGLE_PREFIX = "single_"


def key_magenta(img):
    """순자홍 배경 제거 + 가장자리 자홍 번짐 제거(디스필). 반투명 가장자리는 부드럽게."""
    img = img.convert("RGB")
    w, h = img.size
    px = img.load()
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            m = min(r, b) - g                     # 자홍 정도 (배경은 아주 큼)
            if m > 150 and r > 170 and b > 170:   # 확실한 배경
                op[x, y] = (0, 0, 0, 0)
            elif m > 70 and r > 130 and b > 130:  # 가장자리(섞인 픽셀): 부드럽게 투명 + 자홍 제거
                a = max(0, min(255, int(255 * (150 - m) / 80)))
                nr, nb = min(r, g + 40), min(b, g + 40)
                op[x, y] = (nr, g, nb, a)
            else:
                op[x, y] = (r, g, b, 255)
    return out


def trim_and_save(cell, item_id):
    a = cell.split()[3].point(lambda v: 255 if v > 24 else 0)
    box = a.getbbox()
    if not box:
        print(f"  ! {item_id}: 비어 있음 (건너뜀)")
        return
    pad = 6
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(cell.width, box[2] + pad), min(cell.height, box[3] + pad))
    cell = cell.crop(box)
    s = 512 / max(cell.size)
    if s < 1:
        cell = cell.resize((max(1, int(cell.width * s)), max(1, int(cell.height * s))), Image.LANCZOS)
    cell.save(os.path.join(ROOT, f"{item_id}.png"), optimize=True)
    print(f"  OK {item_id}.png {cell.size}")


def main():
    done = set()
    # 1) 단일 이미지
    for fn in sorted(os.listdir(SRC)):
        if fn.startswith(SINGLE_PREFIX):
            item_id = os.path.splitext(fn)[0][len(SINGLE_PREFIX):]
            trim_and_save(key_magenta(Image.open(os.path.join(SRC, fn))), item_id)
            done.add(item_id)
    # 2) 시트
    for name, ids in SHEETS.items():
        path = next((os.path.join(SRC, name + e) for e in (".jpg", ".png", ".jpeg") if os.path.exists(os.path.join(SRC, name + e))), None)
        if not path:
            continue
        print(f"[{name}]")
        sheet = Image.open(path)
        W, H = sheet.size
        cw, ch = W // COLS, H // ROWS
        inset = 5  # 셀 경계의 희미한 선 제거
        for i, item_id in enumerate(ids):
            if item_id in done:
                continue
            c, r = i % COLS, i // COLS
            cell = sheet.crop((c * cw + inset, r * ch + inset, (c + 1) * cw - inset, (r + 1) * ch - inset))
            trim_and_save(key_magenta(cell), item_id)
    # 3) 목록 파일 (게임이 어떤 PNG가 있는지 알 수 있게)
    have = sorted(os.path.splitext(f)[0] for f in os.listdir(ROOT) if f.endswith(".png"))
    with open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8") as f:
        import json
        json.dump(have, f, ensure_ascii=False)
    print(f"done: {len(have)}개 PNG")


if __name__ == "__main__":
    sys.exit(main())
