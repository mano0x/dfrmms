"use client";
import { FAULT_AREA_VALUES, LOCATION_LABEL, LOCATION_VALUES, areaLabel, type FaultArea, type LocationType } from "@/lib/fault-location";
import { Field, selectCls } from "@/components/ui";

/**
 * The question on the report form: is the fault in the resident's room or
 * in a shared area of their dormitory, and if so in which. The dormitory is
 * not asked: the server takes it from where the resident lives today.
 */
export function LocationChoice({
  name, location, area, onLocation, onArea,
}: {
  name: string;
  location: LocationType;
  area: FaultArea | "";
  onLocation: (value: LocationType) => void;
  onArea: (value: FaultArea | "") => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">Where is the fault? <span aria-hidden>*</span></legend>
      <div className="mt-2 grid gap-2">
        {LOCATION_VALUES.map((value) => (
          <label key={value} className="flex items-start gap-2 text-sm text-ink">
            <input type="radio" name={name} required checked={location === value} onChange={() => onLocation(value)} className="mt-1 accent-black" />
            {LOCATION_LABEL[value]}
          </label>
        ))}
      </div>
      {location === "shared" && (
        <div className="mt-3">
          <Field label="Shared area" required htmlFor={`${name}-area`} hint="Say in the description where exactly, for example which floor.">
            <select id={`${name}-area`} required value={area} onChange={(e) => onArea(e.target.value as FaultArea | "")} className={selectCls}>
              <option value="">Choose an area</option>
              {FAULT_AREA_VALUES.map((value) => <option key={value} value={value}>{areaLabel(value)}</option>)}
            </select>
          </Field>
        </div>
      )}
    </fieldset>
  );
}
