from .anomalies import Anomaly, RowStyle, TableAnalysis, analyse_table
from .capacity import (
    TextCapacity,
    compute_capacity,
    compute_cell_capacity,
    will_overflow,
)
from .filler import FillReport, fill_deck
from .inspect import TemplateManifest, inspect_template
from .linter import (
    CellOverflowWarning,
    TableCollisionWarning,
    UnfilledWarning,
    lint_cell_overflows,
    lint_pptx,
    lint_table_collisions,
)
from .normalize import normalize_cell, normalize_row
from .placeholders import set_text_by_name
from .tables import apply_rag, set_table
from .template_fixup import CollisionFix, auto_resolve_collisions

__all__ = [
    "Anomaly",
    "CellOverflowWarning",
    "CollisionFix",
    "FillReport",
    "RowStyle",
    "TableAnalysis",
    "TableCollisionWarning",
    "TemplateManifest",
    "TextCapacity",
    "UnfilledWarning",
    "analyse_table",
    "apply_rag",
    "auto_resolve_collisions",
    "compute_capacity",
    "compute_cell_capacity",
    "fill_deck",
    "inspect_template",
    "lint_cell_overflows",
    "lint_pptx",
    "lint_table_collisions",
    "normalize_cell",
    "normalize_row",
    "set_table",
    "set_text_by_name",
    "will_overflow",
]
