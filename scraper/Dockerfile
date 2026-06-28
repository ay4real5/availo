# Scraper image: Node (supervisor + coordinator) + Python (worker) in one.
# Used for two Render services from the same image:
#   - the scraper worker:  CMD `node supervisor.js`
#   - the mock target:     command `python mock_site/server.py`
FROM node:20-bookworm-slim

# Python runtime for the worker.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
    && ln -sf /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps (dotenv) for the supervisor/coordinator.
COPY package.json ./
RUN npm install --omit=dev

# Python deps for the worker.
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Playwright Chromium + its OS libraries (only needed when USE_PLAYWRIGHT=true).
# Comment this line out to build a much smaller image if you don't use the
# real-browser discovery path.
RUN python3 -m playwright install --with-deps chromium

# App source.
COPY . .

ENV PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PYTHON_BIN=python3

# Default: run the scraper supervisor. The mock service overrides this command.
CMD ["node", "supervisor.js"]
