const IMAGE_PATH_PATTERN = /^\/images\/[a-z0-9][a-z0-9/_-]*\.(?:avif|gif|jpe?g|png|webp)$/i;

export const ACCOMMODATION_MAP_MARKERS = Object.freeze([
  Object.freeze({ id: "hotel-room", stayId: "hotel-room", unitIds: [] }),
  Object.freeze({ id: "cottage", stayId: "cottage", unitIds: [] }),
  Object.freeze({ id: "hunter-house-1", stayId: "hunter-house", unitIds: ["hunter-house-1"] }),
  Object.freeze({ id: "hunter-house-2", stayId: "hunter-house", unitIds: ["hunter-house-2"] }),
]);

export const ACCOMMODATION_MAP_MARKER_IDS = new Set(
  ACCOMMODATION_MAP_MARKERS.map((marker) => marker.id),
);

const MARKER_BY_ID = new Map(ACCOMMODATION_MAP_MARKERS.map((marker) => [marker.id, marker]));

function cleanText(value, maximum, label) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text || text.length > maximum) throw new TypeError(label);
  return text;
}

export function normalizeMapCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("Некорректная координата маркера.");
  return Math.round(Math.min(100, Math.max(0, number)) * 100) / 100;
}

export function isPreparedAccommodationImagePath(value) {
  return typeof value === "string"
    && value.length <= 240
    && IMAGE_PATH_PATTERN.test(value)
    && !value.includes("..")
    && !value.includes("?")
    && !value.includes("#");
}

function cleanImagePath(value, label) {
  if (!isPreparedAccommodationImagePath(value)) throw new TypeError(label);
  return value;
}

function normalizeMarker(marker) {
  const base = MARKER_BY_ID.get(marker?.id);
  if (!base) throw new TypeError("Неизвестный маркер размещения.");

  return {
    id: base.id,
    stayId: base.stayId,
    unitIds: [...base.unitIds],
    title: cleanText(marker.title, 90, "Укажите название объекта до 90 символов."),
    description: cleanText(marker.description, 280, "Укажите подпись объекта до 280 символов."),
    photoUrl: cleanImagePath(marker.photoUrl, "Фото должно быть подготовленным путём из /images/."),
    photoAlt: cleanText(marker.photoAlt, 180, "Укажите alt-текст фотографии до 180 символов."),
    x: normalizeMapCoordinate(marker.x),
    y: normalizeMapCoordinate(marker.y),
  };
}

export function validateAccommodationMap(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Схема размещения должна быть объектом.");
    }

    const markers = Array.isArray(value.markers) ? value.markers.map(normalizeMarker) : [];
    const ids = new Set(markers.map((marker) => marker.id));
    if (markers.length !== ACCOMMODATION_MAP_MARKERS.length || ids.size !== markers.length) {
      throw new TypeError("На схеме должны быть четыре уникальных маркера размещения.");
    }
    for (const marker of ACCOMMODATION_MAP_MARKERS) {
      if (!ids.has(marker.id)) throw new TypeError("На схеме отсутствует обязательный маркер.");
    }

    return {
      ok: true,
      value: {
        baseImageUrl: cleanImagePath(value.baseImageUrl, "Подложка должна быть подготовленным путём из /images/."),
        baseImageAlt: cleanText(value.baseImageAlt, 180, "Укажите alt-текст подложки до 180 символов."),
        markers,
      },
    };
  } catch (error) {
    return { ok: false, error: error?.message || "Некорректная схема размещения." };
  }
}

export function createAccommodationMapDraft() {
  return {
    baseImageUrl: "/images/lodge-interior.webp",
    baseImageAlt: "Черновая подложка схемы размещения — замените на подготовленный план территории",
    markers: [
      {
        id: "hotel-room",
        title: "Дом охотника и рыболова",
        description: "Шесть двухместных номеров.",
        photoUrl: "/images/lodge-interior.webp",
        photoAlt: "Интерьер дома охотника и рыболова",
        x: 25,
        y: 44,
      },
      {
        id: "cottage",
        title: "Коттедж",
        description: "Коттедж для одной группы до 15 гостей.",
        photoUrl: "/images/lodge-interior.webp",
        photoAlt: "Иллюстративное фото коттеджа",
        x: 57,
        y: 31,
      },
      {
        id: "hunter-house-1",
        title: "Дом охотника № 1",
        description: "Отдельный дом для группы до 6 гостей.",
        photoUrl: "/images/lodge-interior.webp",
        photoAlt: "Иллюстративное фото дома охотника № 1",
        x: 68,
        y: 63,
      },
      {
        id: "hunter-house-2",
        title: "Дом охотника № 2",
        description: "Отдельный дом для группы до 6 гостей.",
        photoUrl: "/images/lodge-interior.webp",
        photoAlt: "Иллюстративное фото дома охотника № 2",
        x: 40,
        y: 74,
      },
    ],
  };
}

export function getAccommodationMarker(config, markerId) {
  return config?.markers?.find((marker) => marker.id === markerId) ?? null;
}

export function getAccommodationMarkersForStay(config, stayId) {
  return config?.markers?.filter((marker) => marker.stayId === stayId) ?? [];
}
