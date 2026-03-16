"""
Phase 6 — Case report service config.
STORAGE_BACKEND: azure_blob | local

DEBUG FIXES:
1. `import tempfile` moved to top (was mid-file after assignments).
2. CALLBACK_TOKEN_HEADER removed — spec (Tasks 55/59) uses Authorization: Bearer,
   not a custom header. Using a custom header would break middleware callback validation.
3. All required env vars declared centrally: OPENAI_API_KEY, PINECONE_API_KEY,
   MIDDLEWARE_URL, MIDDLEWARE_TOKEN. Previously scattered across callers; impossible to
   audit what the service needs at a glance.
4. validate_config() added — call at startup. Fails fast on missing required vars
   rather than running jobs that silently produce wrong output (e.g. transcript-only
   reports because Azure connection string was missing).
"""
import os
import tempfile

# ── Storage ─────────────────────────────────────────────────────────────────
STORAGE_BACKEND = (os.environ.get("STORAGE_BACKEND") or "local").strip().lower()
if STORAGE_BACKEND not in ("azure_blob", "local"):
    STORAGE_BACKEND = "local"

AZURE_STORAGE_CONNECTION_STRING = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
CONTAINER_PATIENT_UPLOADS = os.environ.get("CONTAINER_PATIENT_UPLOADS", "patient-uploads")

# Optional: local base path when STORAGE_BACKEND=local (e.g. ./data)
LOCAL_STORAGE_BASE = os.environ.get("LOCAL_STORAGE_BASE", "")

# ── Service identity ─────────────────────────────────────────────────────────
SERVICE_VERSION = os.environ.get("SERVICE_VERSION", "0.1.0")

# Token the middleware sends in the POST /report request (validates caller is middleware).
# The service checks this on every inbound job request.
CASE_REPORT_SERVICE_TOKEN = os.environ.get("CASE_REPORT_SERVICE_TOKEN", "")

# ── Middleware integration (Task 41/57) ──────────────────────────────────────
# The service fetches the transcript by calling:
#   GET {MIDDLEWARE_URL}/internal/communications/by-encounter/{encounter_id}/text
#   Authorization: Bearer {MIDDLEWARE_TOKEN}
MIDDLEWARE_URL = os.environ.get("MIDDLEWARE_URL", "").rstrip("/")
MIDDLEWARE_TOKEN = os.environ.get("MIDDLEWARE_TOKEN", "")

# ── AI / RAG backends ────────────────────────────────────────────────────────
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY", "")
PINECONE_INDEX = os.environ.get("PINECONE_INDEX", "doctorlittle")
PINECONE_ENVIRONMENT = os.environ.get("PINECONE_ENVIRONMENT", "")

# ── Callback auth (sent back to middleware when job completes) ────────────────
# Callback uses Authorization: Bearer {callback_token}, where callback_token
# is the per-job token received in the POST /report payload.
# Do NOT use a custom header — the middleware validates Authorization: Bearer.
# (CALLBACK_TOKEN_HEADER was removed: it implied X-Callback-Token, which is wrong.)

// ── Temp dir (cleaned after each job) ────────────────────────────────────────
TEMP_DIR = os.environ.get("TEMP_DIR") or tempfile.gettempdir()


def validate_config() -> None:
    """
    Validate required config at startup. Raises RuntimeError on any missing
    required value so the service fails fast rather than silently producing
    wrong results (e.g. transcript-only reports when uploads exist but storage
    is misconfigured).

    Call this from main() / FastAPI lifespan before accepting any requests.
    """
    errors = []

    # Always enforce storage + inbound auth; these are security-critical.
    if STORAGE_BACKEND == "azure_blob" and not AZURE_STORAGE_CONNECTION_STRING:
        errors.append(
            "AZURE_STORAGE_CONNECTION_STRING is required when STORAGE_BACKEND=azure_blob. "
            "Without it the service cannot read patient uploads from Blob."
        )

    if not CASE_REPORT_SERVICE_TOKEN:
        errors.append(
            "CASE_REPORT_SERVICE_TOKEN is required. "
            "Without it the service would accept job requests from anyone and callbacks would be unauthenticated."
        )

    # Strict vs. stub mode for AI + middleware integration
    strict = (os.environ.get("CASE_REPORT_VALIDATE_STRICT", "1") or "1").strip() == "1"

    if strict:
        # AI backends
        if not OPENAI_API_KEY:
            errors.append(
                "OPENAI_API_KEY is required. Layers 3–5 (vision, differential, RAG) will fail."
            )

        if not PINECONE_API_KEY:
            errors.append(
                "PINECONE_API_KEY is required. Layer 5 (ClinicalQueryEngine RAG) will fail."
            )

        # Middleware integration
        if not MIDDLEWARE_URL:
            errors.append(
                "MIDDLEWARE_URL is required (e.g. https://api.doclittle.com). "
                "Layer 1 cannot fetch transcripts without it."
            )

        if not MIDDLEWARE_TOKEN:
            errors.append(
                "MIDDLEWARE_TOKEN is required. "
                "GET /internal/communications/by-encounter/:id/text will return 401."
            )
    else:
        # Stub mode: log warnings for missing AI/middleware config but do not block startup.
        if not OPENAI_API_KEY:
            print(
                "⚠️  OPENAI_API_KEY not set. Running case report service in stub mode without Layers 3–5."
            )
        if not PINECONE_API_KEY:
            print(
                "⚠️  PINECONE_API_KEY not set. RAG layer will be disabled in stub mode."
            )
        if not MIDDLEWARE_URL or not MIDDLEWARE_TOKEN:
            print(
                "⚠️  MIDDLEWARE_URL/MIDDLEWARE_TOKEN not fully configured. "
                "Transcript fetch from middleware may fail in stub mode."
            )

    if errors:
        raise RuntimeError(
            "Case report service misconfigured — fix before accepting jobs:\n"
            + "\n".join(f"  • {e}" for e in errors)
        )
