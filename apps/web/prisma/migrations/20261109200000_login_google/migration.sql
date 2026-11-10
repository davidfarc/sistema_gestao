-- Integração ao sistema de gestão: o login passa a ser pelo Google (Supabase Auth).
-- A senha local deixa de ser obrigatória (contas novas não têm senha).
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
