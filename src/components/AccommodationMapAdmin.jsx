import { useEffect, useRef, useState } from "react";
import { FloppyDisk, LockKey, SignOut, UploadSimple } from "@phosphor-icons/react";

import {
  ACCOMMODATION_MAP_MARKERS,
  createAccommodationMapDraft,
  getAccommodationMarker,
  normalizeMapCoordinate,
} from "../accommodation-map/config.js";

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
  return data;
}

function markerLabel(id) {
  return ACCOMMODATION_MAP_MARKERS.find((marker) => marker.id === id)?.id === "hotel-room"
    ? "Номера"
    : id === "cottage"
      ? "Коттедж"
      : id === "hunter-house-1"
        ? "Дом № 1"
        : "Дом № 2";
}

export function AccommodationMapAdmin() {
  const [authenticated, setAuthenticated] = useState(null);
  const [password, setPassword] = useState("");
  const [config, setConfig] = useState(createAccommodationMapDraft);
  const [selectedId, setSelectedId] = useState("hotel-room");
  const [draggingId, setDraggingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);

  const loadDraft = async () => {
    const result = await requestJson("/api/admin/accommodation-map/draft");
    setConfig(result.config ?? createAccommodationMapDraft());
    setSelectedId((current) => getAccommodationMarker(result.config, current) ? current : "hotel-room");
  };

  useEffect(() => {
    let mounted = true;
    requestJson("/api/admin/accommodation-map/session")
      .then(async (result) => {
        if (!mounted) return;
        setAuthenticated(result.authenticated);
        if (result.authenticated) await loadDraft();
      })
      .catch((requestError) => {
        if (!mounted) return;
        setAuthenticated(false);
        setError(requestError.message);
      });
    return () => { mounted = false; };
  }, []);

  const updateMarker = (id, patch) => {
    setConfig((current) => ({
      ...current,
      markers: current.markers.map((marker) => marker.id === id ? { ...marker, ...patch } : marker),
    }));
  };

  const positionFromEvent = (event) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || !draggingId) return;
    updateMarker(draggingId, {
      x: normalizeMapCoordinate(((event.clientX - bounds.left) / bounds.width) * 100),
      y: normalizeMapCoordinate(((event.clientY - bounds.top) / bounds.height) * 100),
    });
  };

  const login = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await requestJson("/api/admin/accommodation-map/session", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setAuthenticated(result.authenticated);
      await loadDraft();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson("/api/admin/accommodation-map/draft", {
        method: "PUT",
        body: JSON.stringify({ config }),
      });
      setConfig(result.config ?? config);
      setNotice("Черновик сохранён. Гости его пока не видят.");
      return result.config ?? config;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    try {
      await saveDraft();
      setBusy(true);
      const result = await requestJson("/api/admin/accommodation-map/publish", { method: "POST" });
      setConfig(result.config ?? config);
      setNotice("Схема опубликована: гости увидят новую версию при следующей загрузке блока.");
    } catch {
      // The API has already provided an actionable message.
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await requestJson("/api/admin/accommodation-map/session", { method: "DELETE" });
      setAuthenticated(false);
      setNotice("");
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const selected = getAccommodationMarker(config, selectedId) ?? config.markers[0];

  if (authenticated === null) {
    return <main className="map-admin map-admin--loading"><p>Открываем редактор схемы…</p></main>;
  }

  if (!authenticated) {
    return (
      <main className="map-admin map-admin--login">
        <section className="map-admin-login" aria-labelledby="map-admin-title">
          <LockKey size={30} weight="light" aria-hidden="true" />
          <p className="section-label">Закрытая страница</p>
          <h1 id="map-admin-title">Схема размещения</h1>
          <p>Войдите по паролю владельца. Подготовленные изображения должны уже лежать в папке сайта <code>/public/images</code>.</p>
          <form onSubmit={login}>
            <label>
              Пароль
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="map-admin__error" role="alert">{error}</p>}
            <button className="pill-button" type="submit" disabled={busy}>
              <LockKey size={17} weight="regular" /> Войти
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="map-admin" aria-labelledby="map-admin-title">
      <header className="map-admin__header page-shell">
        <div>
          <p className="section-label">Редактор владельца</p>
          <h1 id="map-admin-title">Схема размещения</h1>
          <p>Черновик виден только здесь. Публикация заменяет гостевую версию целиком.</p>
        </div>
        <button type="button" className="map-admin__logout" onClick={logout} disabled={busy}>
          <SignOut size={17} weight="regular" /> Выйти
        </button>
      </header>

      <section className="map-admin__workspace page-shell">
        <div className="map-admin__canvas-wrap">
          <div
            className="map-admin__canvas"
            ref={canvasRef}
            onPointerMove={positionFromEvent}
            onPointerUp={() => setDraggingId(null)}
            onPointerCancel={() => setDraggingId(null)}
          >
            <img src={config.baseImageUrl} alt="Предпросмотр подложки схемы" />
            {config.markers.map((marker) => (
              <button
                type="button"
                key={marker.id}
                className={`map-admin__marker${selectedId === marker.id ? " is-selected" : ""}`}
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                aria-label={`${markerLabel(marker.id)}: ${marker.title}`}
                onClick={() => setSelectedId(marker.id)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  setSelectedId(marker.id);
                  setDraggingId(marker.id);
                }}
                onKeyDown={(event) => {
                  const changes = {
                    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
                  }[event.key];
                  if (!changes) return;
                  event.preventDefault();
                  const step = event.shiftKey ? 5 : 1;
                  updateMarker(marker.id, {
                    x: normalizeMapCoordinate(marker.x + changes[0] * step),
                    y: normalizeMapCoordinate(marker.y + changes[1] * step),
                  });
                }}
              >
                {markerLabel(marker.id)}
              </button>
            ))}
          </div>
          <p className="map-admin__hint">Тяните маркеры мышью или используйте стрелки на клавиатуре; Shift меняет шаг на 5%.</p>
        </div>

        <aside className="map-admin__controls">
          <label className="map-admin__field map-admin__field--wide">
            Подложка схемы (site-relative путь)
            <input
              value={config.baseImageUrl}
              onChange={(event) => setConfig((current) => ({ ...current, baseImageUrl: event.target.value }))}
              spellCheck="false"
            />
          </label>
          <label className="map-admin__field map-admin__field--wide">
            Alt-текст подложки
            <input
              value={config.baseImageAlt}
              onChange={(event) => setConfig((current) => ({ ...current, baseImageAlt: event.target.value }))}
            />
          </label>

          <div className="map-admin__marker-select" role="tablist" aria-label="Объекты на схеме">
            {config.markers.map((marker) => (
              <button
                type="button"
                role="tab"
                key={marker.id}
                aria-selected={selectedId === marker.id}
                className={selectedId === marker.id ? "is-selected" : ""}
                onClick={() => setSelectedId(marker.id)}
              >
                {markerLabel(marker.id)}
              </button>
            ))}
          </div>

          <label className="map-admin__field">
            Название
            <input value={selected.title} onChange={(event) => updateMarker(selected.id, { title: event.target.value })} />
          </label>
          <label className="map-admin__field">
            Подпись
            <textarea value={selected.description} onChange={(event) => updateMarker(selected.id, { description: event.target.value })} rows="3" />
          </label>
          <label className="map-admin__field">
            Фото (site-relative путь)
            <input value={selected.photoUrl} onChange={(event) => updateMarker(selected.id, { photoUrl: event.target.value })} spellCheck="false" />
          </label>
          <label className="map-admin__field">
            Alt-текст фото
            <input value={selected.photoAlt} onChange={(event) => updateMarker(selected.id, { photoAlt: event.target.value })} />
          </label>
          <div className="map-admin__coordinates" aria-label="Координаты выбранного маркера">
            <label>X <input type="number" min="0" max="100" value={selected.x} onChange={(event) => updateMarker(selected.id, { x: event.target.value })} /></label>
            <label>Y <input type="number" min="0" max="100" value={selected.y} onChange={(event) => updateMarker(selected.id, { y: event.target.value })} /></label>
          </div>

          {(error || notice) && <p className={error ? "map-admin__error" : "map-admin__notice"} role={error ? "alert" : "status"}>{error || notice}</p>}
          <div className="map-admin__actions">
            <button type="button" className="map-admin__save" onClick={saveDraft} disabled={busy}>
              <FloppyDisk size={17} weight="regular" /> Сохранить черновик
            </button>
            <button type="button" className="pill-button" onClick={publish} disabled={busy}>
              <UploadSimple size={17} weight="regular" /> Опубликовать
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}
