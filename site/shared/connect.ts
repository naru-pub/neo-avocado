// 페이지의 나루 클라이언트. config.site를 적었으면 그 사이트로, 아니면 SDK가
// <login>.naru.pub에서 알아내고, 커스텀 도메인에서는 나루 엣지가 모든 호스트에서
// 답하는 /.well-known/naru-site에 사이트 이름을 묻는다.

import type { NaruClient } from "@naru-pub/sdk";
import { config } from "./config.js";

/** The site's login name, as Naru's edge answers it on the host it serves. */
async function servedSite(): Promise<string> {
  const response = await fetch("/.well-known/naru-site", { cache: "no-store" });
  if (!response.ok) throw new Error(`naru-site: ${response.status}`);
  return (await response.text()).trim();
}

/** A client bound to this site. */
export async function connectNaru(): Promise<NaruClient> {
  const { createNaru } = await import("@naru-pub/sdk");
  if (config.site) return createNaru({ site: config.site });
  try {
    return createNaru();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return createNaru({ site: await servedSite() });
  }
}
