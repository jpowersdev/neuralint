export const renderTemplate = (
  source: string,
  context: Record<string, string>
): string => Function("context", `with (context) { return \`${source}\` }`)(context)
