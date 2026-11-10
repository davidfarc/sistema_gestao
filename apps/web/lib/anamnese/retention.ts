import { prisma } from "./db";
import { getSettings } from "./settings";

/**
 * Retenção LGPD: após `retentionMonths` do atendimento, os dados pessoais são anonimizados
 * (contagens e relatórios continuam válidos) e e-mails enviados com dados pessoais são apagados.
 * Famílias sem matrícula cujos agendamentos já foram todos anonimizados são apagadas.
 */
export async function runRetention(now = new Date()) {
  const s = await getSettings();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - s.retentionMonths);

  const anonymized = await prisma.appointment.updateMany({
    where: { startsAt: { lt: cutoff }, anonymizedAt: null },
    data: {
      guardianName: "Dado anonimizado",
      studentName: "Dado anonimizado",
      studentClass: null,
      phone: "",
      email: "anonimizado@invalid",
      consentIp: null,
      anonymizedAt: now,
    },
  });
  // Cadastro de famílias: sem matrícula e sem nenhum agendamento ainda com dados
  // pessoais, a família (responsáveis e alunos) é apagada. Quem se matriculou
  // fica: os dados passam a fazer parte da matrícula.
  const families = await prisma.family.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      appointments: { none: { anonymizedAt: null } },
      students: { none: { OR: [{ enrolledAt: { not: null } }, { activesoftId: { not: null } }] } },
    },
  });
  const mailCutoff = new Date(now.getTime() - 90 * 86400_000);
  const mails = await prisma.notification.deleteMany({
    where: { status: { in: ["SENT", "SKIPPED", "FAILED"] }, createdAt: { lt: mailCutoff } },
  });
  return { anonymized: anonymized.count, familiesDeleted: families.count, notificationsDeleted: mails.count };
}
