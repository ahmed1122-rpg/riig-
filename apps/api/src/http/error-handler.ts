import type { FastifyError, FastifyInstance } from "fastify";

interface PublicErrorDescriptor {
  statusCode: number;
  code: string;
  message: string;
}

export function registerHttpErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const descriptor = publicErrorDescriptor(error);
    if (descriptor.statusCode >= 500) {
      request.log.error(
        { err: error, request_id: request.id },
        "http.unhandled_error",
      );
    }
    return reply.status(descriptor.statusCode).send({
      data: null,
      error: {
        code: descriptor.code,
        message: descriptor.message,
        requestId: request.id,
      },
    });
  });
}

function publicErrorDescriptor(
  error: unknown,
): PublicErrorDescriptor {
  const fastifyError = error instanceof Error ? (error as FastifyError) : null;
  if (fastifyError?.validation) {
    return {
      statusCode: 400,
      code: "REQUEST_VALIDATION_FAILED",
      message: "بيانات الطلب غير صالحة.",
    };
  }

  const statusCode = normalizeStatusCode(fastifyError?.statusCode);
  if (statusCode >= 500) {
    return {
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "حدث خطأ داخلي غير متوقع. استخدم رقم الطلب عند التواصل مع الدعم.",
    };
  }

  return clientErrorDescriptor(statusCode);
}

function normalizeStatusCode(value: number | undefined): number {
  return value && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : 500;
}

function clientErrorDescriptor(statusCode: number): PublicErrorDescriptor {
  const known = new Map<number, Omit<PublicErrorDescriptor, "statusCode">>([
    [400, { code: "INVALID_REQUEST", message: "تعذر فهم الطلب المرسل." }],
    [401, { code: "AUTHENTICATION_REQUIRED", message: "يلزم تسجيل الدخول لإكمال الطلب." }],
    [403, { code: "REQUEST_FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذا الطلب." }],
    [404, { code: "NOT_FOUND", message: "المورد المطلوب غير موجود." }],
    [405, { code: "METHOD_NOT_ALLOWED", message: "طريقة الطلب غير مدعومة لهذا المسار." }],
    [408, { code: "REQUEST_TIMEOUT", message: "انتهت مهلة الطلب قبل اكتماله." }],
    [409, { code: "REQUEST_CONFLICT", message: "يتعارض الطلب مع الحالة الحالية." }],
    [413, { code: "PAYLOAD_TOO_LARGE", message: "حجم الطلب يتجاوز الحد المسموح." }],
    [415, { code: "UNSUPPORTED_MEDIA_TYPE", message: "نوع المحتوى المرسل غير مدعوم." }],
    [429, { code: "RATE_LIMITED", message: "تجاوزت حد الطلبات المسموح به." }],
  ]);
  const descriptor = known.get(statusCode) ?? {
    code: "REQUEST_REJECTED",
    message: "تعذر تنفيذ الطلب.",
  };
  return { statusCode, ...descriptor };
}
