import { createSecurityGuardsHandler } from "./handler.ts";

Deno.serve(createSecurityGuardsHandler());
