FROM python:3.12-slim AS base

# LibreOffice for optional preview generation (matches pptx-agent runtime parity)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

COPY src ./src
COPY templates ./templates
COPY examples ./examples

ENV PPTX_TEMPLATE_AGENT_PORT=8081
EXPOSE 8081

CMD ["python", "-m", "pptx_template_agent.cli", "serve", "--port", "8081"]
