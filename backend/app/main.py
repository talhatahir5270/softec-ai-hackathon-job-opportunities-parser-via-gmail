import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.auth.routes import router as google_auth_router
from app.core.config import settings
from app.services import packaged_data
from app.services.mongo_store import init_mongo_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(init_mongo_db)
    await asyncio.to_thread(packaged_data.ensure_demo_inbox_mongo_from_files)
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.PROJECT_NAME,
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router, prefix=settings.API_V1_STR)
    application.include_router(google_auth_router)

    @application.get("/", tags=["root"])
    async def root() -> dict[str, str]:
        return {
            "message": settings.PROJECT_NAME,
            "docs": "/docs",
            "health": f"{settings.API_V1_STR}/health",
        }

    return application


app = create_app()
