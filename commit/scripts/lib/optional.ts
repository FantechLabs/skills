export function normalizeOptionalText(value: string, sentinelValues: string[] = []): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const sentinels = new Set(sentinelValues.map((entry) => entry.trim()).filter(Boolean));
  if (sentinels.has(normalized)) {
    return null;
  }

  return normalized;
}
