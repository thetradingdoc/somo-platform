"""
Phase 6 — Case report pipeline (refactor of patient_rag_pipeline_v3.2).
Tasks 39, 41, 42, 43, 44, 48, 51: process_patient(), transcript path, Layer 4 guard,
reasoning chain output, no display/IPyImage, layer error handling, temp cleanup.
"""
import os
import json
import logging
import tempfile
import time
from typing import Any, Dict, List, Optional

from . import storage
from .config import TEMP_DIR

logger = logging.getLogger(__name__)


def _fetch_transcript(endpoint: str, token: str, job_id: str) -> Optional[str]:
    """Task 41: Fetch transcript from FHIR endpoint if not passed inline. No PHI in logs."""
    try:
        import urllib.request
        req = urllib.request.Request(endpoint)
        req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return data.get("text") or data.get("transcript") or None
    except Exception as e:
        logger.warning("job_id=%s transcript fetch failed: %s", job_id, type(e).__name__)
        return None


def _fetch_document_context(endpoint: str, token: str, job_id: str) -> Optional[str]:
    """vc-7: Fetch patient document extracts from middleware for RAG context."""
    try:
        import urllib.request
        req = urllib.request.Request(endpoint)
        req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return data.get("text") or None
    except Exception as e:
        logger.warning("job_id=%s document_context fetch failed: %s", job_id, type(e).__name__)
        return None


def _fetch_vitals(endpoint: str, token: str, job_id: str) -> Optional[str]:
    """vc-8: Fetch encounter vitals from middleware for case report."""
    try:
        import urllib.request
        req = urllib.request.Request(endpoint)
        req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return data.get("text") or None
    except Exception as e:
        logger.warning("job_id=%s vitals fetch failed: %s", job_id, type(e).__name__)
        return None


def _layer1_perception(transcript: Optional[str], file_paths: List[str], job_id: str) -> Dict[str, Any]:
    """
    Task 41: Layer 1 — transcript as input path.
    If transcript passed, use directly; else would come from transcript_endpoint (caller fetches).
    Returns perceptual state: signal_analysis (labs/text) + visual_findings (images).
    """
    out: Dict[str, Any] = {"signal_analysis": "", "visual_findings": [], "transcript_excerpt": ""}

    # Transcript excerpt for downstream layers
    if transcript:
        out["transcript_excerpt"] = (transcript[:2000] + "…") if len(transcript) > 2000 else transcript

    # Basic file perception: extract text from PDFs and note presence of images.
    if not file_paths:
        return out

    lab_text_chunks: List[str] = []
    image_findings: List[Dict[str, Any]] = []

    for path in file_paths:
        lower = (path or "").lower()
        if lower.endswith(".pdf"):
            try:
                import pdfplumber  # type: ignore

                with pdfplumber.open(path) as pdf:
                    pages = [p.extract_text() or "" for p in pdf.pages]
                text = "\n".join(pages).strip()
                if text:
                    lab_text_chunks.append(text[:5000])
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("job_id=%s layer1 PDF parse failed for %s: %s", job_id, path, type(e).__name__)
        elif lower.endswith((".jpg", ".jpeg", ".png", ".heic", ".heif")):
            image_findings.append({"path": path, "summary": "image_present"})

    if lab_text_chunks:
        out["signal_analysis"] = "\n\n".join(lab_text_chunks)
    if image_findings:
        out["visual_findings"] = image_findings

    return out


def _layer4_guard(perceptual: Dict[str, Any]) -> bool:
    """Task 42: Transcript-only guard: no signal_analysis and no visual findings."""
    sa = perceptual.get("signal_analysis") or ""
    vf = perceptual.get("visual_findings") or []
    return bool(sa.strip() or vf)


def _run_transcript_only_path(transcript: Optional[str], job_id: str) -> tuple[str, Dict[str, Any]]:
    """Task 42: Transcript-only path. Extract chief complaint, symptoms, meds; TRANSCRIPT-ONLY REPORT header."""
    report = "# TRANSCRIPT-ONLY REPORT\n\n"
    report += "*(No imaging or lab data provided; findings from transcript only.)*\n\n"
    if transcript:
        report += "## Chief complaint / history\n\n"
        report += transcript[:4000] + ("\n\n…" if len(transcript) > 4000 else "") + "\n\n"
    report += "---\n*Do not generate differentials from empty visual/lab data.*\n"
    chain = {
        "layer": "transcript_only",
        "guard_triggered": True,
        "steps": ["transcript_only_extraction"],
    }
    return report, chain


def _run_full_pipeline(
    transcript: Optional[str],
    local_files: List[tuple],
    prior_report_id: Optional[str],
    job_id: str,
) -> tuple[str, Dict[str, Any]]:
    """Stub 6-layer flow: produces report + reasoning_chain. Task 48: layer failure -> continue, no PHI."""
    chain: Dict[str, Any] = {"layers": [], "errors": []}
    report_parts = ["# Case Report\n\n"]

    # Layer 1
    try:
        chain["layers"].append({"name": "layer1", "status": "ok"})
        report_parts.append("## Inputs\n\nTranscript and file inputs received.\n\n")
    except Exception as e:
        chain["layers"].append({"name": "layer1", "status": "error", "code": type(e).__name__})
        chain["errors"].append({"layer": "layer1", "code": type(e).__name__})

    # Stub layers 2–6 (minimal output)
    for i in range(2, 7):
        try:
            chain["layers"].append({"name": f"layer{i}", "status": "ok"})
        except Exception as e:
            chain["layers"].append({"name": f"layer{i}", "status": "error", "code": type(e).__name__})
            chain["errors"].append({"layer": f"layer{i}", "code": type(e).__name__})

    report_parts.append("\n---\n*Report generated by case report service.*\n")
    return "\n".join(report_parts), chain


def process_patient(
    patient_id: str,
    encounter_id: str,
    transcript: Optional[str],
    file_paths: List[str],
    prior_report_id: Optional[str],
    transcript_endpoint: Optional[str] = None,
    transcript_endpoint_token: Optional[str] = None,
    document_context_endpoint: Optional[str] = None,
    document_context_endpoint_token: Optional[str] = None,
    vitals_endpoint: Optional[str] = None,
    vitals_endpoint_token: Optional[str] = None,
    appointment_id: Optional[str] = None,
    job_id: str = "",
) -> Dict[str, Any]:
    """
    Task 39: Single entry point; no input() prompts. All inputs via parameters.
    Returns {"report_markdown": str, "reasoning_chain": dict, "reasoning_chain_path": str}.
    """
    job_id = job_id or "unknown"
    temp_dir = None
    local_files: List[tuple] = []

    try:
        # Task 41: Transcript — use passed string or fetch from endpoint
        if not transcript and transcript_endpoint and transcript_endpoint_token:
            transcript = _fetch_transcript(transcript_endpoint, transcript_endpoint_token, job_id)

        # vc-7: Fetch patient document extracts and prepend to transcript for RAG context
        if document_context_endpoint and document_context_endpoint_token:
            doc_context = _fetch_document_context(
                document_context_endpoint, document_context_endpoint_token, job_id
            )
            if doc_context and doc_context.strip():
                transcript = (
                    f"[Patient record excerpts]\n{doc_context.strip()}\n\n[Visit transcript]\n{(transcript or '')}"
                )

        # vc-8: Fetch encounter vitals and prepend to transcript
        if vitals_endpoint and vitals_endpoint_token:
            vitals_text = _fetch_vitals(vitals_endpoint, vitals_endpoint_token, job_id)
            if vitals_text and vitals_text.strip():
                transcript = (
                    f"[Recorded vitals]\n{vitals_text.strip()}\n\n{(transcript or '')}"
                )

        # Resolve file_paths: if empty, list from storage under patient_id/appointment_id
        if not file_paths and patient_id:
            file_paths = storage.list_file_paths(
                patient_id, appointment_id or encounter_id, job_id
            )

        # Download blobs to temp dir (Task 51: we clean this at the end)
        if file_paths:
            temp_dir = tempfile.mkdtemp(prefix="case_report_", dir=TEMP_DIR)
            local_files = storage.download_to_dir(
                patient_id,
                appointment_id or encounter_id,
                file_paths,
                temp_dir,
                job_id,
            )

        perceptual = _layer1_perception(transcript, file_paths, job_id)

        # Task 42: Layer 4 transcript-only guard
        if not _layer4_guard(perceptual):
            report_md, reasoning_chain = _run_transcript_only_path(transcript, job_id)
        else:
            report_md, reasoning_chain = _run_full_pipeline(
                transcript, local_files, prior_report_id, job_id
            )

        # Task 43: Save reasoning_chain_{timestamp}.json and return path
        ts = time.strftime("%Y%m%d_%H%M%S", time.gmtime())
        chain_filename = f"reasoning_chain_{ts}.json"
        if temp_dir:
            chain_path = os.path.join(temp_dir, chain_filename)
        else:
            temp_dir = tempfile.mkdtemp(prefix="case_report_", dir=TEMP_DIR)
            chain_path = os.path.join(temp_dir, chain_filename)
        with open(chain_path, "w") as f:
            json.dump(reasoning_chain, f, indent=2)

        return {
            "report_markdown": report_md,
            "reasoning_chain": reasoning_chain,
            "reasoning_chain_path": chain_path,
            "_temp_dir": temp_dir,
        }
    except Exception as e:
        logger.warning("job_id=%s pipeline error: %s", job_id, type(e).__name__)
        if temp_dir and os.path.isdir(temp_dir):
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
        raise


def cleanup_temp(temp_dir: Optional[str]) -> None:
    """Task 51: Delete downloaded blobs and converted images after pipeline completes or on error."""
    if not temp_dir or not os.path.isdir(temp_dir):
        return
    try:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception as e:
        logger.warning("cleanup_temp failed: %s", type(e).__name__)
