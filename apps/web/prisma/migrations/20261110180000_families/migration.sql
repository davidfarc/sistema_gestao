-- Cadastro de famílias: o e-mail de quem agenda é a chave da jornada do cliente.
-- Cria Family/Guardian/Student, liga Appointment a eles e agrupa os agendamentos já existentes.

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "guardianId" TEXT,
ADD COLUMN     "studentId" TEXT;

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "relationship" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "activesoftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentClass" TEXT,
    "birthDate" DATE,
    "activesoftId" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Family_email_key" ON "Family"("email");

-- CreateIndex
CREATE INDEX "Guardian_familyId_idx" ON "Guardian"("familyId");

-- CreateIndex
CREATE INDEX "Student_familyId_idx" ON "Student"("familyId");

-- CreateIndex
CREATE INDEX "Appointment_familyId_idx" ON "Appointment"("familyId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Carga inicial a partir dos agendamentos existentes ─────────────────────
-- Nomes comparados sem diferença de maiúsculas e espaços repetidos.
-- Agendamentos já anonimizados (LGPD) ficam de fora.

CREATE TEMP TABLE _src AS
SELECT a.id,
       lower(trim(a.email))                                          AS email,
       regexp_replace(trim(a."guardianName"), '\s+', ' ', 'g')       AS guardian,
       regexp_replace(trim(a."studentName"),  '\s+', ' ', 'g')       AS student,
       a."studentClass", a.phone, a."createdAt"
  FROM "Appointment" a
 WHERE a."anonymizedAt" IS NULL AND a.email <> '';

INSERT INTO "Family" (id, email, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, email, min("createdAt"), now()
  FROM _src GROUP BY email;

-- Responsáveis: um por nome dentro da família; telefone do agendamento mais recente;
-- principal = quem agendou primeiro.
INSERT INTO "Guardian" (id, "familyId", name, phone, "isPrimary", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, f.id, g.guardian, g.phone, g.rn_first = 1, g.first_at, now()
  FROM (
    SELECT DISTINCT ON (email, lower(guardian))
           email, guardian, phone,
           min("createdAt") OVER (PARTITION BY email, lower(guardian)) AS first_at,
           dense_rank() OVER (PARTITION BY email ORDER BY min_at)      AS rn_first
      FROM (SELECT s.*, min("createdAt") OVER (PARTITION BY email, lower(guardian)) AS min_at FROM _src s) x
     ORDER BY email, lower(guardian), "createdAt" DESC
  ) g
  JOIN "Family" f ON f.email = g.email;

-- Alunos: um por nome dentro da família; turma mais recente informada.
INSERT INTO "Student" (id, "familyId", name, "studentClass", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, f.id, st.student, st."studentClass", st.first_at, now()
  FROM (
    SELECT DISTINCT ON (email, lower(student))
           email, student,
           first_value("studentClass") OVER (PARTITION BY email, lower(student)
                                             ORDER BY ("studentClass" IS NULL), "createdAt" DESC) AS "studentClass",
           min("createdAt") OVER (PARTITION BY email, lower(student)) AS first_at
      FROM _src
     ORDER BY email, lower(student), "createdAt" DESC
  ) st
  JOIN "Family" f ON f.email = st.email;

UPDATE "Appointment" a
   SET "familyId" = f.id, "guardianId" = g.id, "studentId" = st.id
  FROM _src s
  JOIN "Family"   f  ON f.email = s.email
  JOIN "Guardian" g  ON g."familyId" = f.id AND lower(g.name)  = lower(s.guardian)
  JOIN "Student"  st ON st."familyId" = f.id AND lower(st.name) = lower(s.student)
 WHERE a.id = s.id;

DROP TABLE _src;
