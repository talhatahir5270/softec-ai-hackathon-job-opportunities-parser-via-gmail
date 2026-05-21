from fastapi import APIRouter

from app.api.v1.endpoints import cv, email_chat, emails, health, inbox, sitecheck, students

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(students.router, tags=["students"])
api_router.include_router(emails.router, tags=["emails"])
api_router.include_router(inbox.router, tags=["inbox"])
api_router.include_router(email_chat.router, tags=["email-chat"])
api_router.include_router(sitecheck.router, tags=["sitecheck"])
api_router.include_router(cv.router)
