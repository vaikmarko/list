/**
 * Catchall function /migrations/* path-ile. Cloudflare Pages Functions
 * routitakse ENNE static asset'i serveerimist - see f6lab et migrations
 * kataloogi failid ei oleks avalikud, kuigi nad on Pages deploy bundles.
 *
 * (Failid on n\u00e4htavad GitHub'is, aga seal nad on git repo osana ootuselased.
 * Avaliku list.ee URLi alt tahame neid hoida.)
 */
export const onRequest: PagesFunction = async () => {
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
};
