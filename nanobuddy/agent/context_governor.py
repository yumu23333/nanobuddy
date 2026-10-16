"""Context Governor — manages message history context governance.

Extracts context governance logic (microcompression, truncation, orphan handling)
from AgentRunner to improve maintainability and testability.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from loguru import logger

from nanobuddy.utils.helpers import (
    estimate_message_tokens,
    estimate_prompt_tokens_chain,
    find_legal_message_start,
    truncate_text,
)

if TYPE_CHECKING:
    from nanobuddy.agent.runner import AgentRunSpec
    from nanobuddy.providers.base import LLMProvider

# ── Constants ──
_SNIP_SAFETY_BUFFER = 1024
_MICROCOMPACT_KEEP_RECENT = 10
_MICROCOMPACT_MIN_CHARS = 500
_COMPACTABLE_TOOLS = frozenset({
    "read_file", "exec", "grep", "glob",
    "web_search", "web_fetch", "list_dir",
})
_BACKFILL_CONTENT = "[Tool result unavailable — call was interrupted or lost]"


class ContextGovernor:
    """Manages message history context governance for tool-using agents.

    Responsibilities:
    - Drop orphan tool results (no matching assistant tool_call)
    - Backfill missing tool results (tool_use blocks without results)
    - Microcompact old compactable tool results (replace with summaries)
    - Apply tool result budget (normalize/truncate results)
    - Snip history to fit within context window budget
    """

    def __init__(
        self,
        provider: LLMProvider,
        model: str,
        context_window_tokens: int | None = None,
        normalize_tool_result: Callable[..., Any] | None = None,
    ):
        self.provider = provider
        self.model = model
        self.context_window_tokens = context_window_tokens
        self._normalize_tool_result = normalize_tool_result

    def set_context_window(self, context_window_tokens: int) -> None:
        """Update the context window tokens limit."""
        self.context_window_tokens = context_window_tokens

    def set_normalize_func(self, func: Callable[..., Any]) -> None:
        """Set the tool result normalization function."""
        self._normalize_tool_result = func

    # ── Public governance pipeline ──

    def govern(
        self,
        messages: list[dict[str, Any]],
        spec: "AgentRunSpec | None" = None,
    ) -> list[dict[str, Any]]:
        """Run full context governance pipeline on messages.

        Returns a list suitable for sending to the LLM.
        """
        try:
            # Step 1: Drop orphan tool results
            messages = self._drop_orphan_tool_results(messages)

            # Step 2: Backfill missing tool results
            messages = self._backfill_missing_tool_results(messages)

            # Step 3: Microcompact compactable tool results
            messages = self._microcompact(messages)

            # Step 4: Apply tool result budget (if normalizer provided)
            if self._normalize_tool_result is not None:
                messages = self._apply_tool_result_budget(messages, spec)

            # Step 5: Snip history to fit budget
            if spec is not None:
                messages = self._snip_history(messages, spec)

            # Step 6: Final cleanup - drop orphans after snipping
            messages = self._drop_orphan_tool_results(messages)
            messages = self._backfill_missing_tool_results(messages)
        except Exception as exc:
            logger.warning(
                "Context governance failed: {}; applying minimal repair",
                exc,
            )
            try:
                messages = self._drop_orphan_tool_results(messages)
                messages = self._backfill_missing_tool_results(messages)
            except Exception:
                pass  # Keep original messages if repair also fails

        return messages

    def govern_safe(
        self,
        messages: list[dict[str, Any]],
        spec: "AgentRunSpec | None" = None,
    ) -> list[dict[str, Any]]:
        """Safe wrapper for govern() that never raises exceptions."""
        try:
            return self.govern(messages, spec)
        except Exception as exc:
            logger.warning(
                "Context governance safe mode failed: {}; returning original messages",
                exc,
            )
            return list(messages)

    # ── Step 1: Drop orphan tool results ──

    @staticmethod
    def _drop_orphan_tool_results(
        messages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Drop tool results that have no matching assistant tool_call earlier in the history."""
        declared: set[str] = set()
        updated: list[dict[str, Any]] | None = None
        for idx, msg in enumerate(messages):
            role = msg.get("role")
            if role == "assistant":
                for tc in msg.get("tool_calls") or []:
                    if isinstance(tc, dict) and tc.get("id"):
                        declared.add(str(tc["id"]))
            if role == "tool":
                tid = msg.get("tool_call_id")
                if tid and str(tid) not in declared:
                    if updated is None:
                        updated = [dict(m) for m in messages[:idx]]
                    continue
            if updated is not None:
                updated.append(dict(msg))

        if updated is None:
            return messages
        return updated

    # ── Step 2: Backfill missing tool results ──

    @staticmethod
    def _backfill_missing_tool_results(
        messages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Insert synthetic error results for orphaned tool_use blocks."""
        declared: list[tuple[int, str, str]] = []  # (assistant_idx, call_id, name)
        fulfilled: set[str] = set()
        for idx, msg in enumerate(messages):
            role = msg.get("role")
            if role == "assistant":
                for tc in msg.get("tool_calls") or []:
                    if isinstance(tc, dict) and tc.get("id"):
                        name = ""
                        func = tc.get("function")
                        if isinstance(func, dict):
                            name = func.get("name", "")
                        declared.append((idx, str(tc["id"]), name))
            elif role == "tool":
                tid = msg.get("tool_call_id")
                if tid:
                    fulfilled.add(str(tid))

        missing = [(ai, cid, name) for ai, cid, name in declared if cid not in fulfilled]
        if not missing:
            return messages

        updated = list(messages)
        offset = 0
        for assistant_idx, call_id, name in missing:
            insert_at = assistant_idx + 1 + offset
            while insert_at < len(updated) and updated[insert_at].get("role") == "tool":
                insert_at += 1
            updated.insert(insert_at, {
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": _BACKFILL_CONTENT,
            })
            offset += 1
        return updated

    # ── Step 3: Microcompact ──

    @staticmethod
    def _microcompact(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace old compactable tool results with one-line summaries."""
        compactable_indices: list[int] = []
        for idx, msg in enumerate(messages):
            if msg.get("role") == "tool" and msg.get("name") in _COMPACTABLE_TOOLS:
                compactable_indices.append(idx)

        if len(compactable_indices) <= _MICROCOMPACT_KEEP_RECENT:
            return messages

        stale = compactable_indices[: len(compactable_indices) - _MICROCOMPACT_KEEP_RECENT]
        updated: list[dict[str, Any]] | None = None
        for idx in stale:
            msg = messages[idx]
            content = msg.get("content")
            if not isinstance(content, str) or len(content) < _MICROCOMPACT_MIN_CHARS:
                continue
            name = msg.get("name", "tool")
            summary = f"[{name} result omitted from context]"
            if updated is None:
                updated = [dict(m) for m in messages]
            updated[idx]["content"] = summary

        return updated if updated is not None else messages

    # ── Step 4: Apply tool result budget ──

    def _apply_tool_result_budget(
        self,
        messages: list[dict[str, Any]],
        spec: "AgentRunSpec | None",
    ) -> list[dict[str, Any]]:
        """Normalize and truncate tool results to fit budget."""
        if self._normalize_tool_result is None or spec is None:
            return messages

        updated = messages
        for idx, message in enumerate(messages):
            if message.get("role") != "tool":
                continue
            normalized = self._normalize_tool_result(
                spec,
                str(message.get("tool_call_id") or f"tool_{idx}"),
                str(message.get("name") or "tool"),
                message.get("content"),
            )
            if normalized != message.get("content"):
                if updated is messages:
                    updated = [dict(m) for m in messages]
                updated[idx]["content"] = normalized
        return updated

    # ── Step 5: Snip history ──

    def _snip_history(
        self,
        messages: list[dict[str, Any]],
        spec: "AgentRunSpec",
    ) -> list[dict[str, Any]]:
        """Truncate history to fit within context window budget."""
        if not messages or not spec.context_window_tokens:
            return messages

        provider_max_tokens = getattr(getattr(self.provider, "generation", None), "max_tokens", 4096)
        max_output = spec.max_tokens if isinstance(spec.max_tokens, int) else (
            provider_max_tokens if isinstance(provider_max_tokens, int) else 4096
        )
        budget = spec.context_block_limit or (
            spec.context_window_tokens - max_output - _SNIP_SAFETY_BUFFER
        )
        if budget <= 0:
            return messages

        estimate, _ = estimate_prompt_tokens_chain(
            self.provider,
            spec.model,
            messages,
            spec.tools.get_definitions(),
        )
        if estimate <= budget:
            return messages

        system_messages = [dict(msg) for msg in messages if msg.get("role") == "system"]
        non_system = [dict(msg) for msg in messages if msg.get("role") != "system"]
        if not non_system:
            return messages

        system_tokens = sum(estimate_message_tokens(msg, self.model) for msg in system_messages)
        remaining_budget = max(128, budget - system_tokens)
        kept: list[dict[str, Any]] = []
        kept_tokens = 0
        for message in reversed(non_system):
            msg_tokens = estimate_message_tokens(message, self.model)
            if kept and kept_tokens + msg_tokens > remaining_budget:
                break
            kept.append(message)
            kept_tokens += msg_tokens
        kept.reverse()

        if kept:
            for i, message in enumerate(kept):
                if message.get("role") == "user":
                    kept = kept[i:]
                    break
            else:
                # Recover nearest user message from outside the kept window;
                # GLM rejects system→assistant (error 1214). Budget is
                # intentionally exceeded — oversized beats invalid.
                for idx in range(len(non_system) - 1, -1, -1):
                    if non_system[idx].get("role") == "user":
                        kept = non_system[idx:]
                        break
            start = find_legal_message_start(kept)
            if start:
                kept = kept[start:]
        if not kept:
            kept = non_system[-min(len(non_system), 4):]
            start = find_legal_message_start(kept)
            if start:
                kept = kept[start:]
        return system_messages + kept
