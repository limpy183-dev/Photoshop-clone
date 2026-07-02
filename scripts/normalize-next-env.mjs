#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const target = resolve(process.cwd(), "next-env.d.ts")
const devRoutesImport = 'import "./.next/dev/types/routes.d.ts";'
const buildRoutesImport = 'import "./.next/types/routes.d.ts";'

let source = readFileSync(target, "utf8")
source = source.replace(devRoutesImport, buildRoutesImport)
writeFileSync(target, source)
