import type { Action } from "@ecco/core";

/**
 * Tradução das permissões para a linguagem de quem administra o sistema.
 *
 * O identificador técnico ("card:move") não diz nada a quem precisa decidir o
 * escopo de uma função. Cada entrada abaixo responde a uma pergunta prática:
 * o que essa pessoa consegue fazer, e o que acontece se eu desmarcar isto.
 */
export interface ActionInfo {
  action: Action;
  label: string;
  hint: string;
}

export interface ActionGroup {
  title: string;
  items: ActionInfo[];
}

export const ACTION_GROUPS: ActionGroup[] = [
  {
    title: "Quadros e cards",
    items: [
      { action: "board:read", label: "Ver quadros", hint: "Abrir os pipelines a que tem acesso." },
      { action: "card:read", label: "Ver cards", hint: "Abrir e ler os cards." },
      { action: "card:create", label: "Criar cards", hint: "Abrir novas demandas e tarefas." },
      { action: "card:update", label: "Editar cards", hint: "Alterar título, descrição e propriedades." },
      { action: "card:move", label: "Mover entre etapas", hint: "Arrastar o card no Kanban." },
      { action: "card:assign", label: "Definir responsável", hint: "Atribuir cards a outras pessoas." },
      { action: "comment:create", label: "Comentar", hint: "Escrever nos comentários e mencionar." },
    ],
  },
  {
    title: "Configuração dos pipelines",
    items: [
      {
        action: "board:configure",
        label: "Gerenciar pipelines",
        hint: "Criar, renomear, arquivar e definir quem acessa cada pipeline.",
      },
      { action: "stage:manage", label: "Configurar etapas", hint: "Criar e reordenar as colunas." },
      {
        action: "field:manage",
        label: "Configurar propriedades",
        hint: "Criar e editar os campos dos cards.",
      },
      {
        action: "workflow:manage",
        label: "Configurar automações",
        hint: "Regras que travam ou liberam a passagem entre etapas.",
      },
    ],
  },
  {
    title: "Conversas",
    items: [
      { action: "channel:read", label: "Ver conversas", hint: "Acessar os canais." },
      { action: "channel:post", label: "Escrever nas conversas", hint: "Enviar mensagens." },
      { action: "channel:manage", label: "Gerenciar canais", hint: "Criar e editar grupos." },
    ],
  },
  {
    title: "Módulos e administração",
    items: [
      {
        action: "salas:manage",
        label: "Editar a Gestão de Vila",
        hint: "Sem esta permissão o módulo continua visível, mas só para consulta e simulação.",
      },
      {
        action: "user:manage",
        label: "Gerenciar usuários e papéis",
        hint: "Convidar pessoas, trocar papéis e editar permissões. É o acesso mais amplo do sistema.",
      },
    ],
  },
];

/** Ações que caracterizam poder de gestão — vedadas a usuário externo. */
export const ACOES_DE_GESTAO: Action[] = ["user:manage", "board:configure", "role:manage"];

/**
 * Papel administrativo: conceder um destes é conceder controle sobre o próprio
 * controle de acesso. Por isso só o Gestor Master pode atribuí-lo — um Gestor
 * comum, que administra usuários, não promove ninguém a Gestor.
 */
export function ehPapelAdministrativo(perms: Action[]): boolean {
  return perms.includes("role:manage") || perms.includes("user:manage");
}

const LABELS = new Map(
  ACTION_GROUPS.flatMap((g) => g.items).map((i) => [i.action, i.label] as const),
);

/** Nome amigável de uma permissão (cai no identificador se for desconhecida). */
export function actionLabel(action: Action): string {
  return LABELS.get(action) ?? action;
}
