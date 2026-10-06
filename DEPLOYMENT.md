# AutoTune public deployment

## Architecture

- GitHub: source code
- Supabase: hosted PostgreSQL database
- Render: Node/Express API
- Render: FastAPI/scikit-learn ML service
- Vercel: React/Vite frontend

## 1. Supabase

Create a Supabase project. In the Supabase dashboard, open the database connection settings and copy a PostgreSQL connection string suitable for your deployment (prefer the pooler/session connection if Supabase recommends it for your project).

Do NOT commit the password or `.env` file.

The backend automatically creates these tables on startup:
- `metrics`
- `optimization_events`
- `app_config`

## 2. Deploy ML service on Render

Create a new Web Service from the GitHub repository.

Root directory:
`ml-service`

Build command:
`pip install -r requirements.txt && python train.py`

Start command:
`uvicorn app:app --host 0.0.0.0 --port $PORT`

After deployment, copy the ML service URL.

## 3. Deploy backend on Render

Create another Web Service from the same GitHub repository.

Root directory:
`backend`

Build command:
`npm ci`

Start command:
`npm start`

Environment variables:
- `DATABASE_URL` = Supabase PostgreSQL connection string
- `ML_SERVICE_URL` = deployed ML service URL
- `CORS_ORIGIN` = deployed Vercel frontend URL
- `DB_POOL_MAX` = `5`

Render gives the backend a public URL.

## 4. Deploy frontend on Vercel

Import the same GitHub repository.

Set the root directory to:
`frontend`

Build command:
`npm run build`

Output directory:
`dist`

Environment variable:
`VITE_API_BASE_URL` = deployed Render backend URL

Deploy.

## 5. Connect CORS

Copy the Vercel frontend URL into the backend's `CORS_ORIGIN` environment variable on Render.

If you later add another allowed frontend origin, separate origins with commas.

## 6. Important production notes

- Never commit `.env`, passwords, Supabase keys, or private credentials.
- The frontend should only contain public configuration.
- The Supabase database is persistent; Render's filesystem should not be treated as persistent storage.
- The demo simulator intentionally generates telemetry so the autonomous optimization loop can be demonstrated without real infrastructure load.
- Free hosting tiers may sleep when idle, so the first request after inactivity can be slower.
