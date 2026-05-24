from __future__ import annotations

from docx_template_agent.injection.tokens import (
    find_tokens_in,
    iter_unique_tokens,
    normalize_token,
    replace_tokens,
)


def test_find_uppercase_token():
    assert find_tokens_in("Hello [COMPANY NAME] world") == ["[COMPANY NAME]"]


def test_find_mixed_case_token():
    """Bracket tokens with a capital first letter and any-case body."""
    assert find_tokens_in("Office: [Assistant]") == ["[Assistant]"]


def test_does_not_match_prose_brackets():
    """Lowercase-first and numeric-only brackets are intentionally skipped."""
    assert find_tokens_in("see [note]") == []
    assert find_tokens_in("ref [1]") == []
    assert find_tokens_in("[a]") == []


def test_normalize_token_is_stable():
    assert normalize_token("[COMPANY NAME]") == "company_name"
    assert normalize_token("[Contact Person]") == "contact_person"
    assert normalize_token("[Phone & Fax]") == "phone_fax"


def test_replace_tokens_substitutes_known_only():
    new, n = replace_tokens(
        "[COMPANY NAME] at [COMPANY ADDRESS]",
        {"company_name": "Blixt Group"},
    )
    assert new == "Blixt Group at [COMPANY ADDRESS]"
    assert n == 1


def test_iter_unique_tokens_preserves_order():
    toks = iter_unique_tokens([
        "[ONE] then [TWO]",
        "[ONE] again",
        "[THREE]",
    ])
    assert toks == ["[ONE]", "[TWO]", "[THREE]"]
