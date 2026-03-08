import re
import subprocess
import sys
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

JS_TIMESTAMP_LINE = re.compile(r"^//\s*⟦\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2}⟧\s*$")
METADATA_DATE_LINE = re.compile(r"^#!date=.*$")
BRACKET_TIMESTAMP_TOKEN = re.compile(r"⟦\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2}⟧")


def detect_newline(content: str) -> str:
    if "\r\n" in content:
        return "\r\n"
    return "\n"


def git_last_modified(filename: str) -> Optional[str]:
    cmd = [
        "git",
        "log",
        "-1",
        "--format=%ad",
        "--date=format:%Y-%m-%d %H:%M:%S",
        "--",
        filename,
    ]
    try:
        output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return output or None


def file_last_modified(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")


def get_timestamp(path: Path) -> Tuple[str, str]:
    git_timestamp = git_last_modified(str(path))
    if git_timestamp:
        return git_timestamp, "git"
    return file_last_modified(path), "mtime"


def align_mtime(path: Path, timestamp: str) -> None:
    try:
        dt = datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
        ts = dt.timestamp()
        os.utime(path, (ts, ts))
    except Exception:
        # 对齐 mtime 失败不影响主流程
        pass


def update_metadata_js(lines: list[str], timestamp: str, newline: str) -> list[str]:
    timestamp_line = f"#!date={timestamp}{newline}"
    lines_without_date = [
        line for line in lines if not METADATA_DATE_LINE.match(line.rstrip("\r\n"))
    ]
    return [timestamp_line, *lines_without_date]


def update_regular_js(lines: list[str], timestamp: str, newline: str) -> list[str]:
    timestamp_line = f"// ⟦{timestamp}⟧{newline}"
    timestamp_token = f"⟦{timestamp}⟧"
    offset = 1 if (lines and lines[0].startswith("#!/")) else 0

    # `resource-parser.js` 这类块注释头里自带时间戳时，优先覆盖注释内时间戳。
    # 如果之前插入了 `// ⟦...⟧` 首行，会一并移除，避免双时间戳。
    if (
        len(lines) > offset + 1
        and JS_TIMESTAMP_LINE.match(lines[offset].rstrip("\r\n"))
        and lines[offset + 1].lstrip().startswith("/**")
    ):
        lines = lines[:offset] + lines[offset + 1 :]

    if len(lines) > offset and lines[offset].lstrip().startswith("/**"):
        scan_end = min(len(lines), offset + 20)
        for i in range(offset, scan_end):
            raw = lines[i].rstrip("\r\n")
            if BRACKET_TIMESTAMP_TOKEN.search(raw):
                replaced = BRACKET_TIMESTAMP_TOKEN.sub(timestamp_token, raw, count=1)
                lines[i] = replaced + newline
                return lines
            if "*/" in raw:
                break

    # 普通 JS：保留/更新单行注释时间戳。
    if len(lines) > offset and JS_TIMESTAMP_LINE.match(lines[offset].rstrip("\r\n")):
        lines[offset] = timestamp_line
        return lines

    if offset == 1:
        return [lines[0], timestamp_line, *lines[1:]]
    return [timestamp_line, *lines]


def update_file(filename: str) -> None:
    path = Path(filename)
    if path.suffix.lower() != ".js":
        return
    if not path.exists():
        print(f"Skip missing file: {filename}")
        return

    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        print(f"Skip non-utf8 file: {filename}")
        return
    except Exception as exc:
        print(f"Error reading {filename}: {exc}")
        return

    newline = detect_newline(content)
    lines = content.splitlines(keepends=True)
    timestamp, source = get_timestamp(path)

    if lines and lines[0].startswith("#!") and not lines[0].startswith("#!/"):
        new_lines = update_metadata_js(lines, timestamp, newline)
    else:
        new_lines = update_regular_js(lines, timestamp, newline)

    new_content = "".join(new_lines)
    if new_content == content:
        return

    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as exc:
        print(f"Error writing {filename}: {exc}")
        return

    if source == "mtime":
        align_mtime(path, timestamp)

    print(f"Updated timestamp: {filename} -> {timestamp}")


if __name__ == "__main__":
    for file in sys.argv[1:]:
        update_file(file)
