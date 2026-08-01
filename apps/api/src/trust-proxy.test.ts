import Fastify from "fastify";
import { describe, expect, it } from "vitest";

describe("trusted proxy hop policy", () => {
  it("selects the nearest forwarded client and ignores a spoofed left chain", async () => {
    const app = Fastify({ trustProxy: 1 });
    app.get("/ip", async (request) => ({ ip: request.ip, ips: request.ips }));

    const response = await app.inject({
      method: "GET",
      url: "/ip",
      remoteAddress: "172.20.0.5",
      headers: {
        "x-forwarded-for": "1.2.3.4, 203.0.113.10",
      },
    });

    expect(response.json()).toEqual({
      ip: "203.0.113.10",
      ips: ["172.20.0.5", "203.0.113.10"],
    });
    await app.close();
  });
});
