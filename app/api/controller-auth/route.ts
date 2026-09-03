import { NextRequest, NextResponse } from "next/server";
import {
  CONTROLLER_COOKIE,
  CONTROLLER_PIN,
  controllerSessionValue,
  isControllerAuthorized,
} from "../../../lib/controller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: isControllerAuthorized(request) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { pin?: string };
  if (body.pin !== CONTROLLER_PIN) {
    return NextResponse.json({ authenticated: false, error: "Invalid PIN" }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(CONTROLLER_COOKIE, controllerSessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(CONTROLLER_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
