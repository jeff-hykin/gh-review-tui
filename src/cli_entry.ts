import { buildCLI } from "./cli.ts"
await buildCLI().parse(Deno.args)
