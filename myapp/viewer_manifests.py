import os
from xml.sax.saxutils import quoteattr
from urllib.parse import quote

import pydicom
from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from django.views.decorators.http import require_GET
from pydicom.dataset import Dataset
from pydicom.multival import MultiValue
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian
from pydicom.valuerep import DSdecimal, DSfloat, IS, PersonName

from .models import DICOMImage
from .views import sign_dicom_path

BINARY_VRS = {"OB", "OW", "OF", "OD", "OL", "OV", "UN"}


def _cors(response):
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response["Cache-Control"] = "no-store"
    return response


def _plain(value):
    if isinstance(value, (Sequence, MultiValue)):
        return [_plain(v) for v in value]
    if isinstance(value, Dataset):
        return _dataset_to_dict(value)
    if isinstance(value, (DSfloat, DSdecimal)):
        return float(value)
    if isinstance(value, IS):
        return int(value)
    if isinstance(value, PersonName):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return None
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _dataset_to_dict(ds):
    out = {}
    for elem in ds:
        keyword = elem.keyword
        if not keyword or keyword == "PixelData" or elem.VR in BINARY_VRS:
            continue
        try:
            out[keyword] = _plain(elem.value)
        except Exception:
            continue
    return out


def _study_images(study_uid):
    images = list(
        DICOMImage.objects.filter(study_instance_uid=study_uid).order_by(
            "series_number", "instance_number", "id"
        )
    )
    if not images:
        raise Http404("Study not found")
    return images


def _full_path(file_path):
    media_root = os.path.realpath(settings.MEDIA_ROOT)
    full = os.path.realpath(os.path.join(media_root, file_path))
    if not full.startswith(media_root + os.sep) or not os.path.isfile(full):
        return None
    return full


def _dicom_path(file_path):
    clean = str(file_path).lstrip("/")
    return "/dicom/" + quote(clean) + "/?sig=" + quote(sign_dicom_path(clean), safe="")


def _attr(value):
    return quoteattr("" if value is None else str(value))


@require_GET
def weasis_manifest(request, study_uid):
    images = _study_images(study_uid)
    first = images[0]
    base = request.build_absolute_uri("/").rstrip("/")

    series_map = {}
    for image in images:
        series_map.setdefault(image.series_instance_uid or "", []).append(image)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<wado_query xmlns="http://www.weasis.org/xsd" wadoURL={_attr(base)} requireOnlySOPInstanceUID="false">',
        f"<Patient PatientID={_attr(first.patient_id)} PatientName={_attr(first.patient_name)} "
        f"PatientBirthDate={_attr(first.patient_birth_date)} PatientSex={_attr(first.patient_sex)}>",
        f"<Study StudyInstanceUID={_attr(study_uid)} StudyDescription={_attr(first.study_description)} "
        f"StudyDate={_attr(first.study_date)}>",
    ]
    for series_uid, items in series_map.items():
        head = items[0]
        lines.append(
            f"<Series SeriesInstanceUID={_attr(series_uid)} SeriesDescription={_attr(head.series_description)} "
            f"SeriesNumber={_attr(head.series_number)} Modality={_attr(head.modality)}>"
        )
        for image in items:
            lines.append(
                f"<Instance SOPInstanceUID={_attr(image.sop_instance_uid)} "
                f"InstanceNumber={_attr(image.instance_number)} "
                f"DirectDownloadFile={_attr(_dicom_path(image.file_path))}/>"
            )
        lines.append("</Series>")
    lines += ["</Study>", "</Patient>", "</wado_query>"]

    response = HttpResponse("\n".join(lines), content_type="application/xml; charset=utf-8")
    return _cors(response)


@require_GET
def ohif_manifest(request, study_uid):
    study = None
    series_map = {}
    modalities = set()
    total = 0

    for image in _study_images(study_uid):
        full = _full_path(image.file_path)
        if not full:
            continue
        try:
            ds = pydicom.dcmread(full, stop_before_pixels=True, force=True)
        except Exception:
            continue

        meta = _dataset_to_dict(ds)
        syntax = getattr(getattr(ds, "file_meta", None), "TransferSyntaxUID", None)
        if syntax is not None:
            if syntax.is_compressed:
                syntax = ExplicitVRLittleEndian
            meta["TransferSyntaxUID"] = str(syntax)

        if study is None:
            study = {
                key: meta.get(key, "")
                for key in (
                    "StudyInstanceUID",
                    "StudyDate",
                    "StudyTime",
                    "PatientName",
                    "PatientID",
                    "AccessionNumber",
                    "PatientAge",
                    "PatientSex",
                    "StudyDescription",
                )
            }
            study["StudyInstanceUID"] = study["StudyInstanceUID"] or study_uid

        series_uid = meta.get("SeriesInstanceUID") or image.series_instance_uid or ""
        series = series_map.get(series_uid)
        if series is None:
            series = {
                "SeriesInstanceUID": series_uid,
                "SeriesNumber": meta.get("SeriesNumber", image.series_number),
                "SeriesDescription": meta.get("SeriesDescription", image.series_description or ""),
                "Modality": meta.get("Modality", image.modality or ""),
                "instances": [],
            }
            series_map[series_uid] = series

        modalities.add(series["Modality"])
        total += 1
        series["instances"].append(
            {
                "metadata": meta,
                "url": "dicomweb:" + request.build_absolute_uri(_dicom_path(image.file_path)),
            }
        )

    if study is None:
        raise Http404("No readable DICOM files")

    def series_order(item):
        number = item["SeriesNumber"]
        return (not isinstance(number, (int, float)), number if isinstance(number, (int, float)) else 0)

    study["NumInstances"] = total
    study["Modalities"] = "\\".join(sorted(m for m in modalities if m))
    study["series"] = sorted(series_map.values(), key=series_order)

    return _cors(JsonResponse({"studies": [study]}))
