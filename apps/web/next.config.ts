import type { NextConfig } from "next";

// Valores PÚBLICOS do Supabase (vão para o navegador de qualquer forma). Ficam
// aqui como padrão para o build do Cloudflare não depender de variáveis no painel.
// A chave secreta (SUPABASE_SECRET_KEY) NUNCA entra aqui: é segredo do Worker.
const SUPABASE_URL_PADRAO = "https://rcjjwoajuvnrgeuzsgsj.supabase.co";
const SUPABASE_PUBLISHABLE_PADRAO = "sb_publishable_rRJIWGymSGwpJ6o2eUUY0Q_TiCgQxer";

const nextConfig: NextConfig = {
  // @ecco/core é consumido como código-fonte TS (imports com extensão .ts),
  // então o Next transpila o pacote em vez de exigir build separado.
  transpilePackages: ["@ecco/core"],
  // Prisma (Novos alunos): fica fora do bundle do Next; o OpenNext empacota a
  // versão para Workers (guia "Prisma ORM" do @opennextjs/cloudflare).
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL_PADRAO,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_PUBLISHABLE_PADRAO,
  },
};

export default nextConfig;

// Permite usar recursos do Cloudflare no `next dev` (hospedagem: Cloudflare Workers via OpenNext).
// Só no `next dev`: no build ele exigiria um Postgres local para emular o
// Hyperdrive (binding ANAMNESE_DB) e derrubava o build do Cloudflare.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();
