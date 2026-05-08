from fastapi import FastAPI

from app.settings import settings

app = FastAPI(title="net-s-memory", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env}
