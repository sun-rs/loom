/** Owner scope: Chinese-only product chrome; retain official catalogs/provider. */
export function adaptChineseLocale(source: string) {
  const initial = `const locale = resolveInitialLocale({
    storage: window.localStorage,
    languages: window.navigator?.languages,
    search: window.location?.search,
  });`;
  if (source.split(initial).length !== 2)
    throw Error("Official locale initialization boundary changed");
  return source.replace(initial, 'const locale = "zh-cn" as const;');
}
