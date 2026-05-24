"""Template-injection PowerPoint agent.

Composes .pptx decks by filling content into the named shapes of an existing
template — the template's slide masters, layouts, fonts and colors are kept
intact. Use the `injection` package directly for in-process integration, or
run the FastAPI server / CLI for service-style invocation.
"""

__version__ = "0.1.0"
