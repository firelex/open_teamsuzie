"""Bracket-token detection.

Many house-style docx templates use literal `[BRACKETED TOKENS]` as informal
placeholders (e.g. `[COMPANY NAME]`, `[CONTACT PERSON]`). They are not
proper Word content controls, just text — but they're a reliable
template-author convention.

The detector finds every such token in body + headers + footers and
returns a normalized representation. A separate primitive (controls.py)
can optionally upgrade them into real `<w:sdt>` content controls at
ingestion so future fills can address them as structured anchors."""

from __future__ import annotations

import re
from collections.abc import Iterable

# A bracket token: opening `[`, then a leading capital letter, then 1-40
# chars of letters/digits/space/&/. etc, then closing `]`. The leading
# capital rules out prose like "[note]" or "[1]" while still catching
# both all-caps ("[COMPANY NAME]") and mixed-case ("[Assistant]") tokens.
_TOKEN_RE = re.compile(r"\[([A-Z][A-Za-z0-9 &./\-]{1,40})\]")


def find_tokens_in(text: str) -> list[str]:
    """Return the raw bracketed tokens (including brackets) found in `text`."""
    return [m.group(0) for m in _TOKEN_RE.finditer(text)]


def normalize_token(token: str) -> str:
    """Convert `[COMPANY NAME]` -> `company_name`. Stable across runs and
    safe to use as a key in the spec / API."""
    inner = token.strip("[]").strip()
    return re.sub(r"[^a-z0-9]+", "_", inner.lower()).strip("_")


def replace_tokens(text: str, values: dict[str, str]) -> tuple[str, int]:
    """Replace every `[TOKEN]` in `text` whose normalized name is a key in
    `values`. Returns the new text + count of replacements."""
    count = 0

    def _sub(m: re.Match[str]) -> str:
        nonlocal count
        name = normalize_token(m.group(0))
        if name in values:
            count += 1
            return values[name]
        return m.group(0)

    return _TOKEN_RE.sub(_sub, text), count


def iter_unique_tokens(texts: Iterable[str]) -> list[str]:
    """Across a collection of text frames, return the unique bracket tokens
    in first-seen order."""
    seen: dict[str, None] = {}
    for text in texts:
        for tok in find_tokens_in(text):
            if tok not in seen:
                seen[tok] = None
    return list(seen.keys())
