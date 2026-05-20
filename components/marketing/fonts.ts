import {
  Bricolage_Grotesque,
  Instrument_Serif,
  JetBrains_Mono,
} from 'next/font/google'

/**
 * Marketing typography stack.
 *
 * SKILL.md is explicit: avoid generic system fonts (Inter, Roboto, Arial),
 * pair a distinctive display face with a refined body face, and commit to
 * a clear typographic point of view.
 *
 * - Instrument Serif (italic-friendly, high contrast) carries the editorial
 *   display headlines and the big "P" mark.
 * - Bricolage Grotesque is the body / UI face — modern, slightly weird,
 *   variable, and not on the AI-slop shortlist.
 * - JetBrains Mono is the technical / numeric voice used for ticker tape,
 *   labels, captions, and any "command palette"-style detail.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display',
})

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-mono-marketing',
})

export const marketingFontVariables = {
  display: instrumentSerif,
  body: bricolage,
  mono: jetbrains,
}

export const marketingFontVariableClasses = [
  instrumentSerif.variable,
  bricolage.variable,
  jetbrains.variable,
].join(' ')
