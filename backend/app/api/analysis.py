from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyze import credibility
from app.crypto.keys import load_or_create_signing_key
from app.db.session import get_session
from app.llm.base import LLMClient
from app.llm.factory import build_llm_client
from app.settings import settings

router = APIRouter(prefix="/api/news/{news_id}/analysis", tags=["analysis"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_signing_key() -> SigningKey:
    return load_or_create_signing_key(settings.service_signing_key_path)


SigningKeyDep = Annotated[SigningKey, Depends(get_signing_key)]


def get_llm_client() -> LLMClient | None:
    """Build an LLM client only if an API key is configured.

    Without a key we return ``None`` and the analyzer skips the LLM
    signal rather than failing the whole request.
    """
    if not settings.llm_api_key:
        return None
    try:
        return build_llm_client(settings)
    except ValueError:
        return None


LLMClientDep = Annotated["LLMClient | None", Depends(get_llm_client)]


def _serialize(analysis: Any) -> dict[str, Any]:
    return {
        "id": str(analysis.id),
        "news_id": str(analysis.news_id),
        "score": analysis.score,
        "corroboration_count": analysis.corroboration_count,
        "corroboration_sources": list(analysis.corroboration_sources),
        "reputation_label": analysis.reputation_label,
        "reputation_weight": analysis.reputation_weight,
        "llm_score": analysis.llm_score,
        "llm_consistency": analysis.llm_consistency,
        "llm_summary": analysis.llm_summary,
        "llm_model": analysis.llm_model,
        "generated_at": analysis.generated_at.isoformat(),
        "signer": analysis.signer,
        "alg": analysis.alg,
    }


@router.get("")
async def get_analysis(news_id: uuid.UUID, session: SessionDep) -> dict[str, Any]:
    a = await credibility.get_existing(session, news_id)
    if a is None:
        raise HTTPException(status_code=404, detail="analysis not generated yet")
    return _serialize(a)


@router.post("")
async def post_analysis(
    news_id: uuid.UUID,
    session: SessionDep,
    signing_key: SigningKeyDep,
    llm_client: LLMClientDep,
) -> dict[str, Any]:
    existing = await credibility.get_existing(session, news_id)
    if existing is not None:
        return _serialize(existing)
    try:
        a = await credibility.analyze_news(
            session=session,
            news_id=news_id,
            signing_key=signing_key,
            llm_client=llm_client,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _serialize(a)
