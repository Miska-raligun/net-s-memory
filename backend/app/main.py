from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    analysis,
    auth,
    candidates,
    events,
    followup,
    news,
    proposals,
    transparency,
    vote,
)
from app.settings import settings

app = FastAPI(title="net-s-memory", version="0.1.0")

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(news.router)
app.include_router(transparency.router)
app.include_router(analysis.router)
app.include_router(auth.router)
app.include_router(vote.router)
app.include_router(events.router)
app.include_router(followup.router)
app.include_router(proposals.router)
app.include_router(candidates.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env}
