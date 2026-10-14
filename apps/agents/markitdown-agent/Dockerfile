FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV MARKITDOWN_AGENT_HOST=0.0.0.0 \
    MARKITDOWN_AGENT_PORT=3013

EXPOSE 3013
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3013"]
