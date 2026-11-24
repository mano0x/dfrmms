"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { MAX_ROOM_CAPACITY, type AllocationState, type AllocationView, type Dormitory, type RoomType, type RoomView } from "@/lib/accommodation";
import {
  allocateRoom, cancelAllocation, endAllocation, fetchAccommodation, saveDormitory, saveRoom, saveRoomType, type Accommodation,
} from "@/lib/rooms";
import { errorMessage } from "@/lib/reports";
import { announceInboxChange } from "@/lib/community";
import { Alert, AppShell, Card, EmptyState, Field, LoadingScreen, PageHeader, Tabs, Tag, btn, inputCls, selectCls, selectInlineCls } from "@/components/ui";

type Tab = "allocations" | "rooms" | "dormitories" | "types";

const STATE_LABEL: Record<AllocationState, string> = { current: "Living there now", upcoming: "Not started yet", past: "Ended", cancelled: "Cancelled" };

const th = "px-3 py-3 font-medium first:pl-5 last:pr-5";
const td = "px-3 py-3 text-ink-2 first:pl-5 last:pr-5";
const tableCls = "w-full text-left text-sm";
const headCls = "border-b border-line text-xs uppercase tracking-wide text-muted";

/** A number typed into a form field, or null when the field is empty. */
const numberOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export default function AdminAccommodationPage() {
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Accommodation | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("allocations");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Allocation form and filters
  const [residentId, setResidentId] = useState("");
  const [allocDormId, setAllocDormId] = useState("");
  const [allocRoomId, setAllocRoomId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [lastDay, setLastDay] = useState("");

  // Room form
  const [roomEditId, setRoomEditId] = useState<string | null>(null);
  const [roomDormId, setRoomDormId] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [roomFloor, setRoomFloor] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("2");
  const [roomActive, setRoomActive] = useState(true);
  const [roomFilter, setRoomFilter] = useState("all");

  // Dormitory form
  const [dormEditId, setDormEditId] = useState<string | null>(null);
  const [dormName, setDormName] = useState("");
  const [dormAddress, setDormAddress] = useState("");
  const [dormLat, setDormLat] = useState("");
  const [dormLng, setDormLng] = useState("");
  const [dormActive, setDormActive] = useState(true);

  // Room type form
  const [typeEditId, setTypeEditId] = useState<string | null>(null);
  const [typeName, setTypeName] = useState("");
  const [typeActive, setTypeActive] = useState(true);

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) router.push("/");
  }, [user, role, loading, router]);

  const load = useCallback(
    () =>
      fetchAccommodation()
        .then((res) => {
          setData(res);
          setLoadError("");
        })
        .catch(() => setLoadError("The rooms could not be loaded. Please refresh the page.")),
    [],
  );

  useEffect(() => {
    if (!user || role !== "admin") return;
    load();
  }, [user, role, load]);

  /** Run one change, show its result, and read everything again so every count is right. */
  const run = async (work: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
      setMessage({ tone: "success", text: done });
      after?.();
      announceInboxChange();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    setMessage(null);
  };

  if (loading || !user) return <LoadingScreen label="Loading rooms…" />;
  if (!data) {
    return (
      <AppShell role="admin" name={user.name || user.email} detail="Administrator" onSignOut={() => signOut().then(() => router.push("/"))}>
        <PageHeader title="Rooms and residents" />
        {loadError ? <Alert tone="error">{loadError}</Alert> : <p className="text-sm text-muted">Loading…</p>}
      </AppShell>
    );
  }

  const { dormitories, roomTypes, rooms, allocations, residents, today } = data;
  const dormName_ = (id: string) => dormitories.find((d) => d.id === id)?.name ?? "—";
  const activeDormitories = dormitories.filter((d) => d.active);
  const activeTypes = roomTypes.filter((t) => t.active);
  const roomsToReview = rooms.filter((r) => r.needsReview).length;

  /* ---- Allocations ---- */
  const roomChoices = rooms.filter((r) => r.active && r.dormitoryId === allocDormId);
  const shownAllocations = allocations.filter((a) => showAll || a.state === "current" || a.state === "upcoming");
  const submitAllocation = () =>
    run(
      () => allocateRoom({ residentId, roomId: allocRoomId, startDate: startDate || today, endDate: endDate || null }),
      "The room was allocated. The resident has been notified.",
      () => {
        setResidentId("");
        setAllocRoomId("");
        setEndDate("");
      },
    );
  const startEnding = (a: AllocationView) => {
    setEndingId(a.id);
    setLastDay(a.endDate && a.endDate >= today ? a.endDate : today);
    setMessage(null);
  };

  /* ---- Rooms ---- */
  const shownRooms = rooms.filter((r) => roomFilter === "all" || (roomFilter === "review" ? r.needsReview : r.dormitoryId === roomFilter));
  const resetRoom = () => {
    setRoomEditId(null);
    setRoomNumber("");
    setRoomFloor("");
    setRoomCapacity("2");
    setRoomActive(true);
  };
  const editRoom = (r: RoomView) => {
    setRoomEditId(r.id);
    setRoomDormId(r.dormitoryId);
    setRoomNumber(r.number);
    setRoomFloor(r.floor === null ? "" : String(r.floor));
    setRoomTypeId(r.roomTypeId);
    setRoomCapacity(String(r.capacity));
    setRoomActive(r.active);
    setMessage(null);
  };
  const submitRoom = () =>
    run(
      () => saveRoom(roomEditId, { dormitoryId: roomDormId, number: roomNumber, floor: numberOrNull(roomFloor), roomTypeId, capacity: Number(roomCapacity), active: roomActive }),
      roomEditId ? "The room was saved." : "The room was added.",
      resetRoom,
    );

  /* ---- Dormitories ---- */
  const resetDorm = () => {
    setDormEditId(null);
    setDormName("");
    setDormAddress("");
    setDormLat("");
    setDormLng("");
    setDormActive(true);
  };
  const editDorm = (d: Dormitory) => {
    setDormEditId(d.id);
    setDormName(d.name);
    setDormAddress(d.address ?? "");
    setDormLat(d.latitude === null ? "" : String(d.latitude));
    setDormLng(d.longitude === null ? "" : String(d.longitude));
    setDormActive(d.active);
    setMessage(null);
  };
  const submitDorm = () =>
    run(
      () => saveDormitory(dormEditId, { name: dormName, address: dormAddress.trim() || null, latitude: numberOrNull(dormLat), longitude: numberOrNull(dormLng), active: dormActive }),
      dormEditId ? "The dormitory was saved." : "The dormitory was added.",
      resetDorm,
    );

  /* ---- Room types ---- */
  const resetType = () => {
    setTypeEditId(null);
    setTypeName("");
    setTypeActive(true);
  };
  const editType = (t: RoomType) => {
    setTypeEditId(t.id);
    setTypeName(t.name);
    setTypeActive(t.active);
    setMessage(null);
  };
  const submitType = () => run(() => saveRoomType(typeEditId, { name: typeName, active: typeActive }), typeEditId ? "The room type was saved." : "The room type was added.", resetType);

  const activeBox = (id: string, checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-black" />
      {label}
    </label>
  );

  return (
    <AppShell role="admin" name={user.name || user.email} detail="Administrator" onSignOut={() => signOut().then(() => router.push("/"))}>
      <PageHeader
        title="Rooms and residents"
        subtitle="Dormitories, their rooms, and which resident lives in which room. Where a resident lives decides which dormitory's notices and free items they see."
      />

      {loadError && <div className="mb-6"><Alert tone="error">{loadError}</Alert></div>}
      {roomsToReview > 0 && (
        <div className="mb-6">
          <Alert tone="info">
            {roomsToReview} room{roomsToReview > 1 ? "s were" : " was"} created from the old free-text room numbers, with a placeholder type and capacity. Open the Rooms tab, check each one and save it.
          </Alert>
        </div>
      )}

      <div className="mb-6">
        <Tabs<Tab>
          active={tab}
          onChange={changeTab}
          tabs={[
            { value: "allocations", label: "Residents in rooms", count: allocations.filter((a) => a.state === "current").length },
            { value: "rooms", label: "Rooms", count: rooms.length },
            { value: "dormitories", label: "Dormitories", count: dormitories.length },
            { value: "types", label: "Room types", count: roomTypes.length },
          ]}
        />
      </div>

      {message && <div className="mb-6"><Alert tone={message.tone}>{message.text}</Alert></div>}

      {tab === "allocations" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h2 className="mb-4 text-base font-semibold text-ink">Give a resident a room</h2>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitAllocation();
              }}
            >
              <Field label="Resident" required htmlFor="alloc-resident">
                <select id="alloc-resident" required value={residentId} onChange={(e) => setResidentId(e.target.value)} className={selectCls}>
                  <option value="">Choose a resident</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.room ? ` (now: ${r.room})` : " (no room)"}</option>
                  ))}
                </select>
              </Field>
              <Field label="Dormitory" required htmlFor="alloc-dorm">
                <select
                  id="alloc-dorm"
                  required
                  value={allocDormId}
                  onChange={(e) => {
                    setAllocDormId(e.target.value);
                    setAllocRoomId("");
                  }}
                  className={selectCls}
                >
                  <option value="">Choose a dormitory</option>
                  {activeDormitories.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Room" required htmlFor="alloc-room" hint="The number of places taken today is shown for each room.">
                <select id="alloc-room" required value={allocRoomId} onChange={(e) => setAllocRoomId(e.target.value)} className={selectCls} disabled={!allocDormId}>
                  <option value="">Choose a room</option>
                  {roomChoices.map((r) => (
                    <option key={r.id} value={r.id}>Room {r.number} ({r.occupiedToday} of {r.capacity} taken)</option>
                  ))}
                </select>
              </Field>
              <Field label="First day" required htmlFor="alloc-start" hint="Today or a later day.">
                <input id="alloc-start" type="date" required min={today} value={startDate || today} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Last day" htmlFor="alloc-end" hint="Leave empty when the stay has no agreed end.">
                <input id="alloc-end" type="date" min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
              </Field>
              <button type="submit" className={btn.primary} disabled={busy}>Allocate room</button>
            </form>
          </Card>

          <div className="lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">Allocations</h2>
              <label htmlFor="alloc-all" className="flex items-center gap-2 text-sm text-ink-2">
                <input id="alloc-all" type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-black" />
                Also show ended and cancelled
              </label>
            </div>
            {shownAllocations.length === 0 ? (
              <EmptyState title="No allocations" body="No resident has a room yet." />
            ) : (
              <Card className="overflow-x-auto">
                <table className={`${tableCls} min-w-[620px]`}>
                  <thead className={headCls}>
                    <tr>
                      <th className={th}>Resident</th>
                      <th className={th}>Room</th>
                      <th className={th}>First day</th>
                      <th className={th}>Last day</th>
                      <th className={th}>State</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shownAllocations.map((a) => (
                      <tr key={a.id}>
                        <td className={`${td} font-medium text-ink`}>{a.residentName}</td>
                        <td className={td}>{a.dormitoryName}, room {a.roomNumber}</td>
                        <td className={`${td} whitespace-nowrap`}>{a.startDate}</td>
                        <td className={`${td} whitespace-nowrap`}>{a.endDate ?? "—"}</td>
                        <td className={td}><Tag>{STATE_LABEL[a.state]}</Tag></td>
                        <td className={`${td} text-right`}>
                          {a.state === "current" && endingId !== a.id && (
                            <button type="button" className={btn.secondary} disabled={busy} onClick={() => startEnding(a)}>End stay</button>
                          )}
                          {a.state === "current" && endingId === a.id && (
                            <form
                              className="flex flex-wrap items-center justify-end gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                run(() => endAllocation(a.id, lastDay), "The last day was saved. The resident has been notified.", () => setEndingId(null));
                              }}
                            >
                              <label htmlFor={`end-${a.id}`} className="text-xs text-muted">Last day</label>
                              <input id={`end-${a.id}`} type="date" required min={today} max={a.endDate ?? undefined} value={lastDay} onChange={(e) => setLastDay(e.target.value)} className={`${inputCls} w-auto`} />
                              <button type="submit" className={btn.primary} disabled={busy}>Save</button>
                              <button type="button" className={btn.ghost} onClick={() => setEndingId(null)}>Back</button>
                            </form>
                          )}
                          {a.state === "upcoming" && (
                            <button
                              type="button"
                              className={btn.secondary}
                              disabled={busy}
                              onClick={() => window.confirm(`Cancel the allocation of ${a.residentName} from ${a.startDate}?`) && run(() => cancelAllocation(a.id), "The allocation was cancelled. The resident has been notified.")}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <p className="mt-3 text-xs text-muted">Allocations are never deleted: an ended or cancelled allocation stays as the record of who lived where.</p>
          </div>
        </div>
      )}

      {tab === "rooms" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h2 className="mb-4 text-base font-semibold text-ink">{roomEditId ? "Change room" : "Add a room"}</h2>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitRoom();
              }}
            >
              <Field label="Dormitory" required htmlFor="room-dorm" hint={roomEditId ? "A room stays in its dormitory." : undefined}>
                <select id="room-dorm" required value={roomDormId} onChange={(e) => setRoomDormId(e.target.value)} className={selectCls} disabled={!!roomEditId}>
                  <option value="">Choose a dormitory</option>
                  {(roomEditId ? dormitories : activeDormitories).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Room number" required htmlFor="room-number">
                <input id="room-number" required maxLength={20} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Floor" htmlFor="room-floor">
                <input id="room-floor" type="number" min={-5} max={100} step={1} value={roomFloor} onChange={(e) => setRoomFloor(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Room type" required htmlFor="room-type">
                <select id="room-type" required value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className={selectCls}>
                  <option value="">Choose a type</option>
                  {roomTypes.filter((t) => t.active || t.id === roomTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Places" required htmlFor="room-capacity" hint="How many residents the room holds. It cannot be set below the residents already placed.">
                <input id="room-capacity" type="number" required min={1} max={MAX_ROOM_CAPACITY} step={1} value={roomCapacity} onChange={(e) => setRoomCapacity(e.target.value)} className={inputCls} />
              </Field>
              {activeBox("room-active", roomActive, setRoomActive, "In use (new residents can be placed)")}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btn.primary} disabled={busy}>{roomEditId ? "Save room" : "Add room"}</button>
                {roomEditId && <button type="button" className={btn.ghost} onClick={resetRoom}>Stop changing</button>}
              </div>
            </form>
          </Card>

          <div className="lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label htmlFor="room-filter" className="text-sm font-medium text-ink-2">Show</label>
              <select id="room-filter" value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className={selectInlineCls}>
                <option value="all">All rooms</option>
                <option value="review">Rooms to check</option>
                {dormitories.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <span className="text-sm text-muted">{shownRooms.length} of {rooms.length}</span>
            </div>
            {shownRooms.length === 0 ? (
              <EmptyState title="No rooms here" body={rooms.length ? "No rooms match this filter." : "Add a dormitory first, then its rooms."} />
            ) : (
              <Card className="overflow-x-auto">
                <table className={`${tableCls} min-w-[620px]`}>
                  <thead className={headCls}>
                    <tr>
                      <th className={th}>Room</th>
                      <th className={th}>Type</th>
                      <th className={th}>Floor</th>
                      <th className={th}>Places taken</th>
                      <th className={th}>Notes</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shownRooms.map((r) => (
                      <tr key={r.id}>
                        <td className={`${td} font-medium text-ink`}>{dormName_(r.dormitoryId)}, room {r.number}</td>
                        <td className={td}>{r.roomTypeName || "—"}</td>
                        <td className={td}>{r.floor ?? "—"}</td>
                        <td className={`${td} tabular-nums`}>{r.occupiedToday} of {r.capacity}{r.upcoming > 0 && ` (+${r.upcoming} later)`}</td>
                        <td className={td}>
                          <span className="flex flex-wrap gap-1">
                            {r.needsReview && <Tag>Check type and places</Tag>}
                            {!r.active && <Tag>Not in use</Tag>}
                          </span>
                        </td>
                        <td className={`${td} text-right`}><button type="button" className={btn.secondary} onClick={() => editRoom(r)}>Change</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "dormitories" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h2 className="mb-4 text-base font-semibold text-ink">{dormEditId ? "Change dormitory" : "Add a dormitory"}</h2>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitDorm();
              }}
            >
              <Field label="Name" required htmlFor="dorm-name">
                <input id="dorm-name" required minLength={2} maxLength={80} value={dormName} onChange={(e) => setDormName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Address" htmlFor="dorm-address">
                <input id="dorm-address" maxLength={200} value={dormAddress} onChange={(e) => setDormAddress(e.target.value)} className={inputCls} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Latitude" htmlFor="dorm-lat" hint="Optional. For the map.">
                  <input id="dorm-lat" type="number" min={-90} max={90} step="any" value={dormLat} onChange={(e) => setDormLat(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Longitude" htmlFor="dorm-lng">
                  <input id="dorm-lng" type="number" min={-180} max={180} step="any" value={dormLng} onChange={(e) => setDormLng(e.target.value)} className={inputCls} />
                </Field>
              </div>
              {activeBox("dorm-active", dormActive, setDormActive, "In use (rooms can be added and allocated)")}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btn.primary} disabled={busy}>{dormEditId ? "Save dormitory" : "Add dormitory"}</button>
                {dormEditId && <button type="button" className={btn.ghost} onClick={resetDorm}>Stop changing</button>}
              </div>
            </form>
          </Card>

          <div className="lg:col-span-2">
            {dormitories.length === 0 ? (
              <EmptyState title="No dormitories yet" body="Add the first dormitory with the form." />
            ) : (
              <Card className="overflow-x-auto">
                <table className={`${tableCls} min-w-[520px]`}>
                  <thead className={headCls}>
                    <tr>
                      <th className={th}>Dormitory</th>
                      <th className={th}>Address</th>
                      <th className={th}>Rooms</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {dormitories.map((d) => (
                      <tr key={d.id}>
                        <td className={`${td} font-medium text-ink`}>{d.name} {!d.active && <Tag>Not in use</Tag>}</td>
                        <td className={td}>{d.address || "—"}</td>
                        <td className={`${td} tabular-nums`}>{rooms.filter((r) => r.dormitoryId === d.id).length}</td>
                        <td className={`${td} text-right`}><button type="button" className={btn.secondary} onClick={() => editDorm(d)}>Change</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <p className="mt-3 text-xs text-muted">A dormitory is never deleted. One that is no longer used is marked as not in use.</p>
          </div>
        </div>
      )}

      {tab === "types" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h2 className="mb-4 text-base font-semibold text-ink">{typeEditId ? "Change room type" : "Add a room type"}</h2>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitType();
              }}
            >
              <Field label="Name" required htmlFor="type-name" hint="For example: Single, Double, Triple.">
                <input id="type-name" required minLength={2} maxLength={40} value={typeName} onChange={(e) => setTypeName(e.target.value)} className={inputCls} />
              </Field>
              {activeBox("type-active", typeActive, setTypeActive, "In use (can be chosen for a room)")}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btn.primary} disabled={busy}>{typeEditId ? "Save room type" : "Add room type"}</button>
                {typeEditId && <button type="button" className={btn.ghost} onClick={resetType}>Stop changing</button>}
              </div>
            </form>
          </Card>

          <div className="lg:col-span-2">
            {roomTypes.length === 0 ? (
              <EmptyState title="No room types yet" body="Add the first room type with the form." />
            ) : (
              <Card className="overflow-x-auto">
                <table className={`${tableCls} min-w-[420px]`}>
                  <thead className={headCls}>
                    <tr>
                      <th className={th}>Room type</th>
                      <th className={th}>Rooms of this type</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {roomTypes.map((t) => (
                      <tr key={t.id}>
                        <td className={`${td} font-medium text-ink`}>{t.name} {!t.active && <Tag>Not in use</Tag>}</td>
                        <td className={`${td} tabular-nums`}>{rooms.filter((r) => r.roomTypeId === t.id).length}</td>
                        <td className={`${td} text-right`}><button type="button" className={btn.secondary} onClick={() => editType(t)}>Change</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {activeTypes.length === 0 && roomTypes.length > 0 && <p className="mt-3 text-xs text-muted">No room type is in use, so no room can be added.</p>}
          </div>
        </div>
      )}
    </AppShell>
  );
}
