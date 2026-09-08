# ADR 0002: Capability-aware model selection

## Status

Accepted

## Context

Models may expose different request protocols. Claude uses `messages`; OpenAI models use `chat_completions` or `responses`; Gemini exposes `generateContent`, `streamGenerateContent`, and `countTokens`. Other providers may advertise additional capabilities.

## Decision

Treat API-advertised capabilities as the source of truth. Agents declare supported capabilities, and selection filters to their intersection. Gemini catalogue discovery uses `/v1beta/models`, with `/v1/models` as a degraded fallback. When multiple supported capabilities exist, let the user choose; remember the choice per model and agent, while allowing it to be changed from launch flows or settings. `countTokens` is supplementary and cannot alone make a model launchable.

## Consequences

Unknown capabilities remain visible as unsupported until an agent adapter supports them. Adding support happens in an adapter rather than in shared selection logic. Fallback catalogue data must produce a warning because capabilities may be incomplete.

When metadata is absent, adapters use conservative family fallbacks: GPT/Codex use OpenAI Responses, Claude uses Anthropic Messages, and Aider uses Chat Completions. Advertised capabilities always take precedence.
