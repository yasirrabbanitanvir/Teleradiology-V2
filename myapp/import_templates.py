import os
import sys
import re
import argparse

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.insert(0, PROJECT_ROOT)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dicom_project.settings')

import django
django.setup()

from myapp.models import ReportTemplate
from django.contrib.auth.models import User


INSERT_LINE_RE = re.compile(
    r"^\s*INSERT INTO\s+`?t_templates`?\s*\(([^)]*)\)\s*VALUES\s*\((.*)\)\s*;\s*$"
)

MYSQL_ESCAPES = {
    "0": "\x00", "'": "'", '"': '"', "b": "\b", "n": "\n",
    "r": "\r", "t": "\t", "Z": "\x1a", "\\": "\\", "%": "%", "_": "_",
}


def split_sql_values(values_str):
    fields = []
    i, n = 0, len(values_str)
    while i < n:
        while i < n and values_str[i] in " \t\r\n,":
            i += 1
        if i >= n:
            break
        if values_str[i] == "'":
            i += 1
            buf = []
            while i < n:
                c = values_str[i]
                if c == "\\" and i + 1 < n:
                    nxt = values_str[i + 1]
                    buf.append(MYSQL_ESCAPES.get(nxt, nxt))
                    i += 2
                    continue
                if c == "'":
                    if i + 1 < n and values_str[i + 1] == "'":
                        buf.append("'")
                        i += 2
                        continue
                    i += 1
                    break
                buf.append(c)
                i += 1
            fields.append("".join(buf))
        else:
            j = i
            while j < n and values_str[j] != ",":
                j += 1
            token = values_str[i:j].strip()
            fields.append(None if token.upper() == "NULL" else token)
            i = j
    return fields


def parse_sql_file(path):
    rows = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = INSERT_LINE_RE.match(line.strip())
            if not m:
                continue
            columns_str, values_str = m.group(1), m.group(2)
            columns = [c.strip().strip("`") for c in columns_str.split(",")]
            values = split_sql_values(values_str)
            if len(values) < len(columns):
                values += [None] * (len(columns) - len(values))
            rows.append(dict(zip(columns, values)))
    return rows


IGNORE_DESTINATIONS = {
    "fonttbl", "colortbl", "stylesheet", "generator", "info", "header",
    "footer", "headerf", "footerf", "pict", "object", "themedata",
    "colorschememapping", "latentstyles", "listtable", "listoverridetable",
    "fldinst", "operator", "company", "category", "manager", "doccomm",
    "keywords", "subject", "title", "template", "rsid", "xmlns",
}


def rtf_to_text(rtf):
    if not rtf:
        return ""
    i, n = 0, len(rtf)
    out = []
    uc_stack = [1]
    skip_stack = [False]

    while i < n:
        c = rtf[i]

        if c == "{":
            uc_stack.append(uc_stack[-1])
            skip_stack.append(skip_stack[-1])
            i += 1
            continue

        if c == "}":
            if len(uc_stack) > 1:
                uc_stack.pop()
                skip_stack.pop()
            i += 1
            continue

        if c == "\\":
            i += 1
            if i >= n:
                break
            ch = rtf[i]

            if ch in ("\\", "{", "}"):
                if not skip_stack[-1]:
                    out.append(ch)
                i += 1
                continue

            if ch == "'":
                hex_str = rtf[i + 1:i + 3]
                i += 3
                if not skip_stack[-1]:
                    try:
                        out.append(bytes([int(hex_str, 16)]).decode("cp1252", errors="ignore"))
                    except ValueError:
                        pass
                continue

            if ch.isalpha():
                j = i
                while j < n and rtf[j].isalpha():
                    j += 1
                word = rtf[i:j]
                k = j
                neg = False
                if k < n and rtf[k] == "-":
                    neg = True
                    k += 1
                num_start = k
                while k < n and rtf[k].isdigit():
                    k += 1
                param = int(rtf[num_start:k]) * (-1 if neg else 1) if k > num_start else None
                if k < n and rtf[k] == " ":
                    k += 1
                i = k

                if word in ("par", "line"):
                    if not skip_stack[-1]:
                        out.append("\n")
                elif word == "tab":
                    if not skip_stack[-1]:
                        out.append("\t")
                elif word == "uc" and param is not None:
                    uc_stack[-1] = param
                elif word == "u" and param is not None:
                    if not skip_stack[-1]:
                        cp = param + 65536 if param < 0 else param
                        try:
                            out.append(chr(cp))
                        except ValueError:
                            pass
                    skip_n = uc_stack[-1]
                    skipped = 0
                    while skipped < skip_n and i < n and rtf[i] != "\\":
                        i += 1
                        skipped += 1
                elif word in IGNORE_DESTINATIONS or word == "*":
                    skip_stack[-1] = True
                continue

            if not skip_stack[-1] and ch == "~":
                out.append(" ")
            i += 1
            continue

        if not skip_stack[-1]:
            out.append(c)
        i += 1

    text = "".join(out)
    text = text.encode("utf-8", "ignore").decode("utf-8", "ignore")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


BODY_PART_CT = "CT TEMPLATES"
BODY_PART_MRI = "MRI TEMPLATES"
BODY_PART_XRAY = "X-RAY TEMPLATES"

MODALITY_KEYWORDS = [
    (("MRI", "MR ", "M.R.I", "MAGNETIC RESONANCE"), BODY_PART_MRI, "MR"),
    (("CT ", "CT SCAN", "CT-", "(CT)", "NCCT", "CECT", "HRCT"), BODY_PART_CT, "CT"),
    (("MAMMOGRAM", "MAMMOGRAPHY", "MLO", "CC VIEW"), BODY_PART_XRAY, "MG"),
    (("BARIUM", "BARRIUM", "FLUOROSCOPY", "MCU", "RGU", "HSG", "SCREENING"), BODY_PART_XRAY, "RF"),
    (("OPG", "DENTAL", "PANORAMIC"), BODY_PART_XRAY, "PX"),
]


def guess_body_part_and_modality(name, plain_text):
    haystack = f"{name} {plain_text[:400]}".upper()
    for keywords, body_part, modality in MODALITY_KEYWORDS:
        for kw in keywords:
            pattern = r"(?<![A-Z0-9])" + re.escape(kw.strip()) + r"(?![A-Z0-9])"
            if re.search(pattern, haystack):
                return body_part, modality
    return BODY_PART_XRAY, "CR"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sql_files", nargs="+")
    parser.add_argument("--delete-existing", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--owner", default=None)
    args = parser.parse_args()

    owner = None
    if args.owner:
        owner = User.objects.get(username=args.owner)

    if args.delete_existing:
        count = ReportTemplate.objects.count()
        if args.dry_run:
            print(f"[dry-run] Would delete {count} existing template(s)")
        else:
            ReportTemplate.objects.all().delete()
            print(f"Deleted {count} existing template(s)")

    total = 0
    failed = 0
    for path in args.sql_files:
        rows = parse_sql_file(path)
        print(f"{path}: found {len(rows)} template row(s)")
        for row in rows:
            name = (row.get("name") or "").strip()
            rtf_content = row.get("content") or ""
            if not name or not rtf_content:
                continue
            plain_text = rtf_to_text(rtf_content)
            if not plain_text.strip():
                plain_text = "(No content extracted from original template - please edit)"
            body_part, modality = guess_body_part_and_modality(name, plain_text)
            if args.dry_run:
                print(f"  [dry-run] {body_part} / {modality} :: {name}")
                total += 1
                continue
            try:
                ReportTemplate.objects.create(
                    template_name=name,
                    content=plain_text,
                    body_part=body_part,
                    modality=modality,
                    is_active=True,
                    created_by=owner,
                )
                total += 1
            except Exception as e:
                failed += 1
                print(f"  FAILED :: {name} :: {e}")

    if args.dry_run:
        print(f"\n[dry-run] Would create {total} template(s). No changes made.")
    else:
        print(f"\nDone. Created {total} template(s). Failed: {failed}")


if __name__ == "__main__":
    main()
