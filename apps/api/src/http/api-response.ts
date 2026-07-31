import type { FastifyReply } from "fastify";

export function sendApiError(
  reply: FastifyReply,
  requestId: string,
  status: number,
  code: string,
  message: string,
) {
  return reply.status(status).send({
    data: null,
    error: { code, message, requestId },
  });
}

export function sendProjectNotFound(
  reply: FastifyReply,
  requestId: string,
) {
  return sendApiError(
    reply,
    requestId,
    404,
    "PROJECT_NOT_FOUND",
    "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.",
  );
}
