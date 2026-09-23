/**
 * Step-through captions for a program's tape, from its comments (examples,
 * or any imported file with comments). The header block, before OPENQASM, is
 * the program's description (examples.ts describeProgram) and is not reused.
 */
/** Declarations: they end a comment block without being steps. */
const DECL = /^(OPENQASM|include|qubit|qreg|bit|creg|input|gate|def)\b/;

/**
 * Step-through captions: for tape entry i (made by source line `lines[i]`),
 * the comment on that line if it has one, else the comment block above it
 * (the most recent one after a declaration). A block covers the statements
 * under it up to the next blank line or comment; the header block (before
 * OPENQASM) is the intro, not a caption.
 */
export function stepCaptions(text: string, lines: number[]): string[] {
  const src = text.split("\n");
  const byLine = new Map<number, string>(); // caption in force for code on each line (1-based)
  let block: string[] = [];
  let codeSince = true; // a statement since the block started: the next comment starts a new block
  src.forEach((raw, i) => {
    const line = raw.trim();
    const cut = line.indexOf("//");
    const code = (cut < 0 ? line : line.slice(0, cut)).trim();
    const comment = cut < 0 ? "" : line.slice(cut + 2).trim();
    if (/^note: QC-1 measured/.test(comment)) return;
    if (!code) {
      if (!comment) {
        if (codeSince) block = []; // a blank line after code ends the block's reach
        return;
      }
      if (codeSince) block = [];
      codeSince = false;
      block.push(comment);
      return;
    }
    codeSince = true;
    if (DECL.test(code)) {
      block = [];
      return;
    }
    byLine.set(i + 1, comment || block.join(" "));
  });
  return lines.map((l) => byLine.get(l) ?? "");
}
