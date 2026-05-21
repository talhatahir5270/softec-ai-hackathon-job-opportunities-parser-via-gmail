import asyncio
import logging

from app.schemas.student import StudentProfileCreate, StudentProfileStored
from app.services.mongo_store import student_profile_get_latest, student_profile_save

_lock = asyncio.Lock()
logger = logging.getLogger(__name__)


def _save_sync(payload: StudentProfileCreate) -> StudentProfileStored:
    try:
        return student_profile_save(payload)
    except Exception:
        logger.exception("MongoDB: failed to save student profile")
        raise


async def save_student_profile(payload: StudentProfileCreate) -> StudentProfileStored:
    async with _lock:
        return await asyncio.to_thread(_save_sync, payload)


async def get_student_profile_by_login_id(login_id: str) -> StudentProfileStored | None:
    return await asyncio.to_thread(student_profile_get_latest, login_id)
