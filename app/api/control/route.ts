import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import seatReservationsData from "../../../data/seat-reservations.json";
import { isControllerAuthorized } from "../../../lib/controller-auth";
import {
  EMPTY_CONTROL_STATUS,
  readControlState,
  writeControlState,
  type AwardDrawKey,
  type ControlCommand,
  type ControlStatus,
  type Winner,
} from "../../../lib/control-store";

const DRAW_KEYS = new Set<AwardDrawKey>([
  "est-cola",
  "gift-set",
]);
const ELIGIBLE_ROWS = new Set(["M", "L", "K", "J", "H", "G", "F", "E", "D", "C", "B", "A", "AA"]);
const LEFT_COUNTS: Record<string, number> = {
  M: 14,
  L: 14,
  K: 14,
  J: 14,
  H: 14,
  G: 14,
  F: 14,
  E: 14,
  D: 13,
  C: 13,
  B: 13,
  A: 13,
  AA: 8,
};
const PRIZES: Record<AwardDrawKey, Winner["prize"]> = {
  "est-cola": "EST Cola",
  "gift-set": "Gift Set",
};
const QUOTA = 4;
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const WINNERS_FILE = path.join(DATA_DIR, "winners.json");
type Reservation = { name: string; phone: string };
const RESERVATIONS = seatReservationsData.reservations as Record<string, Reservation>;

async function readWinners(): Promise<Winner[]> {
  try {
    const file = await readFile(WINNERS_FILE, "utf8");
    const parsed = JSON.parse(file) as { winners?: Winner[] };
    return Array.isArray(parsed.winners) ? parsed.winners : [];
  } catch {
    return [];
  }
}

function getSeatId(label: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(label);
  if (!match) return null;

  const [, row, rawNumber] = match;
  const number = Number(rawNumber);
  const leftCount = LEFT_COUNTS[row];
  if (!ELIGIBLE_ROWS.has(row) || !leftCount || number < 1 || number > leftCount * 2) return null;

  return number <= leftCount
    ? `${row}-L-${number}`
    : `${row}-R-${number - leftCount}`;
}

function getBookedSeats(reservation: Reservation) {
  return Object.entries(RESERVATIONS)
    .filter(([, candidate]) => (
      candidate.name === reservation.name && candidate.phone === reservation.phone
    ))
    .map(([label]) => label)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function selectTargetWinner(drawKey: AwardDrawKey): Promise<Winner | null> {
  const winners = await readWinners();
  if (winners.filter((winner) => winner.drawKey === drawKey).length >= QUOTA) return null;

  const awardedSeats = new Set(winners.map((winner) => winner.seatId));
  const candidates = Object.entries(RESERVATIONS).flatMap(([label, reservation]) => {
    const seatId = getSeatId(label);
    if (!seatId || awardedSeats.has(seatId)) return [];

    return [{
      seatId,
      drawKey,
      prize: PRIZES[drawKey],
      label,
      name: reservation.name || undefined,
      phone: reservation.phone,
      bookedSeats: getBookedSeats(reservation),
    } satisfies Winner];
  });

  return candidates.length > 0 ? candidates[randomInt(candidates.length)] : null;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await readControlState());
}

export async function POST(request: NextRequest) {
  if (!isControllerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    type?: ControlCommand["type"];
    drawKey?: AwardDrawKey;
  };
  const state = await readControlState();
  let targetWinner: Winner | undefined;

  if (body.type === "draw") {
    if (!body.drawKey || !DRAW_KEYS.has(body.drawKey)) {
      return NextResponse.json({ error: "Invalid draw type" }, { status: 400 });
    }
    if (state.status.phase !== "idle") {
      return NextResponse.json({ error: "Controller is busy", state }, { status: 409 });
    }
    targetWinner = (await selectTargetWinner(body.drawKey)) ?? undefined;
    if (!targetWinner) {
      return NextResponse.json({ error: "No eligible seat", state }, { status: 409 });
    }
  } else if (body.type === "approve" || body.type === "reject") {
    if (state.status.phase !== "pending" || !state.status.pendingWinner) {
      return NextResponse.json({ error: "No pending winner", state }, { status: 409 });
    }
  } else if (body.type !== "reset") {
    return NextResponse.json({ error: "Invalid command" }, { status: 400 });
  }

  const command: ControlCommand = {
    id: randomUUID(),
    type: body.type,
    drawKey: body.type === "draw" ? body.drawKey : undefined,
    targetWinner: body.type === "draw" ? targetWinner : undefined,
    animationSeed: body.type === "draw" ? randomInt(1, 2_147_483_647) : undefined,
    animationSteps: body.type === "draw" ? 57 : undefined,
    animationStartsAt: body.type === "draw"
      ? new Date(Date.now() + 800).toISOString()
      : undefined,
    createdAt: new Date().toISOString(),
  };
  const status: ControlStatus =
    body.type === "draw"
      ? { phase: "queued", activeDrawKey: body.drawKey ?? null, pendingWinner: null }
      : body.type === "reset"
        ? { ...EMPTY_CONTROL_STATUS, phase: "queued" }
        : { ...state.status, phase: "deciding" };
  const nextState = { command, status, updatedAt: new Date().toISOString() };
  await writeControlState(nextState);
  return NextResponse.json(nextState);
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    commandId?: string;
    status?: ControlStatus;
  };
  const state = await readControlState();

  if (!body.commandId || body.commandId !== state.command?.id || !body.status) {
    return NextResponse.json({ error: "Stale control update", state }, { status: 409 });
  }

  if (state.command.type === "draw") {
    const targetWinner = state.command.targetWinner;
    const isDrawProgress = body.status.phase === "drawing";
    const isMatchingResult =
      body.status.phase === "pending"
      && body.status.pendingWinner?.seatId === targetWinner?.seatId
      && body.status.pendingWinner?.drawKey === targetWinner?.drawKey;

    if (!targetWinner || (!isDrawProgress && !isMatchingResult)) {
      return NextResponse.json({ error: "Invalid draw result", state }, { status: 409 });
    }

    if (state.status.phase === "pending" && body.status.phase === "drawing") {
      return NextResponse.json(state);
    }
  }

  const nextState = {
    ...state,
    status: body.status,
    updatedAt: new Date().toISOString(),
  };
  await writeControlState(nextState);
  return NextResponse.json(nextState);
}
