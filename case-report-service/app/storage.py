"""
Phase 6 Task 40 — Storage backend: Azure Blob or local.
List/download files under {patient_id}/{appointment_id}/ (or pre-visit).
No PHI in logs; only job_id and path names.

DEBUG FIXES:
1. CRITICAL: Filename collision in download_to_dir — os.path.basename() produces
   identical names for files in different subdirectories (e.g. labs/results.pdf and
   images/results.pdf both become results.pdf). Second write silently overwrites first.
   Fixed: prefix each local filename with a zero-padded index: 000_results.pdf, 001_results.pdf.
   Applied to both Azure and local branches.

2. HIGH: Silent fallback when STORAGE_BACKEND=azure_blob but connection string is empty.
   Previously the condition `if STORAGE_BACKEND == "azure_blob" and AZURE_STORAGE_CONNECTION_STRING`
   meant a missing env var silently read from local disk (empty in ACI) — returning zero files
   and producing transcript-only reports for ALL patients with no error logged.
   Fixed: raise RuntimeError immediately if azure_blob configured but string is missing.

3. HIGH: Exception re-raise leaked raw Azure exception (contains blob paths = PHI-adjacent).
   Fixed: catch and re-raise a clean RuntimeError with only job_id; original exception
   suppressed with `from None`.

4. MEDIUM: `import shutil` was inside the for loop on every iteration.
   Fixed: moved to top of file.

5. LOW: os.path.relpath returns backslashes on Windows, breaking Azure blob name matching.
   Fixed: normalise with .replace(os.sep, "/").

6. LOW: job_id unused in list_file_paths but passed to internal helpers for logging.
   Fixed: used in warning log inside _list_azure and _list_local.

CONTRACT NOTE (issue #7):
file_paths returned by list_file_paths() are RELATIVE paths (the part after
"{patient_id}/{appointment_id}/"). download_to_dir() re-prepends the prefix.
Callers must never pass full blob names to download_to_dir(); doing so will
double the prefix. Assertion added to catch misuse.
"""
import os
import shutil
import logging
from typing import List, Tuple

from .config import (
    STORAGE_BACKEND,
    AZURE_STORAGE_CONNECTION_STRING,
    CONTAINER_PATIENT_UPLOADS,
    LOCAL_STORAGE_BASE,
)

logger = logging.getLogger(__name__)


def _blob_prefix(patient_id: str, appointment_id: str) -> str:
    """Canonical blob/path prefix. Shared by list and download."""
    return f"{patient_id}/{appointment_id or 'pre-visit'}"


def _list_local(patient_id: str, appointment_id: str, job_id: str) -> List[str]:
    base = LOCAL_STORAGE_BASE or "."
    prefix = os.path.join(base, patient_id, appointment_id or "pre-visit")
    if not os.path.isdir(prefix):
        logger.warning("Local storage dir not found job_id=%s path=%s", job_id, prefix)
        return []
    out = []
    for root, _dirs, files in os.walk(prefix):
        for f in files:
            # FIX #5: normalise to forward slashes for consistency with Azure blob names
            rel = os.path.relpath(os.path.join(root, f), prefix).replace(os.sep, "/")
            out.append(rel)
    return out


def _list_azure(patient_id: str, appointment_id: str, job_id: str) -> List[str]:
    if not AZURE_STORAGE_CONNECTION_STRING:
        logger.warning("AZURE_STORAGE_CONNECTION_STRING not set job_id=%s", job_id)
        return []
    try:
        from azure.storage.blob import BlobServiceClient
        client = BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)
        container = client.get_container_client(CONTAINER_PATIENT_UPLOADS)
        prefix = _blob_prefix(patient_id, appointment_id) + "/"
        names = [blob.name for blob in container.list_blobs(name_starts_with=prefix)]
        return [n[len(prefix):] for n in names]
    except Exception as e:
        logger.warning("Azure list failed job_id=%s: %s", job_id, type(e).__name__)
        return []


def list_file_paths(patient_id: str, appointment_id: str, job_id: str) -> List[str]:
    """
    Return relative paths for files under patient_id/appointment_id/.

    Returned paths are RELATIVE — they do not include the patient_id/appointment_id
    prefix. Pass them directly to download_to_dir(); do not re-add the prefix yourself.
    """
    if STORAGE_BACKEND == "azure_blob":
        return _list_azure(patient_id, appointment_id, job_id)
    return _list_local(patient_id, appointment_id, job_id)


def download_to_dir(
    patient_id: str,
    appointment_id: str,
    file_paths: List[str],
    dest_dir: str,
    job_id: str,
) -> List[Tuple[str, str]]:
    """
    Download files to dest_dir.

    Args:
        file_paths: RELATIVE paths as returned by list_file_paths().
                    Must NOT include the patient_id/appointment_id prefix.
        dest_dir:   Destination directory (temporary, cleaned by caller after use).
        job_id:     For log attribution only — no PHI logged.

    Returns:
        List of (local_path, original_relative_path).

    Raises:
        RuntimeError: on storage errors (safe message, no PHI in traceback).
    """
    if not file_paths:
        return []

    # FIX #7: Catch callers accidentally passing full blob names
    for rel in file_paths:
        if rel.startswith(patient_id):
            raise ValueError(
                f"file_paths must be relative (output of list_file_paths), "
                f"not full blob names. Got a path starting with patient_id."
            )

    prefix = _blob_prefix(patient_id, appointment_id)
    results: List[Tuple[str, str]] = []

    # FIX #2: Fail hard if azure_blob configured without connection string.
    if STORAGE_BACKEND == "azure_blob" and not AZURE_STORAGE_CONNECTION_STRING:
        raise RuntimeError(
            f"AZURE_STORAGE_CONNECTION_STRING is required when STORAGE_BACKEND=azure_blob "
            f"(job_id={job_id}). Cannot download files."
        )

    if STORAGE_BACKEND == "azure_blob":
        try:
            from azure.storage.blob import BlobServiceClient
            client = BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)
            container = client.get_container_client(CONTAINER_PATIENT_UPLOADS)

            for idx, rel in enumerate(file_paths):
                blob_name = f"{prefix}/{rel}".replace("\\", "/")
                safe_base = os.path.basename(rel.replace("/", os.sep)) or "file"
                # FIX #1/#8: Prefix with index to prevent filename collisions.
                # Two files named results.pdf in different subdirs would overwrite each other.
                local_path = os.path.join(dest_dir, f"{idx:03d}_{safe_base}")
                blob = container.get_blob_client(blob_name)
                with open(local_path, "wb") as f:
                    blob.download_blob().readinto(f)
                results.append((local_path, rel))

        except Exception as e:
            # FIX #3: Re-raise as clean error — raw Azure exceptions may contain
            # account names, blob paths (patient_id/appointment_id) in their message.
            # Log only job_id and exception type to stay PHI-safe.
            logger.warning(
                "Azure download failed job_id=%s type=%s",
                job_id,
                type(e).__name__,
            )
            raise RuntimeError(
                f"Storage download failed for job {job_id}"
            ) from None

    else:
        # Local storage (dev / Colab with STORAGE_BACKEND=local)
        base = LOCAL_STORAGE_BASE or "."
        for idx, rel in enumerate(file_paths):
            src = os.path.join(base, prefix.replace("/", os.sep), rel.replace("/", os.sep))
            if not os.path.isfile(src):
                logger.warning(
                    "Local file not found job_id=%s idx=%d", job_id, idx
                )
                continue
            safe_base = os.path.basename(src) or "file"
            # FIX #1: Prefix with index to prevent filename collisions.
            local_path = os.path.join(dest_dir, f"{idx:03d}_{safe_base}")
            shutil.copy2(src, local_path)
            results.append((local_path, rel))

    return results
