from fastapi import APIRouter, HTTPException, status

from app.schemas.student import StudentProfileCreate, StudentProfileStored
from app.services import student_storage

router = APIRouter()


@router.post(
    "/students",
    response_model=StudentProfileStored,
    status_code=status.HTTP_201_CREATED,
)
async def create_student_profile(body: StudentProfileCreate) -> StudentProfileStored:
    return await student_storage.save_student_profile(body)


@router.get("/students/{login_id}", response_model=StudentProfileStored)
async def get_student_profile(login_id: str) -> StudentProfileStored:
    row = await student_storage.get_student_profile_by_login_id(login_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student profile not found")
    return row
