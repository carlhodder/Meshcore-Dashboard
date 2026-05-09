FROM python:3.12-slim

WORKDIR /app

# Install Node.js and curl
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user and data directory, fix permissions
RUN useradd -m meshcore \
    && chown -R meshcore:meshcore /app

USER meshcore

# Install frontend dependencies
RUN cd frontend && npm install

EXPOSE 8080

CMD uvicorn app:app --host 127.0.0.1 --port 8088 --reload & cd frontend && npm run dev -- --host 0.0.0.0 --port 8080
