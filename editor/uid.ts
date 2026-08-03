/* ------------------------------------------------------------------ */
/*  Unique id helpers                                                   */
/*                                                                      */
/*  Used to generate identifiers for layers, panels, history entries,   */
/*  etc. Centralised so a future change (e.g. crypto.randomUUID) lands  */
/*  in one place. Prior to consolidation this was reimplemented 6+      */
/*  times across the editor.                                            */
/* ------------------------------------------------------------------ */

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}
