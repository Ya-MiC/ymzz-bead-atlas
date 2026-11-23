import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PRESET_DIR = ROOT / "presets"
BRANDS_FILE = ROOT / "brands.json"


def rgb_to_hex(rgb):
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def hex_to_rgb(value):
    text = str(value).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    if len(text) != 6:
        raise ValueError("無效色值：" + str(value))
    try:
        return tuple(int(text[index:index + 2], 16) for index in (0, 2, 4))
    except ValueError as error:
        raise ValueError("無效色值：" + str(value)) from error


def srgb_to_lab(rgb):
    channels = []
    for channel in rgb:
        value = channel / 255.0
        channels.append(value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4)
    red, green, blue = channels
    x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047
    y = red * 0.2126729 + green * 0.7151522 + blue * 0.0721750
    z = (red * 0.0193339 + green * 0.1191920 + blue * 0.9503041) / 1.08883

    def pivot(value):
        return value ** (1 / 3) if value > 216 / 24389 else (24389 / 27 * value + 16) / 116

    fx, fy, fz = pivot(x), pivot(y), pivot(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e_2000(lab1, lab2):
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    avg_l = (l1 + l2) / 2
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    avg_c = (c1 + c2) / 2
    c7 = avg_c ** 7
    g = 0.5 * (1 - math.sqrt(c7 / (c7 + 25 ** 7))) if c7 else 0.5
    ap1 = (1 + g) * a1
    ap2 = (1 + g) * a2
    cp1 = math.hypot(ap1, b1)
    cp2 = math.hypot(ap2, b2)
    avg_cp = (cp1 + cp2) / 2
    hp1 = math.degrees(math.atan2(b1, ap1)) % 360 if cp1 else 0.0
    hp2 = math.degrees(math.atan2(b2, ap2)) % 360 if cp2 else 0.0
    delta_lp = l2 - l1
    delta_cp = cp2 - cp1
    if cp1 * cp2 == 0:
        delta_hp = 0.0
    else:
        delta_hp = hp2 - hp1
        if delta_hp > 180:
            delta_hp -= 360
        elif delta_hp < -180:
            delta_hp += 360
    delta_hp_prime = 2 * math.sqrt(cp1 * cp2) * math.sin(math.radians(delta_hp / 2))
    if cp1 * cp2 == 0:
        avg_hp = hp1 + hp2
    elif abs(hp1 - hp2) <= 180:
        avg_hp = (hp1 + hp2) / 2
    elif hp1 + hp2 < 360:
        avg_hp = (hp1 + hp2 + 360) / 2
    else:
        avg_hp = (hp1 + hp2 - 360) / 2
    t = (
        1
        - 0.17 * math.cos(math.radians(avg_hp - 30))
        + 0.24 * math.cos(math.radians(2 * avg_hp))
        + 0.32 * math.cos(math.radians(3 * avg_hp + 6))
        - 0.20 * math.cos(math.radians(4 * avg_hp - 63))
    )
    delta_theta = 30 * math.exp(-(((avg_hp - 275) / 25) ** 2))
    avg_cp7 = avg_cp ** 7
    rc = 2 * math.sqrt(avg_cp7 / (avg_cp7 + 25 ** 7)) if avg_cp7 else 0.0
    sl = 1 + 0.015 * (avg_l - 50) ** 2 / math.sqrt(20 + (avg_l - 50) ** 2)
    sc = 1 + 0.045 * avg_cp
    sh = 1 + 0.015 * avg_cp * t
    rt = -math.sin(math.radians(2 * delta_theta)) * rc
    return math.sqrt(
        (delta_lp / sl) ** 2
        + (delta_cp / sc) ** 2
        + (delta_hp_prime / sh) ** 2
        + rt * (delta_cp / sc) * (delta_hp_prime / sh)
    )


def load_brands():
    payload = json.loads(BRANDS_FILE.read_text(encoding="utf-8"))
    return payload, {brand["id"]: brand for brand in payload["brands"]}


def read_palette_csv(path):
    entries = []
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        for row in csv.reader(handle):
            if not row or row[0].startswith("#"):
                continue
            if len(row) < 5:
                raise ValueError("色卡資料列不完整：" + str(path))
            rgb = tuple(int(row[index]) for index in (2, 3, 4))
            if any(channel < 0 or channel > 255 for channel in rgb):
                raise ValueError("色卡 RGB 超出範圍：" + row[0])
            entries.append({"code": row[0].strip(), "name": row[1].strip(), "rgb": rgb, "origin": "official"})
    if not entries:
        raise ValueError("色卡為空：" + str(path))
    return entries


def apply_overrides(entries, overrides, extra_colors):
    result = []
    seen = set()
    for entry in entries:
        code = entry["code"]
        item = {
            "code": code,
            "name": entry["name"],
            "rgb": entry["rgb"],
            "origin": entry["origin"],
        }
        if code in overrides:
            item["rgb"] = overrides[code]["rgb"]
            item["origin"] = "user"
        result.append(item)
        seen.add(code)
    for code, value in extra_colors.items():
        name = value.get("name", code)
        item = {"code": code, "name": name, "rgb": value["rgb"], "origin": "user"}
        if code in seen:
            result = [item if entry["code"] == code else entry for entry in result]
        else:
            result.append(item)
            seen.add(code)
    return result


def parse_assignments(values, key_name):
    parsed = {}
    for raw in values or []:
        if "=" not in raw:
            raise ValueError(f"{key_name} 格式需為 代號=值：{raw}")
        code, value = raw.split("=", 1)
        code = code.strip()
        if "|" in value:
            hex_text, name = value.split("|", 1)
        else:
            hex_text, name = value, code
        parsed[code] = {"rgb": hex_to_rgb(hex_text), "name": name.strip()}
    return parsed


def preset_path(name):
    safe = "".join(char for char in name if char not in '\\/:*?"<>|').strip()
    if not safe:
        raise ValueError("預設名稱無效")
    return PRESET_DIR / (safe + ".json")


def list_presets():
    if not PRESET_DIR.is_dir():
        return []
    items = []
    for path in sorted(PRESET_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        items.append(
            {
                "file": path.name,
                "name": payload.get("name", path.stem),
                "brand": payload.get("brand", ""),
                "overrides": len(payload.get("overrides", {})),
                "extra_colors": len(payload.get("extra_colors", [])),
            }
        )
    return items


def load_preset(name):
    path = preset_path(name)
    if not path.is_file():
        raise ValueError("找不到預設：" + name)
    return json.loads(path.read_text(encoding="utf-8"))


def save_preset(name, brand, overrides, extra_colors):
    PRESET_DIR.mkdir(parents=True, exist_ok=True)
    path = preset_path(name)
    payload = {
        "name": name,
        "brand": brand,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "overrides": {code: rgb_to_hex(value["rgb"]) for code, value in overrides.items()},
        "extra_colors": [
            {"code": code, "name": value.get("name", code), "hex": rgb_to_hex(value["rgb"])}
            for code, value in extra_colors.items()
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def nearest(rgb, palette):
    source_lab = srgb_to_lab(rgb)
    best = None
    best_delta = None
    for entry in palette:
        delta = delta_e_2000(source_lab, srgb_to_lab(entry["rgb"]))
        if best_delta is None or delta < best_delta:
            best = entry
            best_delta = delta
    return best, best_delta


def choose_candidates(pixels, palette, max_colors):
    if max_colors <= 0 or max_colors >= len(palette):
        return palette
    counter = Counter()
    for pixel in pixels:
        if pixel is None:
            continue
        entry, _ = nearest(pixel["rgb"], palette)
        counter[entry["code"]] += 1
    selected = [code for code, _ in counter.most_common(max_colors)]
    lookup = {entry["code"]: entry for entry in palette}
    chosen = [lookup[code] for code in selected if code in lookup]
    if not chosen:
        return palette[:max_colors]
    return chosen


def contrasting_text(rgb):
    return "#111111" if rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 150 else "#FFFFFF"


def write_csv(path, fieldnames, rows):
    with Path(path).open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def save_preview(path, width, height, cells):
    image = Image.new("RGB", (width, height), "#FFFFFF")
    pixels = []
    for cell in cells:
        pixels.append(cell["entry"]["rgb"] if cell else (255, 255, 255))
    image.putdata(pixels)
    scale = max(1, min(32, 2048 // max(width, height)))
    image.resize((width * scale, height * scale), Image.Resampling.NEAREST).save(path)


def save_pattern_png(path, width, height, cells, brand_label):
    cell_size = max(16, min(42, 4096 // max(width, height)))
    margin, header = 56, 76
    image = Image.new("RGB", (margin * 2 + width * cell_size, header + margin + height * cell_size), "#F7F7F5")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=20)
    label_font = ImageFont.load_default(size=11)
    code_font = ImageFont.load_default(size=max(9, round(cell_size * 0.23)))
    draw.text((margin, 18), f"BEAD ATLAS | {width} x {height} | {brand_label}", fill="#202020", font=title_font)
    draw.text((margin, 46), "1 CELL = 1 BEAD | CODE = BRAND REFERENCE", fill="#666666", font=label_font)
    for index, cell in enumerate(cells):
        row, column = divmod(index, width)
        x0 = margin + column * cell_size
        y0 = header + row * cell_size
        fill = cell["entry"]["hex"] if cell else "#FAFAFA"
        draw.rectangle((x0, y0, x0 + cell_size, y0 + cell_size), fill=fill, outline="#B9B9B4", width=1)
        if cell:
            draw.text(
                (x0 + cell_size / 2, y0 + cell_size / 2),
                cell["entry"]["code"],
                fill=contrasting_text(cell["entry"]["rgb"]),
                font=code_font,
                anchor="mm",
            )
        else:
            draw.line((x0 + 4, y0 + 4, x0 + cell_size - 4, y0 + cell_size - 4), fill="#CCCCCC", width=1)
            draw.line((x0 + cell_size - 4, y0 + 4, x0 + 4, y0 + cell_size - 4), fill="#CCCCCC", width=1)
        if row == 0:
            draw.text((x0 + cell_size / 2, header - 12), str(column + 1), fill="#666666", font=label_font, anchor="mm")
        if column == 0:
            draw.text((margin - 20, y0 + cell_size / 2), str(row + 1), fill="#666666", font=label_font, anchor="mm")
    image.save(path)


def save_pattern_svg(path, width, height, cells, brand_label):
    cell_size, margin, header = 32, 56, 76
    canvas_width = margin * 2 + width * cell_size
    canvas_height = header + margin + height * cell_size
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{canvas_width}" height="{canvas_height}" viewBox="0 0 {canvas_width} {canvas_height}">',
        '<rect width="100%" height="100%" fill="#F7F7F5"/>',
        f'<text x="{margin}" y="30" font-family="Arial,sans-serif" font-size="20" fill="#202020">BEAD ATLAS | {width} x {height} | {brand_label}</text>',
        '<g shape-rendering="crispEdges">',
    ]
    for index, cell in enumerate(cells):
        row, column = divmod(index, width)
        x = margin + column * cell_size
        y = header + row * cell_size
        fill = cell["entry"]["hex"] if cell else "#FAFAFA"
        lines.append(f'<rect x="{x}" y="{y}" width="{cell_size}" height="{cell_size}" fill="{fill}" stroke="#B9B9B4"/>')
    lines.append('</g><g font-family="Arial,sans-serif" font-size="9" text-anchor="middle" dominant-baseline="middle">')
    for index, cell in enumerate(cells):
        if not cell:
            continue
        row, column = divmod(index, width)
        x = margin + column * cell_size
        y = header + row * cell_size
        fill = contrasting_text(cell["entry"]["rgb"])
        lines.append(f'<text x="{x + cell_size / 2}" y="{y + cell_size / 2}" fill="{fill}">{cell["entry"]["code"]}</text>')
    lines.append("</g></svg>")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def convert(args):
    source = Path(args.image).expanduser().resolve()
    if not source.is_file():
        raise ValueError("找不到圖片：" + str(source))
    output = Path(args.output).expanduser().resolve()
    if output.exists() and not output.is_dir():
        raise ValueError("輸出路徑不是資料夾：" + str(output))
    if output.exists() and any(output.iterdir()) and not args.overwrite:
        raise ValueError("輸出資料夾已有內容，請改用新資料夾或加上 --overwrite")
    output.mkdir(parents=True, exist_ok=True)
    if args.max_colors < 0:
        raise ValueError("max-colors 不可小於 0")
    if not 0.1 <= args.bead_mm <= 20:
        raise ValueError("bead-mm 必須在 0.1 與 20 之間")
    if min(args.board_width, args.board_height, args.pack_size) < 1:
        raise ValueError("底板尺寸與 pack-size 必須為正整數")
    if not 0 <= args.spare_percent <= 100:
        raise ValueError("spare-percent 必須在 0 與 100 之間")
    background = hex_to_rgb(args.background)

    payload, brands = load_brands()
    brand_id = args.brand
    preset_payload = None
    if args.preset:
        preset_payload = load_preset(args.preset)
        brand_id = preset_payload.get("brand", brand_id)
    if brand_id not in brands:
        raise ValueError("未知品牌：" + brand_id + "，可用：" + ", ".join(sorted(brands)))
    brand = brands[brand_id]

    overrides = parse_assignments(args.override, "override")
    extra_colors = parse_assignments(args.extra_color, "extra-color")
    if preset_payload:
        for code, value in (preset_payload.get("overrides") or {}).items():
            overrides[code] = {"rgb": hex_to_rgb(value), "name": code}
        for item in preset_payload.get("extra_colors") or []:
            extra_colors[item["code"]] = {"rgb": hex_to_rgb(item["hex"]), "name": item.get("name", item["code"])}

    if args.palette_file:
        entries = read_palette_csv(Path(args.palette_file).expanduser().resolve())
    else:
        entries = read_palette_csv(DATA_DIR / brand["file"])
    palette = apply_overrides(entries, overrides, extra_colors)

    with Image.open(source) as opened:
        source_format = opened.format or "UNKNOWN"
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    original_width, original_height = image.size
    if args.width and args.height:
        width, height = args.width, args.height
    elif args.width:
        width = args.width
        height = max(1, round(original_height * width / original_width))
    elif args.height:
        height = args.height
        width = max(1, round(original_width * height / original_height))
    else:
        width = 48
        height = max(1, round(original_height * width / original_width))
    if not 1 <= width <= 300 or not 1 <= height <= 300:
        raise ValueError("網格寬高必須各在 1 與 300 格之間")

    resized = image.resize((width, height), Image.Resampling.LANCZOS)
    pixels = []
    for red, green, blue, alpha in resized.get_flattened_data():
        if alpha < 128:
            pixels.append(None)
            continue
        if alpha < 255:
            red = round((red * alpha + background[0] * (255 - alpha)) / 255)
            green = round((green * alpha + background[1] * (255 - alpha)) / 255)
            blue = round((blue * alpha + background[2] * (255 - alpha)) / 255)
        pixels.append({"rgb": (red, green, blue)})
    if all(pixel is None for pixel in pixels):
        raise ValueError("圖片所有格都是透明，無法生成圖紙")

    candidates = choose_candidates(pixels, palette, args.max_colors)
    cache = {}
    cells = []
    for index, pixel in enumerate(pixels):
        row, column = divmod(index, width)
        if pixel is None:
            cells.append(None)
            continue
        key = pixel["rgb"]
        if key not in cache:
            cache[key] = nearest(pixel["rgb"], candidates)
        entry, delta = cache[key]
        cells.append(
            {
                "row": row + 1,
                "column": column + 1,
                "rgb": pixel["rgb"],
                "entry": {
                    "code": entry["code"],
                    "name": entry["name"],
                    "rgb": entry["rgb"],
                    "hex": rgb_to_hex(entry["rgb"]),
                    "origin": entry["origin"],
                },
                "delta": delta,
            }
        )

    counter = Counter(cell["entry"]["code"] for cell in cells if cell)
    lookup = {entry["code"]: entry for entry in palette}
    placed = sum(counter.values())
    blank = width * height - placed
    materials = []
    for code, count in sorted(counter.items(), key=lambda item: (-item[1], item[0])):
        entry = lookup[code]
        spare = math.ceil(count * args.spare_percent / 100)
        purchase = count + spare
        materials.append(
            {
                "brand": brand["name"],
                "brand_id": brand_id,
                "code": code,
                "name": entry["name"],
                "reference_hex": rgb_to_hex(entry["rgb"]),
                "origin": entry["origin"],
                "bead_count": count,
                "percent": round(count * 100 / placed, 4),
                "spare_beads": spare,
                "purchase_beads": purchase,
                "pack_size": args.pack_size,
                "packs_to_buy": math.ceil(purchase / args.pack_size),
            }
        )

    coordinate_rows = []
    for cell in cells:
        if cell is None:
            coordinate_rows.append(
                {
                    "row": (len(coordinate_rows) % width) + 1,
                    "column": (len(coordinate_rows) % width) + 1,
                    "source_hex": "",
                    "source_rgb": "",
                    "brand": brand["name"],
                    "code": "",
                    "reference_hex": "",
                    "delta_e00": "",
                }
            )
            continue
        coordinate_rows.append(
            {
                "row": cell["row"],
                "column": cell["column"],
                "source_hex": rgb_to_hex(cell["rgb"]),
                "source_rgb": ",".join(str(value) for value in cell["rgb"]),
                "brand": brand["name"],
                "code": cell["entry"]["code"],
                "reference_hex": cell["entry"]["hex"],
                "delta_e00": round(cell["delta"], 4),
            }
        )

    deltas = [cell["delta"] for cell in cells if cell]
    board_columns = math.ceil(width / args.board_width)
    board_rows = math.ceil(height / args.board_height)
    usage = {
        "schema_version": "1.0",
        "product": "YMZZ Bead Atlas · 晏銘湛箴_拼豆圖譜",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "brand": {
            "id": brand_id,
            "name": brand["name"],
            "display": brand["display"],
            "family": brand["family"],
            "default_bead_mm": brand["bead_mm"],
            "palette_file": brand["file"],
            "palette_colors_available": len(entries),
            "palette_colors_used": len(counter),
            "data_source": payload["data_source"],
            "data_commit": payload["data_commit"],
            "data_license": payload["data_license"],
        },
        "user_edits": {
            "preset": args.preset or "",
            "overrides": {code: rgb_to_hex(value["rgb"]) for code, value in overrides.items()},
            "extra_colors": {code: rgb_to_hex(value["rgb"]) for code, value in extra_colors.items()},
            "custom_palette_file": str(Path(args.palette_file).expanduser().resolve()) if args.palette_file else "",
        },
        "source": {
            "file_name": source.name,
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "format": source_format,
            "width_px": original_width,
            "height_px": original_height,
        },
        "settings": {
            "grid_width": width,
            "grid_height": height,
            "max_colors": args.max_colors,
            "bead_mm": args.bead_mm,
            "background": rgb_to_hex(background),
            "alpha_threshold": 128,
            "pack_size_per_color": args.pack_size,
            "spare_percent": args.spare_percent,
        },
        "local_usage": {
            "conversion_count": 1,
            "grid_cells": width * height,
            "placed_beads": placed,
            "blank_cells": blank,
            "used_colors": len(counter),
            "estimated_width_cm": round(width * args.bead_mm / 10, 3),
            "estimated_height_cm": round(height * args.bead_mm / 10, 3),
            "board_columns": board_columns,
            "board_rows": board_rows,
            "estimated_boards": board_columns * board_rows,
            "purchase_beads_including_spare": sum(row["purchase_beads"] for row in materials),
            "estimated_packs": sum(row["packs_to_buy"] for row in materials),
        },
        "match_quality": {
            "metric": "CIEDE2000",
            "mean_delta_e00": round(sum(deltas) / len(deltas), 4),
            "max_delta_e00": round(max(deltas), 4),
            "cells_delta_e00_over_10": sum(delta > 10 for delta in deltas),
        },
        "materials": materials,
    }

    write_csv(
        output / "materials.csv",
        ["brand", "brand_id", "code", "name", "reference_hex", "origin", "bead_count", "percent", "spare_beads", "purchase_beads", "pack_size", "packs_to_buy"],
        materials,
    )
    write_csv(
        output / "coordinates.csv",
        ["row", "column", "source_hex", "source_rgb", "brand", "code", "reference_hex", "delta_e00"],
        coordinate_rows,
    )
    (output / "usage.json").write_text(json.dumps(usage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    save_preview(output / "preview.png", width, height, cells)
    save_pattern_png(output / "pattern.png", width, height, cells, brand["name"])
    save_pattern_svg(output / "pattern.svg", width, height, cells, brand["name"])

    report = [
        "# Bead Atlas｜拼豆圖譜 製作報告",
        "",
        "## 1. 轉換摘要",
        "",
        f"1. 色卡品牌：{brand['display']}（{brand['name']}，資料來源 {payload['data_source']}，授權 {payload['data_license']}）。",
        f"2. 來源圖片：{source.name}（{original_width} × {original_height} px）。",
        f"3. 拼豆網格：{width} × {height} 格，一格一顆。",
        f"4. 實際用豆：{placed} 顆；透明留空：{blank} 格；使用色號：{len(counter)} 色。",
        f"5. 預估成品：{width * args.bead_mm / 10:.2f} × {height * args.bead_mm / 10:.2f} cm（豆徑 {args.bead_mm} mm）。",
        f"6. 底板估算：{board_columns} 欄 × {board_rows} 列，共 {board_columns * board_rows} 塊 {args.board_width} × {args.board_height} 格底板。",
        f"7. 含 {args.spare_percent}% 備損的採購估算：{sum(row['purchase_beads'] for row in materials)} 顆、{sum(row['packs_to_buy'] for row in materials)} 包。",
        f"8. 套用的自訂預設：{args.preset or '無'}；自訂色值覆寫 {len(overrides)} 個；自訂新增色 {len(extra_colors)} 個。",
        "",
        "## 2. 材料清單",
        "",
        "| 品牌 | 色號 | 名稱 | 參考 HEX | 來源 | 顆數 | 備損 | 採購顆數 | 估算包數 |",
        "|---|---|---|---|---|---:|---:|---:|---:|",
    ]
    for row in materials:
        report.append(
            f"| {row['brand']} | {row['code']} | {row['name']} | {row['reference_hex']} | {row['origin']} | {row['bead_count']} | {row['spare_beads']} | {row['purchase_beads']} | {row['packs_to_buy']} |"
        )
    report.extend(
        [
            "",
            "## 3. 核色與使用",
            "",
            "1. 圖紙由左上角第 1 列第 1 格開始，格內代號即對應品牌的色號。",
            "2. 參考 HEX 是螢幕取樣值，實際批次、材質與光線都會有色差，批量購買前請用實體色卡核對。",
            "3. 「來源」欄標示 user 的色號代表套用了你自己的色值覆寫或新增，請以你的實體色卡為準。",
            "4. 檔案由本機產生，沒有上傳原圖，也沒有任何扣費行為。",
            "",
        ]
    )
    (output / "report.md").write_text("\n".join(report), encoding="utf-8")
    return usage


def build_parser():
    parser = argparse.ArgumentParser(description="多品牌拼豆圖譜：圖片轉可製作圖紙、色號對應與用量統計")
    parser.add_argument("image", nargs="?", help="本機圖片路徑")
    parser.add_argument("--output", help="輸出資料夾")
    parser.add_argument("--brand", default="mard", help="色卡品牌 id，預設 mard")
    parser.add_argument("--preset", default="", help="套用自訂色群預設名稱")
    parser.add_argument("--override", action="append", default=[], help="覆寫色值 代號=#HEX，可重複")
    parser.add_argument("--extra-color", action="append", default=[], help="新增自訂色 代號=#HEX|名稱，可重複")
    parser.add_argument("--palette-file", default="", help="自訂色卡 CSV 路徑，欄位為 代號,名稱,R,G,B")
    parser.add_argument("--width", type=int, default=0, help="網格寬度，預設 48")
    parser.add_argument("--height", type=int, default=0, help="網格高度，預設依比例")
    parser.add_argument("--max-colors", type=int, default=32, help="最多使用色數，0 為不限")
    parser.add_argument("--bead-mm", type=float, default=0, help="豆徑毫米，預設依品牌")
    parser.add_argument("--background", default="#FFFFFF", help="半透明像素合成背景")
    parser.add_argument("--board-width", type=int, default=29, help="底板寬格數")
    parser.add_argument("--board-height", type=int, default=29, help="底板高格數")
    parser.add_argument("--pack-size", type=int, default=1000, help="每色每包顆數")
    parser.add_argument("--spare-percent", type=float, default=10.0, help="備損百分比")
    parser.add_argument("--save-preset", default="", help="把目前品牌與自訂色存成預設名稱")
    parser.add_argument("--list-brands", action="store_true", help="列出所有品牌色卡")
    parser.add_argument("--list-presets", action="store_true", help="列出所有自訂色群預設")
    parser.add_argument("--overwrite", action="store_true", help="允許覆蓋同名輸出檔")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.list_brands:
        payload, brands = load_brands()
        rows = []
        for brand in payload["brands"]:
            count = len(read_palette_csv(DATA_DIR / brand["file"]))
            rows.append(
                f"{brand['id']}\t{brand['display']}\t{brand['family']}\t{count} 色\t{brand['bead_mm']} mm"
            )
        print("\n".join(rows))
        return 0
    if args.list_presets:
        items = list_presets()
        if not items:
            print("尚無自訂色群預設")
            return 0
        for item in items:
            print(f"{item['name']}\t{item['brand']}\t覆寫 {item['overrides']}\t新增 {item['extra_colors']}\t{item['file']}")
        return 0
    if args.save_preset:
        _, brands = load_brands()
        if args.brand not in brands:
            raise ValueError("未知品牌：" + args.brand)
        overrides = parse_assignments(args.override, "override")
        extra_colors = parse_assignments(args.extra_color, "extra-color")
        path = save_preset(args.save_preset, args.brand, overrides, extra_colors)
        print(json.dumps({"status": "saved", "path": str(path)}, ensure_ascii=False))
        return 0
    if not args.image or not args.output:
        print("錯誤：需要圖片路徑與 --output，或使用 --list-brands / --list-presets", file=sys.stderr)
        return 2
    if args.bead_mm <= 0:
        _, brands = load_brands()
        brand_id = args.brand
        if args.preset:
            preset_payload = load_preset(args.preset)
            brand_id = preset_payload.get("brand", brand_id)
        args.bead_mm = brands[brand_id]["bead_mm"] if brand_id in brands else 5.0
    try:
        usage = convert(args)
    except (ValueError, OSError, Image.UnidentifiedImageError) as error:
        print("錯誤：" + str(error), file=sys.stderr)
        return 2
    local = usage["local_usage"]
    print(
        json.dumps(
            {
                "status": "ok",
                "output": str(Path(args.output).expanduser().resolve()),
                "brand": usage["brand"]["display"],
                "grid": f"{local['grid_cells'] and usage['settings']['grid_width']}x{usage['settings']['grid_height']}",
                "placed_beads": local["placed_beads"],
                "blank_cells": local["blank_cells"],
                "used_colors": local["used_colors"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
