import * as p from "@clack/prompts";

export function intro(message: string): void {
  p.intro(message);
}

export function outro(message: string): void {
  p.outro(message);
}

export function note(message: string, title?: string): void {
  p.note(message, title);
}

export function log(message: string): void {
  p.log.message(message);
}

export function success(message: string): void {
  p.log.success(message);
}

export function warn(message: string): void {
  p.log.warn(message);
}

export function error(message: string): void {
  p.log.error(message);
}

export async function confirm(message: string): Promise<boolean> {
  const result = await p.confirm({ message });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return result;
}
