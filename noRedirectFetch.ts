/** Prevents Fetch from replaying a request body or credentials to a redirect target. */
export function fetchNoRedirect(url: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, redirect: "error" });
}