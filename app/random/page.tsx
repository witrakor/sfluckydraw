"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./random.module.css";

type AwardDrawKey = "est-cola" | "gift-set";
type CommandType = "draw" | "approve" | "reject" | "reset";
type Winner = {
  seatId: string;
  drawKey: AwardDrawKey;
  prize: string;
  label: string;
  name?: string;
  phone?: string;
  bookedSeats?: string[];
};
type ControlState = {
  status: {
    phase: "idle" | "queued" | "drawing" | "pending" | "deciding";
    activeDrawKey: AwardDrawKey | null;
    pendingWinner: Winner | null;
  };
};

const DRAW_CONFIG: Record<
  AwardDrawKey,
  { label: string; quota: number; buttonColor: string; softColor: string; awardColor: string }
> = {
  "est-cola": {
    label: "EST Cola",
    quota: 4,
    buttonColor: "#ff5c65",
    softColor: "#ffd0d2",
    awardColor: "#ef3f4f",
  },
  "gift-set": {
    label: "Gift Set",
    quota: 4,
    buttonColor: "#ffd43b",
    softColor: "#fff3b0",
    awardColor: "#ffd43b",
  },
};

const DRAW_KEYS = Object.keys(DRAW_CONFIG) as AwardDrawKey[];

export default function RandomController() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [control, setControl] = useState<ControlState | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [sending, setSending] = useState(false);
  const [connectionError, setConnectionError] = useState(false);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        DRAW_KEYS.map((key) => [key, winners.filter((winner) => winner.drawKey === key).length]),
      ) as Record<AwardDrawKey, number>,
    [winners],
  );

  const refresh = async () => {
    try {
      const [controlResponse, winnersResponse] = await Promise.all([
        fetch("/api/control", { cache: "no-store" }),
        fetch("/api/winners", { cache: "no-store" }),
      ]);
      const [controlData, winnersData] = await Promise.all([
        controlResponse.json() as Promise<ControlState>,
        winnersResponse.json() as Promise<{ winners?: Winner[] }>,
      ]);
      setControl(controlData);
      setWinners(Array.isArray(winnersData.winners) ? winnersData.winners : []);
      setConnectionError(false);
    } catch {
      setConnectionError(true);
    }
  };

  useEffect(() => {
    fetch("/api/controller-auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { authenticated?: boolean }) => setAuthenticated(Boolean(data.authenticated)))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    const interval = window.setInterval(refresh, 500);
    return () => window.clearInterval(interval);
  }, [authenticated]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPinError("");
    setSending(true);
    try {
      const response = await fetch("/api/controller-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        setPinError("PIN ไม่ถูกต้อง");
        return;
      }
      setAuthenticated(true);
      setPin("");
    } catch {
      setPinError("เชื่อมต่อไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  };

  const sendCommand = async (type: CommandType, drawKey?: AwardDrawKey) => {
    if (sending) return;
    setSending(true);
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, drawKey }),
      });
      const data = (await response.json()) as ControlState & { error?: string };
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) {
        await refresh();
        return;
      }
      setControl(data);
    } finally {
      setSending(false);
    }
  };

  const resetWinners = () => {
    if (sending) return;
    if (!window.confirm("ยืนยันการล้างประวัติผู้โชคดีทั้งหมด?")) return;
    void sendCommand("reset");
  };

  if (authenticated === null) {
    return <main className={styles.lockScreen}><p>กำลังตรวจสอบ...</p></main>;
  }

  if (!authenticated) {
    return (
      <main className={styles.lockScreen}>
        <form className={styles.pinCard} onSubmit={unlock}>
          <div className={styles.lockMark} aria-hidden="true">PIN</div>
          <h1>Lucky Seat Control</h1>
          <label htmlFor="controller-pin">กรอกรหัส PIN</label>
          <input
            autoComplete="one-time-code"
            autoFocus
            id="controller-pin"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            pattern="[0-9]{6}"
            placeholder="••••••"
            type="password"
            value={pin}
          />
          {pinError ? <p className={styles.errorText}>{pinError}</p> : null}
          <button disabled={pin.length !== 6 || sending} type="submit">ปลดล็อก</button>
        </form>
      </main>
    );
  }

  const phase = control?.status.phase ?? "queued";
  const pendingWinner = control?.status.pendingWinner;
  const drawsDisabled = sending || phase !== "idle";
  const decisionsDisabled = sending || phase !== "pending" || !pendingWinner;

  return (
    <main className={`${styles.controller} randomControllerPage`}>
      <header className={styles.controllerHeader}>
        <div>
          <p>REMOTE CONTROL</p>
          <h1>Lucky Seat</h1>
        </div>
        <button
          className={styles.resetButton}
          disabled={sending}
          onClick={resetWinners}
          type="button"
        >
          Reset
        </button>
      </header>

      <section className={styles.statusPanel} aria-live="polite">
        <span className={`${styles.statusDot} ${connectionError ? styles.offline : ""}`} />
        <div>
          <small>{connectionError ? "ขาดการเชื่อมต่อ" : phase === "idle" ? "พร้อมสุ่ม" : phase === "pending" ? "รอการตัดสินใจ" : phase === "deciding" ? "กำลังบันทึกผล" : "จอหลักกำลังสุ่ม"}</small>
          <strong>
            {pendingWinner
              ? `${pendingWinner.label} · ${pendingWinner.prize} · ${pendingWinner.name || pendingWinner.phone || ""}`
              : "เชื่อมต่อกับจอหลักแล้ว"}
          </strong>
        </div>
      </section>

      <section className={styles.drawList} aria-label="ปุ่มสุ่มรางวัล">
        {DRAW_KEYS.map((key) => {
          const config = DRAW_CONFIG[key];
          const disabled = drawsDisabled || counts[key] >= config.quota;
          return (
            <button
              className={styles.drawButton}
              disabled={disabled}
              key={key}
              onClick={() => sendCommand("draw", key)}
              style={{
                "--pool-color": config.buttonColor,
                "--pool-soft-color": config.softColor,
                "--award-color": config.awardColor,
              } as React.CSSProperties}
              type="button"
            >
              <span className={`${styles.chairIcon} ${styles.mixedChair}`} aria-hidden="true">
                <span className={styles.chairBack} />
                <span className={styles.chairBase} />
              </span>
              <span className={styles.awardDot} />
              <span>{config.label}</span>
              <strong>{counts[key]}/{config.quota}</strong>
            </button>
          );
        })}
      </section>

      <section className={styles.decisionGrid} aria-label="ตัดสินผลการสุ่ม">
        <button disabled={decisionsDisabled} onClick={() => sendCommand("approve")} type="button">ยืนยัน</button>
        <button disabled={decisionsDisabled} onClick={() => sendCommand("reject")} type="button">ปฏิเสธ</button>
      </section>
    </main>
  );
}
