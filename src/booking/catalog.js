const rubleFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

// Replace this single value when the confirmed nightly rate becomes available.
export const HUNTER_HOUSE_PRICE_PER_NIGHT = null;

export const stayCatalog = Object.freeze([
  Object.freeze({
    id: "hotel-room",
    label: "Двухместный номер",
    description: "Номер с отдельным входом, душем, санузлом, гардеробом, телевидением и кондиционером.",
    selectionType: "quantity",
    pricePerNight: 6_500,
    capacityPerUnit: 2,
    minUnits: 1,
    maxUnits: 6,
    unitLabel: "номер",
  }),
  Object.freeze({
    id: "cottage",
    label: "Коттедж",
    description: "Двухэтажный деревянный дом для одной группы до 15 гостей.",
    selectionType: "fixed",
    pricePerNight: 45_000,
    capacityPerUnit: 15,
    minUnits: 1,
    maxUnits: 1,
    unitLabel: "коттедж",
  }),
  Object.freeze({
    id: "hunter-house",
    label: "Дома охотника",
    description: "Два отдельных дома охотника, каждый рассчитан на группу до 6 гостей.",
    selectionType: "units",
    pricePerNight: HUNTER_HOUSE_PRICE_PER_NIGHT,
    capacityPerUnit: 6,
    minUnits: 1,
    maxUnits: 2,
    unitLabel: "дом",
    unitOptions: Object.freeze([
      Object.freeze({ id: "hunter-house-1", label: "Дом охотника № 1" }),
      Object.freeze({ id: "hunter-house-2", label: "Дом охотника № 2" }),
    ]),
  }),
]);

export const STAY_CATALOG = stayCatalog;

export function getStayById(id) {
  return stayCatalog.find((stay) => stay.id === id) ?? null;
}

function resolveStay(stayOrId) {
  return typeof stayOrId === "string" ? getStayById(stayOrId) : stayOrId;
}

function getSelectedUnitCount(stay, selection = {}) {
  if (!stay) return 0;

  if (stay.selectionType === "units") {
    if (!Array.isArray(selection.unitIds)) return 0;

    const allowedIds = new Set(stay.unitOptions.map((unit) => unit.id));
    return new Set(selection.unitIds.filter((id) => allowedIds.has(id))).size;
  }

  if (stay.selectionType === "fixed") {
    return 1;
  }

  return Number.isInteger(selection.quantity) ? selection.quantity : 0;
}

export function getSelectionCapacity(stayOrId, selection = {}) {
  const stay = resolveStay(stayOrId);
  const unitCount = getSelectedUnitCount(stay, selection);
  return stay ? stay.capacityPerUnit * unitCount : 0;
}

export const getStayCapacity = getSelectionCapacity;

export function calculateBookingTotal(stayOrId, nights, selection = {}) {
  const stay = resolveStay(stayOrId);

  if (!stay || stay.pricePerNight === null || !Number.isInteger(nights) || nights < 1) {
    return null;
  }

  const unitCount = getSelectedUnitCount(stay, selection);
  return unitCount > 0 ? stay.pricePerNight * nights * unitCount : null;
}

export function formatRubles(value) {
  return Number.isFinite(value) ? `${rubleFormatter.format(value)} ₽` : "X ₽";
}

export const formatPrice = formatRubles;

export function formatNightlyRate(stayOrId) {
  const stay = resolveStay(stayOrId);
  return stay ? `${formatRubles(stay.pricePerNight)}/сутки` : "X ₽/сутки";
}
