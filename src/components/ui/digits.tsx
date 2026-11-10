// Times (a position, a duration: "2:08", "5:25") in the monospace face, of
// equal width so they do not jitter as they count. In a terminal, plain text.

import { Text } from "nsh";

/** A time in monospace digits. `class` takes the usual text classes (size,
 * colour, opacity, width, alignment). */
export function Digits(props: { children: string; class?: string }) {
  return <Text class={`font-mono tabular-nums ${props.class ?? ""}`}>{props.children}</Text>;
}
