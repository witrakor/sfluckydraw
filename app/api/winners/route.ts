import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import seatReservationsData from "../../../data/seat-reservations.json";

type Winner = {
  seatId: string;
  drawKey: "est-cola" | "gift-set";
  prize: "EST Cola" | "Gift Set";
  label: string;
  name?: string;
  phone?: string;
  bookedSeats?: string[];
};

type Reservation = { name: string; phone: string };
const SEAT_RESERVATIONS = seatReservationsData.reservations as Record<string, Reservation>;

function getBookedSeats(reservation: Reservation) {
  return Object.entries(SEAT_RESERVATIONS)
    .filter(([, candidate]) => (
      candidate.name === reservation.name && candidate.phone === reservation.phone
    ))
    .map(([label]) => label)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "winners.json");
const DRAW_RULES = {
  "est-cola": {
    quota: 4,
    prize: "EST Cola",
    rows: new Set(["M", "L", "K", "J", "H", "G", "F", "E", "D", "C", "B", "A", "AA"]),
  },
  "gift-set": {
    quota: 4,
    prize: "Gift Set",
    rows: new Set(["M", "L", "K", "J", "H", "G", "F", "E", "D", "C", "B", "A", "AA"]),
  },
} as const;

type AwardDrawKey = keyof typeof DRAW_RULES;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readWinners(): Promise<Winner[]> {
  try {
    const file = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(file) as { winners?: Winner[] };
    if (!Array.isArray(parsed.winners)) return [];

    return parsed.winners.flatMap((winner) => {
      const reservation = SEAT_RESERVATIONS[winner.label];
      if (!reservation) return [];

      return [{
        ...winner,
        name: reservation.name || undefined,
        phone: reservation.phone,
        bookedSeats: getBookedSeats(reservation),
      }];
    });
  } catch {
    return [];
  }
}

async function writeWinners(winners: Winner[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify({ winners }, null, 2)}\n`, "utf8");
}

export async function GET() {
  const winners = await readWinners();
  return NextResponse.json({ winners });
}

export async function POST(request: NextRequest) {
  const nextWinner = (await request.json()) as Winner;
  const winners = await readWinners();
  const rule = DRAW_RULES[nextWinner.drawKey as AwardDrawKey];

  if (!rule || nextWinner.prize !== rule.prize) {
    return NextResponse.json({ winners, error: "Invalid prize type" }, { status: 400 });
  }

  const row = nextWinner.seatId.split("-")[0];
  if (!(rule.rows as ReadonlySet<string>).has(row)) {
    return NextResponse.json({ winners, error: "Seat is not eligible for this prize" }, { status: 400 });
  }

  const reservation = SEAT_RESERVATIONS[nextWinner.label];
  if (!reservation) {
    return NextResponse.json({ winners, error: "Seat is not reserved" }, { status: 400 });
  }

  const existingWinner = winners.find((winner) => winner.seatId === nextWinner.seatId);
  if (existingWinner) {
    if (existingWinner.drawKey === nextWinner.drawKey && existingWinner.prize === nextWinner.prize) {
      return NextResponse.json({ winners, winner: existingWinner });
    }
    return NextResponse.json({ winners, error: "Seat already won" }, { status: 409 });
  }

  if (winners.filter((winner) => winner.drawKey === nextWinner.drawKey).length >= rule.quota) {
    return NextResponse.json({ winners, error: "Prize quota reached" }, { status: 409 });
  }

  const savedWinner: Winner = {
    ...nextWinner,
    name: reservation.name || undefined,
    phone: reservation.phone,
    bookedSeats: getBookedSeats(reservation),
  };
  const nextWinners = [...winners, savedWinner];
  await writeWinners(nextWinners);

  return NextResponse.json({ winners: nextWinners, winner: savedWinner });
}

export async function DELETE() {
  await writeWinners([]);
  return NextResponse.json({ winners: [] });
}
