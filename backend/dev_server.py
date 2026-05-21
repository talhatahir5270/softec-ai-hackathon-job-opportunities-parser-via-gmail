"""Run the API with defaults that match the frontend (`NEXT_PUBLIC_API_URL`, port 8000).

If port 8000 is already in use (WinError 10048), set UVICORN_PORT=8088 and set the same port in
`frontend/khushpush/.env` as NEXT_PUBLIC_API_URL. Disable reload with UVICORN_RELOAD=0 if needed.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import uvicorn


def _line_buffer_stdio() -> None:
    """Avoid silent terminals on Windows when logs are line-based."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(line_buffering=True)
            except (OSError, ValueError):
                pass


if __name__ == "__main__":
    _line_buffer_stdio()

    host = os.environ.get("UVICORN_HOST", "127.0.0.1")
    port = int(os.environ.get("UVICORN_PORT", "8000"))
    reload = os.environ.get("UVICORN_RELOAD", "1").lower() not in ("0", "false", "no")
    log_level = os.environ.get("UVICORN_LOG_LEVEL", "info").lower()
    access_log = os.environ.get("UVICORN_ACCESS_LOG", "1").lower() not in ("0", "false", "no")
    use_colors = os.environ.get("UVICORN_USE_COLORS", "1").lower() not in ("0", "false", "no")

    reload_dirs = os.environ.get("UVICORN_RELOAD_DIRS")
    extra: dict[str, Any] = {}
    if reload_dirs:
        extra["reload_dirs"] = [p.strip() for p in reload_dirs.split(os.pathsep) if p.strip()]

    print(
        f"[dev_server] http://{host}:{port}/docs  log_level={log_level}  access_log={access_log}  reload={reload}",
        flush=True,
    )

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level=log_level,
        access_log=access_log,
        use_colors=use_colors,
        **extra,
    )
