FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY apps/agents/xlsx-agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/agents/xlsx-agent/app ./app
COPY apps/agents/xlsx-agent/templates ./templates
COPY apps/agents/xlsx-agent/.env.example ./.env

EXPOSE 3012

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3012"]
