"""AI Insights chat through Groq.

The browser sends the question, recent turns and the insight context (verdicts,
values, limits and recommendations computed by the app's deterministic rules).
This endpoint asks a Groq-hosted model to explain them in plain language and
returns text only. The API key stays in this process's environment.

The model never decides anything: verdicts, numbers and proposed design
changes come from the app's rules, and the frontend re-checks every reply
against its guardrails before showing it.
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["assistant"])

MAX_CONTEXT_CHARS = 60_000

SYSTEM_PROMPT = """You are the AutoTwin engineering assistant on the AI Insights page.
You explain design checks for a baseline design A and a candidate design B of one automotive component.

Rules:
1. Use only numbers and facts present in CONTEXT. Never invent values, loads, limits or material data.
2. Verdicts (PASS, NEEDS REVIEW, FAIL) are set by deterministic rules and are given in CONTEXT. Repeat them exactly; never change or soften them.
3. Call the designs "baseline A" and "candidate B".
4. Every number is a reduced-order estimate checked against demo limits, not a finite-element or test result. Never claim certification, validation, guarantees, fatigue life, safety for road use or cost savings.
5. If the user proposes a change ("what if ..."), explain qualitatively what it should do and why. The app shows the exact computed numbers in a table under your answer, so don't make up results.
6. Be practical: when something fails, say which parameter drives it and which recommendation in CONTEXT fixes it.
7. Plain text only. No markdown headings or tables. Keep it under about 130 words; use short paragraphs or "- " bullets."""


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=600)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    context: dict[str, Any]


class ChatResponse(BaseModel):
    text: str
    provider: str = "groq"
    model: str


def _request_body(model: str, messages: list[dict[str, str]]) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 1200}
    # GPT-OSS models reason before answering; keep that short so replies stay quick.
    if model.startswith("openai/gpt-oss"):
        body["reasoning_effort"] = "low"
    return body


def _settings() -> Settings:
    # Read fresh so a key added to .env works without restarting the server.
    return Settings()


@router.get("/assistant/chat/status")
def chat_status() -> dict[str, Any]:
    s = _settings()
    return {
        "provider": "groq",
        "available": s.groq_available,
        "model": s.groq_model if s.groq_available else None,
        "note": "Explains verdicts computed by the app's rules; it cannot set or change a verdict.",
    }


@router.post("/assistant/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    s = _settings()
    if not s.groq_available:
        raise HTTPException(status_code=503, detail="Groq is not configured. Set GROQ_API_KEY in backend/.env.")

    context_json = json.dumps(payload.context, separators=(",", ":"), ensure_ascii=False)
    if len(context_json) > MAX_CONTEXT_CHARS:
        raise HTTPException(status_code=413, detail="Insight context is too large.")

    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in payload.history[-8:]:
        messages.append({"role": turn.role, "content": turn.text[:2000]})
    messages.append({"role": "user", "content": f"CONTEXT (JSON):\n{context_json}\n\nQUESTION: {payload.question}"})

    try:
        res = httpx.post(
            s.groq_base_url,
            headers={"Authorization": f"Bearer {s.groq_api_key}", "Content-Type": "application/json"},
            json=_request_body(s.groq_model, messages),
            timeout=s.groq_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        log.warning("Groq request failed: %s", exc.__class__.__name__)
        raise HTTPException(status_code=502, detail="Could not reach Groq.") from exc

    if res.status_code == 401:
        raise HTTPException(status_code=502, detail="Groq rejected the API key.")
    if res.status_code == 429:
        raise HTTPException(status_code=503, detail="Groq rate limit reached. Try again shortly.")
    if res.status_code >= 400:
        log.warning("Groq error %s: %s", res.status_code, res.text[:300])
        raise HTTPException(status_code=502, detail=f"Groq returned HTTP {res.status_code}.")

    try:
        text = (res.json()["choices"][0]["message"]["content"] or "").strip()
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Unexpected reply from Groq.") from exc
    text = _plain(text)
    if not text:
        raise HTTPException(status_code=502, detail="Groq returned an empty reply.")
    return ChatResponse(text=text, model=s.groq_model)


def _plain(text: str) -> str:
    """The chat shows plain text, so drop markdown emphasis and headings the model may add."""
    text = re.sub(r"\*\*(.+?)\*\*", lambda m: m.group(1), text)
    text = re.sub(r"__(.+?)__", lambda m: m.group(1), text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s+", "", text)
    return text.strip()
