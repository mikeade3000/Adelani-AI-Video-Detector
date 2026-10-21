// Cloudflare Worker that forwards every request to the Dlano container (Dockerfile).
import { Container, getContainer } from "@cloudflare/containers";

export class DlanoServer extends Container {
  defaultPort = 8000;
  // Shut the container down after 15 quiet minutes; the next visitor starts it again (a few seconds).
  sleepAfter = "15m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || "",
      KIU_MODEL: env.KIU_MODEL || "claude-opus-5-5",
    };
  }
}

export default {
  async fetch(request, env) {
    if (!env.ANTHROPIC_API_KEY && new URL(request.url).pathname.startsWith("/api/ask")) {
      return Response.json({ detail: "ANTHROPIC_API_KEY secret is not set on the Cloudflare Worker." }, { status: 500 });
    }
    // One shared instance is plenty for a university help line.
    return getContainer(env.DLANO).fetch(request);
  },
};
