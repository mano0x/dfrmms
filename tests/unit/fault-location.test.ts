import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FAULT_AREA_VALUES, areaLabel, isSharedArea, locationFields, locationProblem, placeLabel, placeShort, storedLocation } from "../../lib/fault-location";
import { NOTICE_AREA_VALUES } from "../../lib/neighbour";

const schema = z.object(locationFields);
const stored = { dormitory: "Dormitory A", roomNumber: "204" };

describe("where a fault is", () => {
  it("FR-08: a report says \"room\" or \"shared\"; left out, it is the resident's room", () => {
    expect(schema.parse({})).toEqual({ location: "room" });
    expect(schema.parse({ location: "shared", area: "kitchen" })).toEqual({ location: "shared", area: "kitchen" });
    for (const location of ["corridor", "", "Room", 1, null]) expect(schema.safeParse({ location }).success, String(location)).toBe(false);
  });
  it("FR-08: the shared areas are the list the neighbour notices use", () => {
    expect(FAULT_AREA_VALUES).toBe(NOTICE_AREA_VALUES);
    for (const area of NOTICE_AREA_VALUES) expect(schema.safeParse({ location: "shared", area }).success, area).toBe(true);
    for (const area of ["roof", "room 204", "Kitchen", 3]) expect(schema.safeParse({ location: "shared", area }).success, String(area)).toBe(false);
  });
  it("FR-08: a shared area must be named", () => {
    expect(locationProblem({ location: "shared" })).toMatch(/Choose the shared area/);
    expect(locationProblem({ location: "shared", area: null })).toMatch(/Choose the shared area/);
    expect(locationProblem({ location: "shared", area: "laundry" })).toBeNull();
    expect(locationProblem({ location: "room" })).toBeNull();
  });
  it("FR-08: for a fault in the room no area is stored, whatever was sent", () => {
    expect(storedLocation({ location: "room", area: "kitchen" })).toEqual({ locationType: "room", area: null });
    expect(storedLocation({ location: "room" })).toEqual({ locationType: "room", area: null });
    expect(storedLocation({ location: "shared", area: "stairwell" })).toEqual({ locationType: "shared", area: "stairwell" });
  });
});

describe("reading a stored report", () => {
  it("FR-V: only a report stored as shared, with an area, counts as a shared area", () => {
    expect(isSharedArea({ locationType: "shared", area: "kitchen" })).toBe(true);
    expect(isSharedArea({ locationType: "room", area: null })).toBe(false);
  });
  it("FR-V: a report from before this module, or with a value nobody knows, is treated as a room", () => {
    for (const report of [{}, { locationType: null, area: null }, { locationType: "shared", area: null }, { locationType: "Shared", area: "kitchen" }, { locationType: "everywhere", area: "kitchen" }]) {
      expect(isSharedArea(report), JSON.stringify(report)).toBe(false);
    }
  });
  it("FR-08: the place is named by the room or by the area", () => {
    expect(placeLabel({ ...stored })).toBe("Dormitory A, room 204");
    expect(placeLabel({ ...stored, locationType: "room", area: null })).toBe("Dormitory A, room 204");
    expect(placeLabel({ ...stored, locationType: "shared", area: "common-room" })).toBe("Dormitory A, common room (shared area)");
    expect(placeShort({ ...stored })).toBe("Room 204");
    expect(placeShort({ ...stored, locationType: "shared", area: "laundry" })).toBe("Laundry room");
  });
  it("FR-08: an area that is no longer in the list is still shown as a shared area", () => {
    expect(areaLabel("kitchen")).toBe("Kitchen");
    expect(areaLabel("sauna")).toBe("Shared area");
    expect(areaLabel(null)).toBe("Shared area");
    expect(placeLabel({ ...stored, locationType: "shared", area: "sauna" })).toBe("Dormitory A, shared area");
  });
});
