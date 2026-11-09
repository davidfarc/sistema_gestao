import type { NextConfig } from "next";

// Valores PÚBLICOS do Supabase (vão para o navegador de qualquer forma). Ficam
// aqui como padrão para o build do Cloudflare não depender de variáveis no painel.
// A chave secreta (SUPABASE_SERVICE_ROLE_KEY) NUNCA entra aqui: é segredo do Worker.
const SUPABASE_URL_PADRAO = "https://njdocgzzuhhlaweqqnrq.supabase.co";
const SUPABASE_PUBLISHABLE_PADRAO = "sb_publishable_wLw4WXpo48ueNtU9f_Gy8A_r0d6W-2p";

const nextConfig: NextConfig = {
  // @ecco/core é consumido como código-fonte TS (imports com extensão .ts),
  // então o Next transpila o pacote em vez de exigir build separado.
  transpilePackages: ["@ecco/core"],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL_PADRAO,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_PUBLISHABLE_PADRAO,
  },
};

export default nextConfig;

// Permite usar recursos do Cloudflare no `next dev` (hospedagem: Cloudflare Workers via OpenNext).
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
