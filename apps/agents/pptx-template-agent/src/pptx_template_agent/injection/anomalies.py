"""Table style analysis: per-cell / per-row font size, row classification,
and anomaly detection.

Anomalies fall out as a side-effect of computing the row schema — a row
whose modal pt differs from the table body mode is the same signal you'd
get from a deviation check. Surfacing both lets the agent (and the filler)
make informed decisions about where content belongs.
"""

from __future__ import annotations

from collections import Counter
from typing import Literal, TypedDict

DEVIATION_RATIO = 1.3   # ratio above which a difference counts as significant
DEVIATION_PT = 4.0      # or absolute pt delta

RowKind = Literal["header", "section_divider", "body"]


class CellStyle(TypedDict):
    row: int
    col: int
    font_pt: float | None
    is_empty: bool


class RowStyle(TypedDict):
    row: int
    kind: RowKind
    modal_pt: float | None
    non_empty_cells: int


class Anomaly(TypedDict):
    kind: Literal["cell_font_outlier", "row_font_outlier"]
    row: int
    col: int | None
    current_pt: float
    expected_pt: float
    deviation_ratio: float
    sample_text: str


class TableAnalysis(TypedDict):
    body_modal_pt: float | None
    rows: list[RowStyle]
    cells: list[CellStyle]
    anomalies: list[Anomaly]


def _cell_font_pt(cell) -> float | None:
    """First run with an explicit font size in any paragraph of the cell."""
    for para in cell.text_frame.paragraphs:
        # Paragraph-level default (pPr/defRPr) can carry size — try last
        for run in para.runs:
            if run.font.size is not None:
                return run.font.size.pt
    return None


def _mode_pt(values: list[float | None]) -> float | None:
    pts = [v for v in values if v is not None]
    if not pts:
        return None
    counts = Counter(pts)
    return counts.most_common(1)[0][0]


def _classify_row(cells: list, sizes: list[float | None], row_index: int) -> RowKind:
    if row_index == 0:
        return "header"
    non_empty = sum(1 for c in cells if c.text.strip())
    if non_empty <= 1:
        return "section_divider"
    return "body"


def analyse_table(table) -> TableAnalysis:
    """Compute per-cell / per-row font stats and surface anomalies."""
    n_rows = len(table.rows)
    n_cols = len(table.columns)

    cells_data: list[CellStyle] = []
    rows_data: list[RowStyle] = []
    row_modes: list[float | None] = []

    for r in range(n_rows):
        row_cells = [table.cell(r, c) for c in range(n_cols)]
        row_sizes = [_cell_font_pt(c) for c in row_cells]
        for c, (cell, sz) in enumerate(zip(row_cells, row_sizes)):
            cells_data.append(CellStyle(
                row=r, col=c, font_pt=sz, is_empty=not cell.text.strip()
            ))
        kind = _classify_row(row_cells, row_sizes, r)
        row_mode = _mode_pt(row_sizes)
        row_modes.append(row_mode if kind == "body" else None)
        rows_data.append(RowStyle(
            row=r, kind=kind, modal_pt=row_mode,
            non_empty_cells=sum(1 for c in row_cells if c.text.strip()),
        ))

    body_modal = _mode_pt(row_modes)

    anomalies: list[Anomaly] = []

    # Row-level outliers (compare body rows to table body mode)
    if body_modal is not None:
        for row in rows_data:
            if row["kind"] != "body" or row["modal_pt"] is None:
                continue
            pt = row["modal_pt"]
            ratio = max(pt, body_modal) / min(pt, body_modal)
            if abs(pt - body_modal) >= DEVIATION_PT or ratio >= DEVIATION_RATIO:
                anomalies.append(Anomaly(
                    kind="row_font_outlier",
                    row=row["row"], col=None,
                    current_pt=pt, expected_pt=body_modal,
                    deviation_ratio=ratio,
                    sample_text=table.cell(row["row"], 0).text[:60],
                ))

    # Cell-level outliers (compare each body cell to its row mode)
    for row in rows_data:
        if row["kind"] != "body" or row["modal_pt"] is None:
            continue
        row_mode = row["modal_pt"]
        for c in range(n_cols):
            cell_data = cells_data[row["row"] * n_cols + c]
            pt = cell_data["font_pt"]
            if pt is None or cell_data["is_empty"]:
                continue
            ratio = max(pt, row_mode) / min(pt, row_mode)
            if abs(pt - row_mode) >= DEVIATION_PT or ratio >= DEVIATION_RATIO:
                anomalies.append(Anomaly(
                    kind="cell_font_outlier",
                    row=row["row"], col=c,
                    current_pt=pt, expected_pt=row_mode,
                    deviation_ratio=ratio,
                    sample_text=table.cell(row["row"], c).text[:40],
                ))

    return TableAnalysis(
        body_modal_pt=body_modal,
        rows=rows_data,
        cells=cells_data,
        anomalies=anomalies,
    )
