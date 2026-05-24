"""Slot detection: find numbered badges (ovals, rectangles) that anchor
sub-sections of a multi-section text frame.

Many IC / pitch templates place 4 small numbered ovals (1, 2, 3, 4) over a
single tall content placeholder. Each oval visually anchors one section of
the content. Without slot awareness, naïve injection dumps all content into
the first section.

The detector finds digit-badge shapes (small, text-only-digit) whose x-centre
lies within the text frame's horizontal band. Their y-positions define the
slot anchors."""

from __future__ import annotations

from typing import TypedDict

EMU_PER_INCH = 914400
MAX_BADGE_DIM = 0.6 * EMU_PER_INCH   # badges are small — under 0.6" each side
MIN_FRAME_HEIGHT = 1.5 * EMU_PER_INCH  # frame must be tall enough to hold multiple slots


class SlotInfo(TypedDict):
    count: int
    labels: list[str]
    y_positions_in: list[float]
    x_anchor_in: float
    line_height_pt: float       # estimated; used for paragraph padding


def _is_digit_badge(shape) -> int | None:
    if not shape.has_text_frame:
        return None
    if not shape.width or not shape.height:
        return None
    if shape.width > MAX_BADGE_DIM or shape.height > MAX_BADGE_DIM:
        return None
    text = shape.text_frame.text.strip()
    if not text or not text.isdigit() or len(text) > 2:
        return None
    try:
        return int(text)
    except ValueError:
        return None


Y_BUFFER_EMU = 1 * EMU_PER_INCH    # how far a badge can sit above/below the frame


def detect_slots(slide, frame_shape, font_pt: float | None = None) -> SlotInfo | None:
    """Return slot info if the given frame_shape has 2+ digit badges
    positioned within its horizontal band and vertical neighbourhood.

    Skips badge-like shapes themselves (a digit-only badge can't be a
    multi-slot container)."""
    if not frame_shape.width or not frame_shape.height:
        return None
    # Don't return slots for a shape that IS itself a badge, or for shapes
    # too short to plausibly hold multiple sections.
    if _is_digit_badge(frame_shape) is not None:
        return None
    if frame_shape.height < MIN_FRAME_HEIGHT:
        return None
    frame_left = frame_shape.left
    frame_right = frame_shape.left + frame_shape.width
    frame_top = frame_shape.top - Y_BUFFER_EMU
    frame_bottom = frame_shape.top + frame_shape.height + Y_BUFFER_EMU

    badges = []
    for s in slide.shapes:
        if s is frame_shape:
            continue
        d = _is_digit_badge(s)
        if d is None:
            continue
        cx = s.left + s.width // 2
        cy = s.top + s.height // 2
        if not (frame_left <= cx <= frame_right):
            continue
        if not (frame_top <= cy <= frame_bottom):
            continue
        badges.append((d, cx, cy))

    if len(badges) < 2:
        return None

    badges.sort(key=lambda b: b[2])  # sort by y

    # Read the actual line spacing the template declares for this frame so
    # slot-padding math matches PowerPoint's rendering. Falls back to the
    # 1.2 OOXML default only when no <a:lnSpc> is declared anywhere in the
    # inheritance chain.
    from .capacity import _resolve_line_height_pt
    line_height_pt = _resolve_line_height_pt(frame_shape, font_pt or 12.0)

    return SlotInfo(
        count=len(badges),
        labels=[str(b[0]) for b in badges],
        y_positions_in=[b[2] / EMU_PER_INCH for b in badges],
        x_anchor_in=badges[0][1] / EMU_PER_INCH,
        line_height_pt=line_height_pt,
    )
