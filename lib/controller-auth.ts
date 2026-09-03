import type { NextRequest } from "next/server";

export const CONTROLLER_COOKIE = "lucky-seat-controller";
export const CONTROLLER_PIN = process.env.CONTROLLER_PIN ?? "050926";
const CONTROLLER_SESSION = process.env.CONTROLLER_SESSION ?? "nes-lucky-seat-controller-v2";

export function isControllerAuthorized(request: NextRequest) {
  return request.cookies.get(CONTROLLER_COOKIE)?.value === CONTROLLER_SESSION;
}

export function controllerSessionValue() {
  return CONTROLLER_SESSION;
}
