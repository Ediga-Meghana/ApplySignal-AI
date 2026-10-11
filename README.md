# ApplySignal AI

An AI-powered career-management application built with React, TypeScript, Vite, and Supabase.

Features include:
- Job opportunity tracking with CSV/JSON import
- Job application management
- Skill analysis and learning tasks
- Resume text extraction and optional OCR
- Optional read-only Gmail opportunity import
- Supabase authentication and PostgreSQL storage
- Optional AI-powered analysis and email reminders

## Local Setup

Install dependencies:

```bash
npm ci
```

Create your local environment file in Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Add your Supabase project URL and public anon/publishable key to `.env` using the variable names expected by the project.

Start the development server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

## Supabase Setup

For a fresh Supabase project, run `supabase/schema.sql` once in the Supabase SQL Editor.

Configure email authentication and the allowed redirect URLs in Supabase. Keep Row Level Security enabled.

## AI Setup

AI analysis requires the Supabase `ai` Edge Function and a supported provider API key configured as a server-side Supabase secret.

Never place private AI API keys or Supabase service-role keys in frontend code, `.env` files committed to GitHub, or public repositories.

## Testing

```bash
npm run typecheck
npm test
npm run build
npm run test:functions
```

Some optional database and end-to-end tests require additional local tools or dedicated test credentials.

## Important Notes

- CSV/JSON imports support job-opportunity records; check the app's import requirements for supported columns.
- Gmail import is optional and requires Google OAuth configuration.
- Email reminder delivery requires additional server-side configuration.
- Live AI requests and deployment must be tested using your own configured accounts.

## Security

Keep `.env` private. Commit `.env.example` only if it contains placeholders and no real secrets.