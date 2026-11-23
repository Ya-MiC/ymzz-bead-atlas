import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT
INCLUDED = [
    "SKILL.md",
    "LICENSE",
    "NOTICE.md",
    "requirements.txt",
    "scripts/convert.py",
    "scripts/brands.json",
    "scripts/presets/default-1.json",
    "scripts/presets/default-2.json",
    "docs/product.md",
    "docs/evidence.md",
    "docs/rea-analysis-summary.json",
]
DATA_DIR = ROOT / "scripts" / "data"


def included_files():
    files = list(INCLUDED)
    for path in sorted(DATA_DIR.glob("*.csv")):
        files.append(f"scripts/data/{path.name}")
    return files


def validate():
    skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", skill, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md 缺少 YAML front matter")
    frontmatter = match.group(1)
    name = re.search(r"^name:\s*([a-z0-9-]+)\s*$", frontmatter, re.MULTILINE)
    description = re.search(r'^description:\s*"(.*)"\s*$', frontmatter, re.MULTILINE)
    if not name or name.group(1) != "ymzz-bead-atlas":
        raise ValueError("Skill name 必須為 ymzz-bead-atlas")
    if not description or not 1 <= len(description.group(1)) <= 1024:
        raise ValueError("Skill description 缺失或超過 1024 字元")
    if "<" in description.group(1) or ">" in description.group(1):
        raise ValueError("Skill description 不可含角括號")
    registry = json.loads((SKILL_DIR / "scripts" / "brands.json").read_text(encoding="utf-8"))
    if len(registry["brands"]) != 15:
        raise ValueError("品牌數量不符")
    for relative in included_files():
        path = SKILL_DIR / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError("缺少商品包檔案：" + relative)
        data = path.read_bytes()
        for marker in (b"BEGIN PRIVATE KEY", b"BEGIN RSA PRIVATE KEY", b"appPrivateKey"):
            if marker in data:
                raise ValueError("商品包疑似含密鑰：" + relative)


def content_sha256(files):
    digest = hashlib.sha256()
    for relative in sorted(files):
        digest.update(relative.encode("utf-8"))
        digest.update(hashlib.sha256((SKILL_DIR / relative).read_bytes()).digest())
    return digest.hexdigest()


def package(output):
    validate()
    files = included_files()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in files:
            archive.write(SKILL_DIR / relative, arcname=relative)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC 完整性檢查失敗")
        if archive.namelist()[0] != "SKILL.md":
            raise ValueError("ZIP 根目錄必須是 SKILL.md")
    return {
        "zip": str(output),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "content_sha256": content_sha256(files),
        "bytes": output.stat().st_size,
        "files": len(files),
        "brands": 15,
        "colors": 2093,
        "status": "ready_for_upload_not_platform_approved",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "ymzz-bead-atlas.zip")
    args = parser.parse_args()
    print(json.dumps(package(args.output.resolve()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
