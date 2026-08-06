import re
from striprtf.striprtf import rtf_to_text
from django.contrib.auth.models import User
from myapp.models import ReportTemplate

SQL_FILE = r"D:\pacs\telesoftweb\template_drrizwana.sql"
USERNAME = "drrizwana"


def get_name(line):
    m = re.search(r"VALUES \('([^']*)'", line)
    return m.group(1).strip() if m else None


def get_content(line):
    start = line.index("VALUES ('") + len("VALUES ('")
    name_end = line.index("', '", start)
    content_start = name_end + 4
    m = re.search(r"', '(?:rtf|html|text)'", line[content_start:])
    if not m:
        return None
    raw = line[content_start: content_start + m.start()]
    return raw.replace("\\'", "'").replace("\\\\", "\\")


def clean(text):
    return text.encode('utf-8', errors='ignore').decode('utf-8')


def body_part(name):
    n = name.lower()
    if any(k in n for k in ["cxr", "chest", "lung", "pulmonary", "pleural", "pneumo", "copd", "ccf", "bronch", "ild", "cardiomegaly", "dextrocardia", "pacemaker", "tapvd", "hrct"]):
        return "Chest / CXR"
    if any(k in n for k in ["brain", "skull", "subdural", "haematoma", "wm"]):
        return "Brain / Skull"
    if any(k in n for k in ["mrcp", "mri"]):
        return "MRI"
    if "ct" in n:
        return "CT"
    if any(k in n for k in ["c/s", "cervical", "neck"]):
        return "Cervical Spine"
    if any(k in n for k in ["l/s", "lumbar", "lumb"]):
        return "Lumbar Spine"
    if any(k in n for k in ["d/s", "d-l", "dorso", "dorsal"]):
        return "Dorsal Spine"
    if "knee" in n:
        return "Knee"
    if "shoulder" in n:
        return "Shoulder"
    if any(k in n for k in ["hip", "pelvis", "femur"]):
        return "Pelvis / Hip"
    if any(k in n for k in ["ankle", "foot", "heel", "calcaneal", "hallux"]):
        return "Foot / Ankle"
    if any(k in n for k in ["wrist", "hand", "forearm", "elbow", "clavicle"]):
        return "Upper Limb"
    if any(k in n for k in ["kub", "ivu", "renal", "bladder", "rgu", "mcu"]):
        return "Urinary Tract"
    if any(k in n for k in ["abdomen", "abd", "barium", "gall", "liver", "pancre", "hirschsprung", "volvulus"]):
        return "Abdomen"
    if any(k in n for k in ["pns", "mastoid", "nasal", "nasopharynx", "sinus", "dns"]):
        return "ENT / PNS"
    if any(k in n for k in ["sacr", "si joint"]):
        return "Sacrum / SI Joints"
    return "General"


def run():
    try:
        user = User.objects.get(username=USERNAME)
        print(f"User found: {user.username}")
    except User.DoesNotExist:
        print(f"User '{USERNAME}' not found. Importing without creator.")
        user = None

    with open(SQL_FILE, "r", encoding="utf-8") as f:
        raw = f.read()

    lines = [l.strip() for l in raw.splitlines() if l.strip().startswith("INSERT")]
    print(f"Total templates found: {len(lines)}\n")

    imported = skipped = errors = 0

    for i, line in enumerate(lines, 1):
        name = get_name(line)
        if not name:
            errors += 1
            continue

        name = clean(name)

        if ReportTemplate.objects.filter(template_name=name).exists():
            print(f"[{i:03}] SKIP: {name}")
            skipped += 1
            continue

        content = get_content(line)
        if not content:
            errors += 1
            continue

        try:
            text = rtf_to_text(content)
        except:
            text = content

        text = clean(text)
        bp = body_part(name)

        try:
            ReportTemplate.objects.create(
                body_part=bp,
                template_name=name,
                content=text,
                is_active=True,
                created_by=user,
            )
            imported += 1
            print(f"[{i:03}] OK  {bp:25} | {name}")
        except Exception as e:
            print(f"[{i:03}] ERR {name}: {e}")
            errors += 1

    print(f"\nImported: {imported} | Skipped: {skipped} | Errors: {errors}")


run()
