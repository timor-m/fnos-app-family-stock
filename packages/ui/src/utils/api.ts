const appBasePath = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const apiBase = new URL("api/", new URL(appBasePath, window.location.origin));

export function apiUrl(path: string) {
  return new URL(path.replace(/^\//, ""), apiBase).toString();
}
