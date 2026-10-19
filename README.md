# KlinikAid — Web Portal

**An AI-Assisted Web Platform for Automated Inquiry and Record Management**
Capstone project by **Healthioneers** · Client: **Bloodcare Medical Laboratory**, Rodriguez, Rizal

KlinikAid is a multi-role internal clinic management web portal. It centralizes patient queue management, document validation, departmental record entry, descriptive analytics, and a RAG-grounded AI chatbot for clinic inquiries — built for the staff and patients of a DOH-licensed diagnostic laboratory.

> This repository contains the **web portal** only. The companion mobile app (OCR scanning, patient mobile client) is maintained separately.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript |
| Styling | Tailwind CSS v3, shadcn/ui (`@base-ui/react`) |
| Database | Supabase PostgreSQL + pgvector |
| Auth | Supabase Auth (TOTP MFA) |
| Storage | Supabase Storage (private bucket) |
| AI | Google Gemini 2.5 Flash (chatbot + extraction), `gemini-embedding-001` (768-dim embeddings) |
| Charts | Recharts |
| Deployment | Vercel |

---

## User Roles

KlinikAid serves five roles, each with hard-enforced access boundaries: **Admin** (full oversight), **Receptionist** (queue & document review), **Department Staff** (own department records), **Medical Specialist** (read-only analytics), and **Patient** (own dashboard, chatbot, submissions).

---

## Quick Start

**Prerequisites:** Node.js 18+, npm, a Supabase project, a Gemini API key.

```bash
git clone <repository-url>
cd Klinikaid
npm install
```

1. Copy `.env.example` to `.env.local` and fill in your own values.
2. **Fresh Supabase project:** run `src/lib/db/schema.sql` once via the SQL editor or `psql` (see [database setup](documentation/DATABASE.md#database-setup)). It includes the current schema through migration 36; do not replay those migrations. **Existing database:** apply only `migration_N.sql` files newer than your recorded history, in order.
3. Run the dev server:

```bash
npm run dev
```

The portal runs at `http://localhost:3000`.

```bash
npm run build   # production build
```

---

## Documentation

Full developer documentation is in [`/documentation`](./documentation):

- [README](./documentation/README.md) — setup & environment reference
- [ARCHITECTURE](./documentation/ARCHITECTURE.md) — route groups, role gate, RAG flow
- [DATABASE](./documentation/DATABASE.md) — schema, migrations, RPCs
- [ROLES_AND_ROUTES](./documentation/ROLES_AND_ROUTES.md) — RBAC reference
- [CONVENTIONS](./documentation/CONVENTIONS.md) — coding standards & known limitations

---

## Project Status

Core development complete (Phases 1–10). Currently in evaluation preparation. This is an academic capstone project and is not licensed for production clinical use.
