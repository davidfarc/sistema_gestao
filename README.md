# Sistema de Gestão Editorial — Editora Ecco Prime

Monorepo do sistema de produção editorial (Kanban + lista estilo Trello, comunicação
nativa, login Google com acesso restrito a externos), preparado para API/MCP.

- **Plano completo:** [`PLANO.md`](./PLANO.md)
- **Retomada / setup:** [`PROXIMOS-PASSOS.md`](./PROXIMOS-PASSOS.md)

## Stack

Supabase (Postgres + Auth + Realtime + Storage) · Next.js App Router + TypeScript ·
pnpm workspaces · arquitetura hexagonal-lite (`@ecco/core`).

## Estrutura

```
packages/core/             @ecco/core — domínio, ports, política de auth (sem Next/React/SDK de banco)
packages/adapters/supabase implementação dos ports (Postgres/Realtime/Auth/Storage)
apps/web/                  Next.js (UI + Server Actions)
infra/                     migrations SQL, policies RLS, seeds
```

## Desenvolvimento

Requisitos: Node ≥ 20 (usa-se 24), pnpm.

```bash
pnpm install       # ⚠️ pausar sync do Google Drive durante o install (node_modules)
pnpm typecheck
pnpm test
pnpm dev           # sobe o apps/web
```

> ⚠️ **Drive + git:** a árvore de trabalho fica na pasta do Google Drive, mas o
> **GitHub é a fonte de verdade do histórico**. Trabalhar em **uma máquina por vez**
> e transferir via `git push`/`pull` (não pelo sync do Drive). `node_modules` e
> `.next` estão no `.gitignore`.
