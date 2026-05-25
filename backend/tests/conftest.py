from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.crypto.log import append_news_signed
from app.db.models import Base, NewsCandidate, NewsItem
from app.db.session import get_session
from app.ingest.base import NewsItemDraft
from app.ingest.pipeline import to_canonical_payload
from app.main import app


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def _override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def seed_news(
    session: AsyncSession,
    drafts: Sequence[NewsItemDraft],
    signing_key: SigningKey,
    *,
    signer_id: str = "service:test",
) -> int:
    """Test helper: persist drafts as NewsItems and append signed leaves.

    Replaces the legacy ``ingest_drafts`` path for tests that don't care
    about the candidate → curator → news_item flow; semantically it's the
    same as "operator manually promoted every draft straight to the
    timeline" and produces a v1 canonical signature (unchanged byte-for-
    byte from the pre-curation era).
    """
    inserted = 0
    for draft in drafts:
        item = NewsItem(
            id=uuid.uuid4(),
            source=draft.source,
            source_url=draft.source_url,
            source_id=draft.source_id,
            title=draft.title,
            raw_text=draft.raw_text,
            lang=draft.lang,
            hot_rank=draft.hot_rank,
            fetched_at=draft.fetched_at,
        )
        session.add(item)
        await session.flush()
        await append_news_signed(
            session=session,
            news_id=item.id,
            payload=to_canonical_payload(item),
            signer_id=signer_id,
            signing_key=signing_key,
        )
        inserted += 1
    await session.commit()
    return inserted


# Re-export so test modules can import from the conftest namespace if they
# prefer that to importing helpers from a deep module path.
__all__ = ["seed_news", "NewsCandidate"]
