/**
 * Depois de uma publicação nova, uma aba que ficou aberta pode pedir arquivos
 * da versão anterior, que não existem mais ("ChunkLoadError"). Nesse caso a
 * solução é só recarregar a página, uma vez (para não entrar em laço).
 */
export function isStaleBuildError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Failed to find Server Action/i.test(text);
}

export function reloadOnceForStaleBuild(): boolean {
  try {
    const key = "ecco_recarregou_versao";
    const last = Number(window.sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 30_000) return false; // já tentou há pouco
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Sem armazenamento: recarrega mesmo assim (no pior caso, uma vez a mais).
  }
  window.location.reload();
  return true;
}
