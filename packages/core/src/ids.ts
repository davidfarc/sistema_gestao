/**
 * Identificadores com "branding" — impede trocar um CardId por um BoardId sem querer.
 * Em runtime são apenas strings uuid; o brand existe só no compilador.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Uuid = string;

export type OrganizationId = Brand<Uuid, "OrganizationId">;
export type UserId = Brand<Uuid, "UserId">;
export type TeamId = Brand<Uuid, "TeamId">;
export type RoleId = Brand<Uuid, "RoleId">;

export type BoardId = Brand<Uuid, "BoardId">;
export type StageId = Brand<Uuid, "StageId">;
export type CardId = Brand<Uuid, "CardId">;
export type VolumeId = Brand<Uuid, "VolumeId">;

export type FieldDefinitionId = Brand<Uuid, "FieldDefinitionId">;
export type ChecklistId = Brand<Uuid, "ChecklistId">;
export type AttachmentId = Brand<Uuid, "AttachmentId">;
export type EmendaId = Brand<Uuid, "EmendaId">;

export type CommentId = Brand<Uuid, "CommentId">;
export type ChannelId = Brand<Uuid, "ChannelId">;
export type MessageId = Brand<Uuid, "MessageId">;

export type AssignmentId = Brand<Uuid, "AssignmentId">;
export type WorkflowRuleId = Brand<Uuid, "WorkflowRuleId">;
export type ActivityId = Brand<Uuid, "ActivityId">;
export type NotificationId = Brand<Uuid, "NotificationId">;

/** Converte uma string qualquer no id "brandado" (usar só nas bordas: adaptadores/entrada). */
export function asId<B extends string>(value: Uuid): Brand<Uuid, B> {
  return value as Brand<Uuid, B>;
}
