import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type AwardDrawKey =
  | "est-cola"
  | "gift-set";

export type Winner = {
  seatId: string;
  drawKey: AwardDrawKey;
  prize: "EST Cola" | "Gift Set";
  label: string;
  name?: string;
  phone?: string;
  bookedSeats?: string[];
};

export type ControlCommand = {
  id: string;
  type: "draw" | "approve" | "reject" | "reset";
  drawKey?: AwardDrawKey;
  targetWinner?: Winner;
  animationSeed?: number;
  animationSteps?: number;
  animationStartsAt?: string;
  createdAt: string;
};

export type ControlStatus = {
  phase: "idle" | "queued" | "drawing" | "pending" | "deciding";
  activeDrawKey: AwardDrawKey | null;
  pendingWinner: Winner | null;
};

export type ControlState = {
  command: ControlCommand | null;
  status: ControlStatus;
  updatedAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "control.json");

export const EMPTY_CONTROL_STATUS: ControlStatus = {
  phase: "idle",
  activeDrawKey: null,
  pendingWinner: null,
};

export async function readControlState(): Promise<ControlState> {
  try {
    const file = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(file) as Partial<ControlState>;
    return {
      command: parsed.command ?? null,
      status: parsed.status ?? EMPTY_CONTROL_STATUS,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return {
      command: null,
      status: EMPTY_CONTROL_STATUS,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export async function writeControlState(state: ControlState) {
  await mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, DATA_FILE);
}
