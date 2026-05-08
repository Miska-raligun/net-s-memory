from fastapi import FastAPI

from app.api import analysis, auth, news, transparency, vote
from app.settings import settings

app = FastAPI(title="net-s-memory", version="0.1.0")

app.include_router(news.router)
app.include_router(transparency.router)
app.include_router(analysis.router)
app.include_router(auth.router)
app.include_router(vote.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env}
