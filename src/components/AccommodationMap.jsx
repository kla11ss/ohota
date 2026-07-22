import { ArrowUpRight, MapPin } from "@phosphor-icons/react";

import {
  getAccommodationMarker,
  getAccommodationMarkersForStay,
} from "../accommodation-map/config.js";

const YANDEX_OVERVIEW_URL = "https://yandex.ru/maps/org/okhotkhozyaystvo_velikovskoye/240564135810/?ll=45.363507%2C56.117931&z=14";

function markerNumber(markerId) {
  if (markerId === "hotel-room") return "Н";
  if (markerId === "cottage") return "К";
  return markerId.endsWith("-1") ? "1" : "2";
}

export function AccommodationMap({
  config,
  activeStayId,
  activeMarkerId,
  onSelectMarker,
}) {
  const stayMarkers = getAccommodationMarkersForStay(config, activeStayId);
  const selectedMarker = getAccommodationMarker(config, activeMarkerId)
    ?? stayMarkers[0]
    ?? config.markers[0];

  return (
    <figure className="accommodation-map" aria-labelledby="accommodation-map-title">
      <div className="accommodation-map__canvas">
        <img
          src={config.baseImageUrl}
          alt={config.baseImageAlt}
          loading="lazy"
        />
        <div className="accommodation-map__shade" aria-hidden="true" />
        <p className="accommodation-map__label" id="accommodation-map-title">Схема размещения</p>
        {config.markers.map((marker) => {
          const isFocused = marker.id === selectedMarker.id;
          const isGroupActive = marker.stayId === activeStayId;
          return (
            <button
              className={`accommodation-map__marker${isGroupActive ? " is-active" : ""}${isFocused ? " is-focused" : ""}`}
              type="button"
              key={marker.id}
              style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              onClick={() => onSelectMarker(marker)}
              aria-pressed={isFocused}
              aria-label={`Показать: ${marker.title}`}
            >
              <MapPin size={22} weight={isFocused ? "fill" : "regular"} aria-hidden="true" />
              <span aria-hidden="true">{markerNumber(marker.id)}</span>
            </button>
          );
        })}
      </div>
      <figcaption className="accommodation-map__card">
        <img src={selectedMarker.photoUrl} alt={selectedMarker.photoAlt} loading="lazy" />
        <div>
          <span>На схеме</span>
          <strong>{selectedMarker.title}</strong>
          <p>{selectedMarker.description}</p>
          <a href={YANDEX_OVERVIEW_URL} target="_blank" rel="noreferrer">
            Открыть общую карту <ArrowUpRight size={15} weight="regular" aria-hidden="true" />
          </a>
        </div>
      </figcaption>
    </figure>
  );
}
