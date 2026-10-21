# Image that runs Dlano (FastAPI server + crawled kiu.ac.ug content) on Cloudflare Containers.
FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY assistant.py knowledge.py server.py ./
COPY static ./static
COPY data ./data

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
