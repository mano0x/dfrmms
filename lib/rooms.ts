/**
 * Browser-side data layer for dormitories, rooms and allocations. Every
 * function calls one of the application's own server routes; the server
 * decides what the signed-in user may see and do (lib/accommodation.ts).
 */
import { api } from "./api";
import type { AllocationView, Dormitory, OwnAllocationView, RoomType, RoomView } from "./accommodation";
import type { AccommodationData } from "./server/accommodation"; // types only - no server code is bundled

export type Accommodation = AccommodationData;

export type DormitoryForm = { name: string; address: string | null; latitude: number | null; longitude: number | null; active: boolean };
export type RoomTypeForm = { name: string; active: boolean };
export type RoomForm = { dormitoryId: string; number: string; floor: number | null; roomTypeId: string; capacity: number; active: boolean };
export type AllocationForm = { residentId: string; roomId: string; startDate: string; endDate: string | null };

const base = "/api/accommodation";
const at = (path: string, id: string) => `${base}/${path}/${encodeURIComponent(id)}`;

export const fetchAccommodation = () => api<Accommodation>(base);
export const fetchOwnAllocations = async () => (await api<{ allocations: OwnAllocationView[] }>(`${base}/mine`)).allocations;

export const saveDormitory = async (id: string | null, input: DormitoryForm) =>
  (await api<{ dormitory: Dormitory }>(id ? at("dormitories", id) : `${base}/dormitories`, { method: id ? "PATCH" : "POST", body: input })).dormitory;

export const saveRoomType = async (id: string | null, input: RoomTypeForm) =>
  (await api<{ roomType: RoomType }>(id ? at("room-types", id) : `${base}/room-types`, { method: id ? "PATCH" : "POST", body: input })).roomType;

export const saveRoom = async (id: string | null, input: RoomForm) =>
  (await api<{ room: RoomView }>(id ? at("rooms", id) : `${base}/rooms`, { method: id ? "PATCH" : "POST", body: input })).room;

export const allocateRoom = async (input: AllocationForm) =>
  (await api<{ allocation: AllocationView }>(`${base}/allocations`, { method: "POST", body: input })).allocation;

export const endAllocation = async (id: string, lastDay: string) =>
  (await api<{ allocation: AllocationView }>(at("allocations", id), { method: "PATCH", body: { action: "end", lastDay } })).allocation;

export const cancelAllocation = async (id: string) =>
  (await api<{ allocation: AllocationView }>(at("allocations", id), { method: "PATCH", body: { action: "cancel" } })).allocation;
