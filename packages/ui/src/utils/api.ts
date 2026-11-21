const appBasePath = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const apiBase = new URL("api/", new URL(appBasePath, window.location.origin));

export function apiUrl(path: string) {
  return new URL(path.replace(/^\//, ""), apiBase).toString();
}

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  statusMessage?: string;
  message?: string;
  error?: boolean | {
    message?: string;
  };
};

function errorText(payload: ApiEnvelope<unknown> | null, status: number) {
  if (payload && typeof payload.error === "object" && payload.error.message) {
    return payload.error.message;
  }
  if (payload?.statusMessage) return payload.statusMessage;
  if (payload?.message) return payload.message;
  return `${fallbackStatusMessage(status)}（HTTP ${status}）`;
}

function fallbackStatusMessage(status: number) {
  if (status === 401) return "请先登录后再操作";
  if (status === 403) return "当前账号没有权限执行该操作";
  if (status === 404) return "请求的接口不存在，请检查应用版本是否匹配";
  if (status >= 500) return "服务器暂时不可用，请稍后重试";
  return "请求失败";
}

export async function request<T>(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...init?.headers
      }
    });
  } catch {
    throw new Error("无法连接服务器，请检查 fnOS 网关或应用服务状态");
  }

  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      const detail = text.replace(/\s+/g, " ").trim().slice(0, 120);
      throw new Error(`${fallbackStatusMessage(response.status)}（HTTP ${response.status}${detail ? `：${detail}` : ""}）`);
    }
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(errorText(payload, response.status));
  }
  if (!payload || !("data" in payload)) {
    throw new Error("接口未返回有效数据");
  }

  return payload.data as T;
}
