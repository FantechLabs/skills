export function wrapCommitBody(body: string, maxLineLength: number = 100): string {
  if (maxLineLength <= 0) {
    return body;
  }

  return body
    .split("\n")
    .flatMap((line) => wrapLine(line, maxLineLength))
    .join("\n");
}

function wrapLine(line: string, maxLineLength: number): string[] {
  if (!line.trim()) {
    return [line];
  }

  const words = line.trim().split(/\s+/);
  const wrapped: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
      continue;
    }

    const candidate = `${currentLine} ${word}`;
    if (candidate.length > maxLineLength) {
      wrapped.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine) {
    wrapped.push(currentLine);
  }

  return wrapped;
}
