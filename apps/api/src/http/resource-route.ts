import type { FastifyReply, FastifyRequest } from "fastify";

type ErrorResponder = (
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) => unknown;

interface ResourceRouteOptions<Resource> {
  parseId: (params: unknown) => string | undefined;
  load: (id: string) => Promise<Resource>;
  handle: (resource: Resource, id: string) => unknown | Promise<unknown>;
  onError: ErrorResponder;
}

export async function runResourceRoute<Resource>(
  request: FastifyRequest,
  reply: FastifyReply,
  options: ResourceRouteOptions<Resource>,
): Promise<unknown> {
  const id = options.parseId(request.params);
  if (!id) return reply.status(404).send();

  try {
    const resource = await options.load(id);
    return await options.handle(resource, id);
  } catch (error) {
    return options.onError(error, request, reply);
  }
}
