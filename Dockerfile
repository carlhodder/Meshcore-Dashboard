FROM node:lts-trixie

ENV CI=true

# Install Node.js, curl, and pnpm
RUN apt-get update && apt-get install -y curl python3 python3-venv python3-pip \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

# Copy package files first
RUN mkdir -p /pnpm-store 
COPY frontend/package.json pnpm-*.yml frontend/

# Install frontend dependencies
RUN cd frontend && pnpm config set store-dir /pnpm-store && pnpm install

# Copy application code
COPY . .

EXPOSE 8080

CMD /bin/bash -c '(trap "kill 0" INT TERM; python3 -m debugpy --listen 0.0.0.0:5678 -m uvicorn app:app --host 127.0.0.1 --port 8088 --reload & cd frontend && pnpm run dev --host 0.0.0.0 --port 8080 & wait) 2>&1'