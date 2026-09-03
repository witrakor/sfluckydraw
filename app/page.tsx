"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import seatReservationsData from "../data/seat-reservations.json";

type SeatType = "A" | "B";
type Prize = "EST Cola" | "Gift Set";
type AwardDrawKey = "est-cola" | "gift-set";
type DrawKey = AwardDrawKey;
type SeatPool = "blue" | "green";
type ControlCommand = {
  id: string;
  type: "draw" | "approve" | "reject" | "reset";
  drawKey?: AwardDrawKey;
  targetWinner?: Winner;
  animationSeed?: number;
  animationSteps?: number;
  animationStartsAt?: string;
};
type ControlStatus = {
  phase: "idle" | "queued" | "drawing" | "pending" | "deciding";
  activeDrawKey: AwardDrawKey | null;
  pendingWinner: Winner | null;
};

type Seat = {
  id: string;
  row: string;
  number: number;
  section: "left" | "right";
  type: SeatType;
  kind?: "sofa";
};

type Winner = {
  seatId: string;
  drawKey: DrawKey;
  prize: Prize;
  label: string;
  name?: string;
  phone?: string;
  bookedSeats?: string[];
};

type Reservation = {
  name: string;
  phone: string;
};

const ROWS = ["N", "M", "L", "K", "J", "H", "G", "F", "E", "D", "C", "B", "A", "AA"];
const TYPE_A_ROWS = new Set(["AA", "A", "B", "C", "D"]);
const COOL_ROWS = new Set(["M", "L", "K", "J", "H", "G"]);
const LIME_ROWS = new Set(["F", "E", "D", "C", "B", "A", "AA"]);
const LEFT_COUNTS: Record<string, number> = {
  N: 14,
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
const RIGHT_COUNTS: Record<string, number> = {
  N: 14,
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

const ELIGIBLE_ROWS = new Set([...COOL_ROWS, ...LIME_ROWS]);
const SEAT_RESERVATIONS = new Map(
  Object.entries(seatReservationsData.reservations) as [string, Reservation][],
);
const DRAW_CONFIG: Record<
  AwardDrawKey,
  { prize: Prize; quota: number; color: string; label: string }
> = {
  "est-cola": {
    prize: "EST Cola",
    quota: 4,
    color: "#ef3f4f",
    label: "EST Cola",
  },
  "gift-set": {
    prize: "Gift Set",
    quota: 4,
    color: "#ffd43b",
    label: "Gift Set",
  },
};
const LEGACY_AWARD_COLOR = "#f7ff39";
const THEATER_DESIGN_WIDTH = 1180;
const THEATER_DESIGN_HEIGHT = 760;
const WINNER_NOTES = [523.25, 659.25, 783.99, 1046.5];
const CONFETTI = Array.from({ length: 20 }, (_, index) => index);

function buildSeats() {
  return ROWS.flatMap((row) => {
    const type: SeatType = TYPE_A_ROWS.has(row) ? "A" : "B";
    const left = Array.from({ length: LEFT_COUNTS[row] }, (_, index) => ({
      id: `${row}-L-${index + 1}`,
      row,
      number: index + 1,
      section: "left" as const,
      type,
      kind: row === "AA" ? ("sofa" as const) : undefined,
    }));
    const right = Array.from({ length: RIGHT_COUNTS[row] }, (_, index) => ({
      id: `${row}-R-${index + 1}`,
      row,
      number: index + 1,
      section: "right" as const,
      type,
      kind: row === "AA" ? ("sofa" as const) : undefined,
    }));

    return [...left, ...right];
  });
}

function getSeatLabel(seat: Seat) {
  const offset = seat.section === "right" ? LEFT_COUNTS[seat.row] : 0;
  return `${seat.row}${seat.number + offset}`;
}

function getWinnerContactLabel(winner: Winner) {
  return winner.name || winner.phone || "ไม่มีข้อมูลผู้จอง";
}

function getBookedSeats(reservation: Reservation) {
  return Array.from(SEAT_RESERVATIONS.entries())
    .filter(([, candidate]) => (
      candidate.name === reservation.name && candidate.phone === reservation.phone
    ))
    .map(([label]) => label)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export default function Home() {
  const seats = useMemo(buildSeats, []);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [activeSeatId, setActiveSeatId] = useState<string | null>(null);
  const [activeDraw, setActiveDraw] = useState<AwardDrawKey | null>(null);
  const [pendingWinner, setPendingWinner] = useState<Winner | null>(null);
  const [isDecisionSaving, setIsDecisionSaving] = useState(false);
  const [modalWinner, setModalWinner] = useState<Winner | null>(null);
  const [modalCountdown, setModalCountdown] = useState(10);
  const [isModalDeparting, setIsModalDeparting] = useState(false);
  const [winnerFlightTarget, setWinnerFlightTarget] = useState<{ x: number; y: number } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [theaterScale, setTheaterScale] = useState(1);
  const [isTheaterMeasured, setIsTheaterMeasured] = useState(false);
  const theaterShellRef = useRef<HTMLElement | null>(null);
  const latestWinnerBadgeRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const observedCommandIdRef = useRef<string | null>(null);
  const processedCommandIdRef = useRef<string | null>(null);
  const controlInitializedRef = useRef(false);
  const [remoteCommand, setRemoteCommand] = useState<ControlCommand | null>(null);

  const updateControlStatus = async (commandId: string, status: ControlStatus) => {
    await fetch("/api/control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId, status }),
    });
  };

  const prepareWinnerSound = () => {
    const audioContext = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
  };

  const playWinnerSound = () => {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state !== "running") return;

    const startAt = audioContext.currentTime + 0.04;
    WINNER_NOTES.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const noteStart = startAt + index * 0.11;
      const noteEnd = noteStart + (index === WINNER_NOTES.length - 1 ? 0.62 : 0.28);

      oscillator.type = index === WINNER_NOTES.length - 1 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    });
  };

  const loadWinners = async () => {
    const response = await fetch("/api/winners", { cache: "no-store" });
    const data = (await response.json()) as { winners?: Winner[] };
    if (!response.ok) throw new Error("Unable to load winners");
    setWinners(Array.isArray(data.winners) ? data.winners : []);
  };

  useEffect(() => {
    let mounted = true;

    fetch("/api/winners", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { winners?: Winner[] }) => {
        if (mounted) setWinners(Array.isArray(data.winners) ? data.winners : []);
      })
      .catch(() => {
        if (mounted) setWinners([]);
      })
      .finally(() => {
        if (mounted) setIsLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const syncControl = async () => {
      try {
        const response = await fetch("/api/control", { cache: "no-store" });
        const state = (await response.json()) as {
          command: ControlCommand | null;
          status: ControlStatus;
        };
        if (!mounted) return;

        if (!controlInitializedRef.current) {
          controlInitializedRef.current = true;
          observedCommandIdRef.current = state.command?.id ?? null;

          if (state.status.pendingWinner) {
            setPendingWinner(state.status.pendingWinner);
          }

          if (state.command && state.status.phase !== "idle" && state.status.phase !== "pending") {
            setRemoteCommand(state.command);
          } else {
            processedCommandIdRef.current = state.command?.id ?? null;
          }
          return;
        }

        if (state.command && state.command.id !== observedCommandIdRef.current) {
          observedCommandIdRef.current = state.command.id;
          setRemoteCommand(state.command);
        }
      } catch {
        // The display keeps running and retries on the next polling interval.
      }
    };

    void syncControl();
    const interval = window.setInterval(syncControl, 350);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useLayoutEffect(() => {
    const theaterShell = theaterShellRef.current;
    if (!theaterShell) return;

    const updateScale = () => {
      const rect = theaterShell.getBoundingClientRect();
      const widthScale = (rect.width - 20) / THEATER_DESIGN_WIDTH;
      const heightScale = (rect.height - 46) / THEATER_DESIGN_HEIGHT;
      const isMobile = window.matchMedia("(max-width: 540px)").matches;
      const nextScale = Math.max(
        0.2,
        Math.min(widthScale, isMobile ? widthScale : heightScale, 1.55),
      );
      setTheaterScale((currentScale) =>
        Math.abs(currentScale - nextScale) < 0.001 ? currentScale : nextScale,
      );
      setIsTheaterMeasured(true);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(theaterShell);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  useEffect(() => {
    if (!modalWinner) return;

    setModalCountdown(10);
    setIsModalDeparting(false);
    setWinnerFlightTarget(null);
    let departureTimer: number | null = null;

    const countdownTimer = window.setInterval(() => {
      setModalCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(countdownTimer);
          const badgeRect = latestWinnerBadgeRef.current?.getBoundingClientRect();
          if (badgeRect) {
            setWinnerFlightTarget({
              x: badgeRect.left + badgeRect.width / 2,
              y: badgeRect.top + badgeRect.height / 2,
            });
          }
          setIsModalDeparting(true);
          departureTimer = window.setTimeout(() => {
            setModalWinner(null);
            setIsModalDeparting(false);
          }, 950);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(countdownTimer);
      if (departureTimer) window.clearTimeout(departureTimer);
    };
  }, [modalWinner]);

  const winnerBySeat = useMemo(() => {
    return new Map(winners.map((winner) => [winner.seatId, winner]));
  }, [winners]);
  const latestWinnerSeatId = pendingWinner?.seatId ?? winners.at(-1)?.seatId;
  const latestWinner = pendingWinner ?? winners.at(-1);
  const latestWinnerConfig = latestWinner ? DRAW_CONFIG[latestWinner.drawKey] : null;
  const latestWinnerSeat = latestWinner
    ? seats.find((seat) => seat.id === latestWinner.seatId)
    : undefined;
  const latestWinnerPool: SeatPool =
    latestWinnerSeat && COOL_ROWS.has(latestWinnerSeat.row) ? "blue" : "green";
  const latestWinnerColor = latestWinnerConfig?.color ?? LEGACY_AWARD_COLOR;

  const counts = useMemo(() => {
    return Object.fromEntries(
      (Object.keys(DRAW_CONFIG) as AwardDrawKey[]).map((key) => [
        key,
        winners.filter((winner) => winner.drawKey === key).length,
      ]),
    ) as Record<AwardDrawKey, number>;
  }, [winners]);

  const displayedWinnerBySeat = useMemo(() => {
    const displayed = new Map(winnerBySeat);
    if (pendingWinner) displayed.set(pendingWinner.seatId, pendingWinner);
    return displayed;
  }, [pendingWinner, winnerBySeat]);

  const drawWinner = (
    drawKey: AwardDrawKey,
    commandId?: string,
    targetWinner?: Winner,
    animationSeed?: number,
    animationSteps?: number,
  ) => {
    if (activeDraw || pendingWinner || !isLoaded) return;

    prepareWinnerSound();

    const config = DRAW_CONFIG[drawKey];
    if (counts[drawKey] >= config.quota) {
      if (commandId) void updateControlStatus(commandId, {
        phase: "idle",
        activeDrawKey: null,
        pendingWinner: null,
      });
      return;
    }

    const eligibleSeats = seats.filter((seat) => {
      const label = getSeatLabel(seat);
      return ELIGIBLE_ROWS.has(seat.row) && SEAT_RESERVATIONS.has(label) && !winnerBySeat.has(seat.id);
    });

    if (eligibleSeats.length === 0) {
      if (commandId) void updateControlStatus(commandId, {
        phase: "idle",
        activeDrawKey: null,
        pendingWinner: null,
      });
      return;
    }

    setModalWinner(null);
    setActiveDraw(drawKey);
    if (commandId) void updateControlStatus(commandId, {
      phase: "drawing",
      activeDrawKey: drawKey,
      pendingWinner: null,
    });

    let step = 0;
    const random = animationSeed === undefined ? Math.random : createSeededRandom(animationSeed);
    const maxSteps = animationSteps ?? 34 + Math.floor(random() * 8);
    const target = targetWinner
      ? eligibleSeats.find((seat) => seat.id === targetWinner.seatId)
      : eligibleSeats[Math.floor(Math.random() * eligibleSeats.length)];

    if (!target) {
      setActiveDraw(null);
      if (commandId) void updateControlStatus(commandId, {
        phase: "idle",
        activeDrawKey: null,
        pendingWinner: null,
      });
      return;
    }

    const animate = () => {
      step += 1;
      const poolSeat = eligibleSeats[Math.floor(random() * eligibleSeats.length)];
      const currentSeat = step >= maxSteps ? target : poolSeat;
      setActiveSeatId(currentSeat.id);

      if (step >= maxSteps) {
        const reservation = SEAT_RESERVATIONS.get(getSeatLabel(target));
        const nextWinner: Winner = targetWinner ?? {
          seatId: target.id,
          drawKey,
          prize: config.prize,
          label: getSeatLabel(target),
          name: reservation?.name || undefined,
          phone: reservation?.phone,
          bookedSeats: reservation ? getBookedSeats(reservation) : [getSeatLabel(target)],
        };

        window.setTimeout(() => {
          setPendingWinner(nextWinner);
          setModalWinner(nextWinner);
          setActiveDraw(null);
          setActiveSeatId(null);
          playWinnerSound();
          if (commandId) void updateControlStatus(commandId, {
            phase: "pending",
            activeDrawKey: drawKey,
            pendingWinner: nextWinner,
          });
        }, 220);
        return;
      }

      const progress = step / maxSteps;
      const easeOut = progress * progress;
      const delay = 24 + Math.round(easeOut * 118);
      timerRef.current = window.setTimeout(animate, delay);
    };

    if (timerRef.current) window.clearTimeout(timerRef.current);
    animate();
  };

  const approvePendingWinner = async (commandId?: string) => {
    if (!pendingWinner || isDecisionSaving) return;
    setIsDecisionSaving(true);

    try {
      const response = await fetch("/api/winners", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pendingWinner),
      });
      const data = (await response.json()) as { winners?: Winner[]; winner?: Winner };
      if (!response.ok) throw new Error("Unable to save winner");

      setWinners(Array.isArray(data.winners) ? data.winners : [...winners, pendingWinner]);
      setPendingWinner(null);
      setModalWinner(null);
      setIsModalDeparting(false);
      if (commandId) await updateControlStatus(commandId, {
        phase: "idle",
        activeDrawKey: null,
        pendingWinner: null,
      });
    } catch {
      if (commandId) await updateControlStatus(commandId, {
        phase: "pending",
        activeDrawKey: pendingWinner.drawKey,
        pendingWinner,
      });
    } finally {
      setIsDecisionSaving(false);
    }
  };

  const rejectPendingWinner = (commandId?: string) => {
    if (!pendingWinner || isDecisionSaving) return;
    setPendingWinner(null);
    setModalWinner(null);
    setIsModalDeparting(false);
    setWinnerFlightTarget(null);
    setActiveSeatId(null);
    if (commandId) void updateControlStatus(commandId, {
      phase: "idle",
      activeDrawKey: null,
      pendingWinner: null,
    });
  };

  const resetWinners = async (commandId?: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setActiveDraw(null);
    setActiveSeatId(null);
    setPendingWinner(null);
    setIsDecisionSaving(false);
    setModalWinner(null);
    setIsLoaded(false);

    try {
      const response = await fetch("/api/winners", { method: "DELETE" });
      await response.json();
      if (!response.ok) throw new Error("Unable to reset winners");
      await loadWinners();
      if (commandId) await updateControlStatus(commandId, {
        phase: "idle",
        activeDrawKey: null,
        pendingWinner: null,
      });
    } catch {
      if (commandId) await updateControlStatus(commandId, {
        phase: "idle",
        activeDrawKey: null,
        pendingWinner: null,
      });
    } finally {
      setIsLoaded(true);
    }
  };

  useEffect(() => {
    if (!remoteCommand || !isLoaded || processedCommandIdRef.current === remoteCommand.id) return;
    if (remoteCommand.type === "draw" && !remoteCommand.drawKey) return;

    processedCommandIdRef.current = remoteCommand.id;
    if (remoteCommand.type === "draw") {
      const startDelay = Math.max(
        0,
        Date.parse(remoteCommand.animationStartsAt ?? "") - Date.now(),
      );
      timerRef.current = window.setTimeout(() => {
        drawWinner(
          remoteCommand.drawKey as AwardDrawKey,
          remoteCommand.id,
          remoteCommand.targetWinner,
          remoteCommand.animationSeed,
          remoteCommand.animationSteps,
        );
      }, Number.isFinite(startDelay) ? startDelay : 0);
    } else if (remoteCommand.type === "approve") {
      void approvePendingWinner(remoteCommand.id);
    } else if (remoteCommand.type === "reject") {
      rejectPendingWinner(remoteCommand.id);
    } else {
      void resetWinners(remoteCommand.id);
    }
  }, [isLoaded, remoteCommand]);

  return (
    <main className="stage">
      <Image
        alt=""
        className="eventBackground"
        fill
        sizes="100vw"
        src="/images/event-background-orange-v3.png"
      />
      <div className="backgroundShade" />

      <header className="eventTitleHeader">
        <Image
          alt="GELBOYS2 Fan Screen Status EP.5 Hi Hi, Khonkaen Stans, Leon's Hometown, 5 September 2026, gate opens 6:30 PM, showtime 7:00 PM"
          className="eventTitleArtwork"
          fill
          priority
          sizes="(max-width: 540px) calc(100vw - 24px), 650px"
          src="/images/event-header-clean-type-transparent.png"
        />
      </header>

      <div className="softwareCreditBar" aria-label="ผู้พัฒนาซอฟต์แวร์">
        <div className="poweredBy">
          <div className="softwareCreditCopy">
            <span>Software developed by</span>
          </div>
          <div className="nesLogoWrap">
            <Image
              alt="NES Organizer"
              fill
              sizes="136px"
              src="/images/nes-organizer-logo-transparent.png"
            />
          </div>
        </div>
      </div>

      <section
        className="theaterShell"
        ref={theaterShellRef}
        aria-label="ผังที่นั่งโรงหนัง"
      >
        <div
          className={`theaterFrame ${isTheaterMeasured ? "isMeasured" : "isMeasuring"}`}
          style={{
            height: THEATER_DESIGN_HEIGHT * theaterScale,
            width: THEATER_DESIGN_WIDTH * theaterScale,
          }}
        >
          <section
            className="theater"
            style={
              {
                "--theater-scale": theaterScale,
                "--theater-width": `${THEATER_DESIGN_WIDTH}px`,
                "--theater-height": `${THEATER_DESIGN_HEIGHT}px`,
              } as React.CSSProperties
            }
          >
            <div className="screenWrap">
              <div className="screenCurve" />
              <div className="screenLabel">SCREEN</div>
            </div>

            <div className="seatMap">
              {ROWS.map((row) => {
                const rowSeats = seats.filter((seat) => seat.row === row);
                const leftSeats = rowSeats.filter((seat) => seat.section === "left");
                const rightSeats = rowSeats.filter((seat) => seat.section === "right");

                return (
                  <div
                    className={[
                      "seatRow",
                      TYPE_A_ROWS.has(row) ? "frontZone" : "backZone",
                      row === "N" ? "dimRow" : "",
                      COOL_ROWS.has(row) ? "coolRow" : "",
                      LIME_ROWS.has(row) ? "limeRow" : "",
                      row === "D" ? "zoneBreak" : "",
                      row === "AA" ? "sofaRow" : "",
                    ].filter(Boolean).join(" ")}
                    key={row}
                  >
                    <div className="rowLabel">{row}</div>
                    <SeatCluster
                      activeSeatId={activeSeatId}
                      latestWinnerSeatId={latestWinnerSeatId}
                      seats={leftSeats}
                      winnerBySeat={displayedWinnerBySeat}
                    />
                    <div className="aisle" />
                    <SeatCluster
                      activeSeatId={activeSeatId}
                      latestWinnerSeatId={latestWinnerSeatId}
                      seats={rightSeats}
                      winnerBySeat={displayedWinnerBySeat}
                    />
                    <div className="rowLabel right">{row}</div>
                  </div>
                );
              })}
            </div>

          </section>
          {latestWinner ? (
            <aside
              className={`latestWinnerBadge${modalWinner ? " isWaiting" : ""}`}
              key={latestWinnerSeatId}
              ref={latestWinnerBadgeRef}
              aria-live="polite"
              style={{ "--latest-award-color": latestWinnerColor } as React.CSSProperties}
            >
              <span
                className={`legendSeatIcon latestWinnerSeatIcon ${latestWinnerPool}`}
                aria-hidden="true"
              >
                <span className="legendSeatBack" />
                <span className="legendSeatBase" />
              </span>
              <span className="latestWinnerDetails">
                <strong>{latestWinner.label}</strong>
                <small>{latestWinner.prize}</small>
                <span className="latestWinnerPerson">
                  {getWinnerContactLabel(latestWinner)}
                </span>
                {latestWinner.name && latestWinner.phone ? (
                  <span className="latestWinnerPhone">{latestWinner.phone}</span>
                ) : null}
              </span>
            </aside>
          ) : null}
          <WinnerHistoryPanel className="winnerHistorySide" winners={winners} />
          <div className="ambientStars" aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              <span className="ambientStar" key={index} />
            ))}
          </div>
        </div>
      </section>

      <WinnerHistoryPanel className="winnerHistoryMobile" winners={winners} />

      {modalWinner ? (
        <div
          className={`modalBackdrop${isModalDeparting ? " isDeparting" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="ผลการสุ่ม"
        >
          <div
            className={`winnerModal${isModalDeparting ? " isDeparting" : ""}`}
            style={
              {
                "--flight-target-x": `${winnerFlightTarget?.x ?? window.innerWidth - 120}px`,
                "--flight-target-y": `${winnerFlightTarget?.y ?? 120}px`,
                "--modal-award-color": DRAW_CONFIG[modalWinner.drawKey].color,
              } as React.CSSProperties
            }
          >
            <div className="confetti" aria-hidden="true">
              {CONFETTI.map((piece) => (
                <span key={piece} style={{ "--piece": piece } as React.CSSProperties} />
              ))}
            </div>
            <div className="winnerBrand" aria-hidden="true">
              <Image
                alt=""
                className="winnerBrandImage"
                fill
                sizes="180px"
                src="/images/gelboy-transparent.png"
              />
            </div>
            <p className="winnerKicker">CONGRATULATIONS</p>
            <h2>ผู้โชคดี</h2>
            <div className="winnerSeatNumber" aria-live="assertive">
              {modalWinner.label}
            </div>
            <div className="winnerContact">
              {modalWinner.name ? <strong>{modalWinner.name}</strong> : null}
              <span>{modalWinner.phone || (!modalWinner.name ? "ไม่มีข้อมูลผู้จอง" : "")}</span>
            </div>
            <p className="winnerPrize">รับรางวัล {modalWinner.prize}</p>
            <div
              className="winnerCountdown"
              aria-label={`ปิดอัตโนมัติใน ${modalCountdown} วินาที`}
              aria-live="polite"
            >
              <strong>{modalCountdown}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function WinnerHistoryPanel({
  className,
  winners,
}: {
  className: string;
  winners: Winner[];
}) {
  return (
    <aside className={`winnerHistory ${className}`} aria-label="ประวัติผู้โชคดีที่ยืนยันแล้ว">
      <h3>ผู้โชคดี</h3>
      <div className="winnerHistoryGroups">
        {(Object.keys(DRAW_CONFIG) as AwardDrawKey[]).map((key) => {
          const config = DRAW_CONFIG[key];
          const approvedWinners = winners.filter((winner) => winner.drawKey === key);

          return (
            <section
              className="winnerHistoryGroup"
              key={key}
              style={{ "--history-color": config.color } as React.CSSProperties}
            >
              <header>
                <span aria-hidden="true" />
                <strong>{config.label}</strong>
                <small>{approvedWinners.length}/{config.quota}</small>
              </header>
              <div className="winnerHistorySeats">
                {approvedWinners.length > 0 ? (
                  approvedWinners.map((winner) => (
                    <div className="winnerHistoryRecord" key={winner.seatId}>
                      <strong>{winner.label}</strong>
                      <span>{getWinnerContactLabel(winner)}</span>
                      <small>
                        {winner.name && winner.phone ? `${winner.phone} · ` : ""}
                        {winner.bookedSeats?.join(", ") || winner.label}
                      </small>
                    </div>
                  ))
                ) : (
                  <em>ยังไม่มี</em>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function SeatCluster({
  activeSeatId,
  latestWinnerSeatId,
  seats,
  winnerBySeat,
}: {
  activeSeatId: string | null;
  latestWinnerSeatId?: string;
  seats: Seat[];
  winnerBySeat: Map<string, Winner>;
}) {
  const renderSeat = (seat: Seat) => (
    <SeatButton
      active={activeSeatId === seat.id}
      latest={latestWinnerSeatId === seat.id}
      key={seat.id}
      booked={SEAT_RESERVATIONS.has(getSeatLabel(seat))}
      seat={seat}
      winner={winnerBySeat.get(seat.id)}
    />
  );

  if (seats[0]?.kind !== "sofa") {
    return <div className="seatCluster">{seats.map(renderSeat)}</div>;
  }

  return (
    <div className="seatCluster sofaCluster">
      {Array.from({ length: Math.ceil(seats.length / 2) }, (_, pairIndex) => {
        const pair = seats.slice(pairIndex * 2, pairIndex * 2 + 2);
        return (
          <div className="sofaPair" key={pair[0].id}>
            {pair.map(renderSeat)}
          </div>
        );
      })}
    </div>
  );
}

function SeatButton({
  active,
  booked,
  latest,
  seat,
  winner,
}: {
  active: boolean;
  booked: boolean;
  latest: boolean;
  seat: Seat;
  winner?: Winner;
}) {
  const label = getSeatLabel(seat);
  const awardColor = winner
    ? DRAW_CONFIG[winner.drawKey]?.color ?? LEGACY_AWARD_COLOR
    : undefined;

  return (
    <button
      aria-label={`ที่นั่ง ${label}${winner ? ` ได้รางวัล ${winner.prize}` : ""}`}
      className={[
        "seat",
        seat.kind === "sofa" ? "sofaSeat" : "",
        seat.type === "A" ? "typeA" : "typeB",
        !booked ? "unavailableSeat" : "",
        active ? "activeSeat" : "",
        winner ? "winnerSeat" : "",
        latest ? "latestWinnerSeat" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={awardColor ? ({ "--seat-award": awardColor } as React.CSSProperties) : undefined}
      disabled={!booked}
      title={booked ? label : `${label} · ไม่มีผู้จอง`}
      type="button"
    >
      <span className="seatBack" />
      <span className="seatBase" />
      <span className="seatLabel">{label}</span>
      {latest ? <span aria-hidden="true" className="winnerWaveHand">👋</span> : null}
    </button>
  );
}
