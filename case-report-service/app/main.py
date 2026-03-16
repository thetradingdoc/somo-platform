"""
Phase 6 — Case report service. FastAPI: POST /report, GET /health.
Tasks 45, 46, 47: endpoints, async job, callback POST.
"""
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException, Header
from pydantic import BaseModel, Field

from . import pipeline
from .config import STORAGE_BACKEND, SERVICE_VERSION, validate_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ReportRequest(BaseModel):
    job_id: str = Field(..., description="Unique job id from middleware")
    patient_id: str
    encounter_id: str
    appointment_id: str | None = None
    transcript: str | None = None
    transcript_endpoint: str | None = None
    transcript_endpoint_token: str | None = None
    prior_report_id: str | None = None
    callback_url: str
    callback_token: str


def run_report_task(payload: ReportRequest) -> None:
    """Task 47: Run pipeline in background; POST result to callback_url. Task 48: no PHI in logs."""
    job_id = payload.job_id
    temp_dir = None
    try:
        transcript = payload.transcript
        file_paths: list[str] = []
        result = pipeline.process_patient(
            patient_id=payload.patient_id,
            encounter_id=payload.encounter_id,
            transcript=transcript,
            file_paths=file_paths,
            prior_report_id=payload.prior_report_id,
            transcript_endpoint=payload.transcript_endpoint,
            transcript_endpoint_token=payload.transcript_endpoint_token,
            appointment_id=payload.appointment_id,
            job_id=job_id,
        )
        temp_dir = result.get("_temp_dir")
        # Task 43: reasoning_chain in callback alongside report markdown
        body = {
            "job_id": job_id,
            "status": "completed",
            "report_markdown": result["report_markdown"],
            "reasoning_chain": result["reasoning_chain"],
        }
        _post_callback(payload.callback_url, payload.callback_token, body)
    except Exception as e:
        logger.warning("job_id=%s run_report_task failed: %s", job_id, type(e).__name__)
        body = {
            "job_id": job_id,
            "status": "failed",
            "error_message": str(e)[:500],
        }
        _post_callback(payload.callback_url, payload.callback_token, body)
    finally:
        pipeline.cleanup_temp(temp_dir)


def _post_callback(url: str, token: str, body: dict) -> None:
    import urllib.request
    import json
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status >= 400:
                logger.warning("callback returned status=%s", resp.status)
    except Exception as e:
        logger.warning("callback POST failed: %s", type(e).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_config()
    yield


app = FastAPI(title="Case Report Service", version=SERVICE_VERSION, lifespan=lifespan)


@app.post("/report")
async def report(
    request: ReportRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(default=""),
):
    """
    Task 45: POST /report.
    Request: job_id, patient_id, encounter_id, appointment_id?, transcript_endpoint?,
             transcript_endpoint_token?, prior_report_id?, callback_url, callback_token.
    Response: 202 { job_id, status: "queued" }
    """
    # Inbound auth: middleware must call with Authorization: Bearer CASE_REPORT_SERVICE_TOKEN
    from .config import CASE_REPORT_SERVICE_TOKEN

    expected = f"Bearer {CASE_REPORT_SERVICE_TOKEN}" if CASE_REPORT_SERVICE_TOKEN else None
    if not expected or authorization != expected:
      raise HTTPException(status_code=401, detail="Unauthorized")

    background_tasks.add_task(run_report_task, request)
    return {"job_id": request.job_id, "status": "queued"}


@app.get("/health")
async def health():
    """
    Task 46: GET /health.
    Returns { status: "ok", version, storage_backend }.
    """
    return {
        "status": "ok",
        "version": SERVICE_VERSION,
        "storage_backend": STORAGE_BACKEND,
    }


@app.get("/")
async def root():
    return {"service": "case-report", "health": "/health", "report": "POST /report"}
