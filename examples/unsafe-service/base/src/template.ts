export const renderTemplate = (
  source: string,
  context: Record<string, string>
): string => source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? "")
