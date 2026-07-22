import { randomUUID } from "node:crypto";

const DATABASE_NOT_CONFIGURED = "BOOKING_DATABASE_NOT_CONFIGURED";

let sharedRepositoryPromise;

function asNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asIsoDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "");
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(text);
  return isoDate?.[0] ?? text;
}

function mapRequestRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    requestKey: row.request_key,
    metadataHash: row.metadata_hash,
    stayId: row.stay_id,
    unitCount: Number(row.unit_count),
    selectedUnitIds: row.selected_unit_ids ?? [],
    checkIn: asIsoDate(row.check_in),
    checkOut: asIsoDate(row.check_out),
    adults: Number(row.adults),
    children: Number(row.children),
    capacity: Number(row.capacity),
    nights: Number(row.nights),
    nightlyRate: asNumber(row.nightly_rate),
    total: asNumber(row.estimated_total),
    status: row.status,
    allocatedUnitIds: row.allocated_unit_ids ?? [],
    telegramChatId: row.telegram_chat_id === null ? null : String(row.telegram_chat_id),
    telegramMessageId: asNumber(row.telegram_message_id),
    telegramTopicId: asNumber(row.telegram_topic_id),
    telegramRoutingClaimToken: row.telegram_routing_claim_token ?? null,
    telegramRoutingClaimedAt: row.telegram_routing_claimed_at ?? null,
    notificationError: row.notification_error ?? null,
  };
}

function mapTransitionRow(row) {
  return {
    ok: Boolean(row?.ok),
    code: row?.result_code ?? "unknown",
    status: row?.request_status ?? null,
    allocatedUnitIds: row?.allocated_unit_ids ?? [],
  };
}

function mapAccommodationMapConfig(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function cloneMapConfig(value) {
  return value ? structuredClone(value) : null;
}

export function createPostgresBookingRepository(sql) {
  if (typeof sql !== "function") {
    throw new TypeError("A postgres.js sql client is required");
  }

  async function markTelegramDelivered(requestId, telegram) {
    const rows = await sql`
      update public.booking_requests
      set telegram_chat_id = ${telegram.chatId},
          telegram_message_id = ${telegram.messageId},
          telegram_topic_id = ${telegram.topicId},
          telegram_routing_claim_token = null,
          telegram_routing_claimed_at = null,
          notification_error = null,
          notified_at = coalesce(notified_at, now()),
          updated_at = now()
      where id = ${requestId}
      returning *
    `;
    return mapRequestRow(rows[0]);
  }

  return {
    async getPublishedAccommodationMap() {
      const rows = await sql`select public.get_published_accommodation_map() as config`;
      return mapAccommodationMapConfig(rows[0]?.config);
    },

    async getAccommodationMapDraft() {
      const rows = await sql`select public.get_accommodation_map_draft() as config`;
      return mapAccommodationMapConfig(rows[0]?.config);
    },

    async saveAccommodationMapDraft(config) {
      const rows = await sql`
        select public.save_accommodation_map_draft(${JSON.stringify(config)}::jsonb) as config
      `;
      return mapAccommodationMapConfig(rows[0]?.config);
    },

    async publishAccommodationMap() {
      const rows = await sql`select public.publish_accommodation_map() as config`;
      return mapAccommodationMapConfig(rows[0]?.config);
    },

    async getRequestByRequestKey(requestKey) {
      const rows = await sql`
        select * from public.booking_requests where request_key = ${requestKey} limit 1
      `;
      return mapRequestRow(rows[0]);
    },

    async createOrGetRequest(metadata) {
      const rows = await sql`
        with inserted as (
          insert into public.booking_requests (
            id,
            request_key,
            metadata_hash,
            stay_id,
            unit_count,
            selected_unit_ids,
            check_in,
            check_out,
            adults,
            children,
            capacity,
            nights,
            nightly_rate,
            estimated_total,
            status
          ) values (
            ${metadata.id},
            ${metadata.requestKey},
            ${metadata.metadataHash},
            ${metadata.stayId},
            ${metadata.unitCount},
            ${metadata.selectedUnitIds},
            ${metadata.checkIn},
            ${metadata.checkOut},
            ${metadata.adults},
            ${metadata.children},
            ${metadata.capacity},
            ${metadata.nights},
            ${metadata.nightlyRate},
            ${metadata.total},
            'pending'
          )
          on conflict (request_key) do nothing
          returning *, true as created
        )
        select * from inserted
        union all
        select existing.*, false as created
        from public.booking_requests existing
        where existing.request_key = ${metadata.requestKey}
          and not exists (select 1 from inserted)
        limit 1
      `;

      const row = rows[0];
      return { created: Boolean(row?.created), request: mapRequestRow(row) };
    },

    async getRequest(requestId) {
      const rows = await sql`
        select request.*, coalesce(allocations.unit_ids, array[]::text[]) as allocated_unit_ids
        from public.booking_requests request
        left join lateral (
          select array_agg(allocation.unit_id order by allocation.unit_id) as unit_ids
          from public.booking_allocations allocation
          where allocation.request_id = request.id
        ) allocations on true
        where request.id = ${requestId}
        limit 1
      `;
      return mapRequestRow(rows[0]);
    },

    markTelegramDelivered,

    async markNotificationFailed(requestId, errorCode = "telegram_delivery_failed") {
      const rows = await sql`
        update public.booking_requests
        set status = case when status = 'pending' then 'notification_failed' else status end,
            notification_error = ${String(errorCode).slice(0, 160)},
            updated_at = now()
        where id = ${requestId}
        returning *
      `;
      return mapRequestRow(rows[0]);
    },

    async claimNotificationDelivery(requestId) {
      const rows = await sql`
        update public.booking_requests
        set status = 'pending',
            notification_error = 'telegram_delivery_in_progress',
            updated_at = now()
        where id = ${requestId}
          and telegram_message_id is null
          and status in ('pending', 'notification_failed')
          and (
            notification_error is null
            or notification_error <> 'telegram_delivery_in_progress'
            or updated_at < now() - interval '2 minutes'
          )
        returning *
      `;
      return mapRequestRow(rows[0]);
    },

    async updateTelegramLocation(requestId, telegram) {
      return markTelegramDelivered(requestId, telegram);
    },

    async claimTelegramRouting(requestId, source) {
      const claimToken = randomUUID();
      const rows = await sql`
        update public.booking_requests
        set telegram_routing_claim_token = ${claimToken},
            telegram_routing_claimed_at = now(),
            updated_at = now()
        where id = ${requestId}
          and telegram_chat_id = ${source.chatId}
          and telegram_message_id = ${source.messageId}
          and telegram_topic_id = ${source.topicId}
          and (
            telegram_routing_claim_token is null
            or telegram_routing_claimed_at < now() - interval '2 minutes'
          )
        returning id
      `;
      return rows[0] ? { claimed: true, claimToken } : { claimed: false, claimToken: null };
    },

    async completeTelegramRouting(requestId, claimToken, telegram) {
      const rows = await sql`
        update public.booking_requests
        set telegram_chat_id = ${telegram.chatId},
            telegram_message_id = ${telegram.messageId},
            telegram_topic_id = ${telegram.topicId},
            telegram_routing_claim_token = null,
            telegram_routing_claimed_at = null,
            notification_error = null,
            notified_at = coalesce(notified_at, now()),
            updated_at = now()
        where id = ${requestId}
          and telegram_routing_claim_token = ${claimToken}
        returning *
      `;
      return mapRequestRow(rows[0]);
    },

    async releaseTelegramRouting(requestId, claimToken) {
      const rows = await sql`
        update public.booking_requests
        set telegram_routing_claim_token = null,
            telegram_routing_claimed_at = null,
            updated_at = now()
        where id = ${requestId}
          and telegram_routing_claim_token = ${claimToken}
        returning id
      `;
      return Boolean(rows[0]);
    },

    async recordNotificationError(requestId, errorCode) {
      await sql`
        update public.booking_requests
        set notification_error = ${String(errorCode).slice(0, 160)}, updated_at = now()
        where id = ${requestId}
      `;
    },

    async reserveRateLimit(clientHashes, windowSeconds = 20) {
      const rows = await sql`
        select * from public.reserve_booking_rate_limit(${clientHashes}, ${windowSeconds})
      `;
      return {
        allowed: Boolean(rows[0]?.allowed),
        retryAfterSeconds: asNumber(rows[0]?.retry_after_seconds) ?? 0,
        reservationToken: rows[0]?.reservation_token
          ? String(rows[0].reservation_token)
          : null,
      };
    },

    async releaseRateLimit(clientHash, reservationToken) {
      const rows = await sql`
        select public.release_booking_rate_limit(
          ${clientHash},
          ${reservationToken}
        ) as released
      `;
      return Boolean(rows[0]?.released);
    },

    async cleanupRateLimits(retentionSeconds = 172_800, batchSize = 500) {
      const rows = await sql`
        select public.cleanup_booking_rate_limits(
          ${retentionSeconds},
          ${batchSize}
        ) as removed_count
      `;
      return asNumber(rows[0]?.removed_count) ?? 0;
    },

    async claimTelegramUpdate(updateId) {
      const rows = await sql`select public.claim_telegram_update(${updateId}) as claim_state`;
      return rows[0]?.claim_state ?? "processing";
    },

    async completeTelegramUpdate(updateId) {
      await sql`select public.complete_telegram_update(${updateId})`;
    },

    async releaseTelegramUpdate(updateId) {
      await sql`select public.release_telegram_update(${updateId})`;
    },

    async claimTripMessageRouting(source, targetTopicId) {
      const claimToken = randomUUID();
      const rows = await sql`
        select * from public.claim_trip_message_routing(
          ${source.chatId},
          ${source.messageId},
          ${source.topicId},
          ${targetTopicId},
          ${claimToken}
        )
      `;
      const row = rows[0];
      return {
        state: row?.claim_state ?? "processing",
        claimToken: row?.route_claim_token ? String(row.route_claim_token) : null,
        targetMessageId: asNumber(row?.routed_target_message_id),
      };
    },

    async completeTripMessageRouting(source, claimToken, targetMessageId) {
      const rows = await sql`
        select public.complete_trip_message_routing(
          ${source.chatId},
          ${source.messageId},
          ${claimToken},
          ${targetMessageId}
        ) as completed
      `;
      return Boolean(rows[0]?.completed);
    },

    async releaseTripMessageRouting(source, claimToken) {
      const rows = await sql`
        select public.release_trip_message_routing(
          ${source.chatId},
          ${source.messageId},
          ${claimToken}
        ) as released
      `;
      return Boolean(rows[0]?.released);
    },

    async confirmRequest(requestId, actorTelegramUserId) {
      const rows = await sql`
        select * from public.confirm_booking_request(${requestId}, ${actorTelegramUserId})
      `;
      return mapTransitionRow(rows[0]);
    },

    async transitionRequest(requestId, targetStatus, actorTelegramUserId) {
      const rows = await sql`
        select * from public.transition_booking_request(
          ${requestId},
          ${targetStatus},
          ${actorTelegramUserId}
        )
      `;
      return mapTransitionRow(rows[0]);
    },

    async listAvailability(from, to) {
      const rows = await sql`
        select * from public.booking_availability(${from}, ${to})
        order by night_date, unit_id
      `;
      return rows.map((row) => ({
        date: asIsoDate(row.night_date),
        unitId: row.unit_id,
        stayId: row.stay_id,
        available: Boolean(row.available),
      }));
    },

    async checkAvailability(selection) {
      const rows = await sql`
        select * from public.check_booking_availability(
          ${selection.stayId},
          ${selection.unitCount},
          ${selection.selectedUnitIds},
          ${selection.checkIn},
          ${selection.checkOut}
        )
      `;
      const row = rows[0];
      return {
        available: Boolean(row?.available),
        code: row?.result_code ?? (row?.available ? "available" : "unavailable"),
        availableUnitIds: row?.available_unit_ids ?? [],
      };
    },
  };
}

function intervalsOverlap(first, second) {
  return first.checkIn < second.checkOut && second.checkIn < first.checkOut;
}

const PHYSICAL_UNITS = Object.freeze([
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `hotel-room-${index + 1}`,
    stayId: "hotel-room",
  })),
  { id: "cottage", stayId: "cottage" },
  { id: "hunter-house-1", stayId: "hunter-house" },
  { id: "hunter-house-2", stayId: "hunter-house" },
]);

export function createMemoryBookingRepository(options = {}) {
  const requests = new Map();
  const requestKeys = new Map();
  const allocations = [];
  const telegramUpdates = new Map();
  const tripRoutes = new Map();
  const rateLimits = new Map();
  let accommodationMapDraft = cloneMapConfig(options.accommodationMapDraft ?? null);
  let accommodationMapPublished = cloneMapConfig(options.accommodationMapPublished ?? null);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const rateLimitRetentionSeconds = Number.isInteger(options.rateLimitRetentionSeconds)
    ? options.rateLimitRetentionSeconds
    : 172_800;
  const rateLimitCleanupBatchSize = Number.isInteger(options.rateLimitCleanupBatchSize)
    ? options.rateLimitCleanupBatchSize
    : 500;

  const clone = (value) => (value ? structuredClone(value) : value);
  const occupied = (unitId, checkIn, checkOut, exceptRequestId = null) => allocations.some((item) => (
    item.unitId === unitId
      && item.requestId !== exceptRequestId
      && intervalsOverlap(item, { checkIn, checkOut })
  ));

  async function markTelegramDelivered(requestId, telegram) {
    const request = requests.get(requestId);
    if (!request) return null;
    Object.assign(request, {
      telegramChatId: String(telegram.chatId),
      telegramMessageId: Number(telegram.messageId),
      telegramTopicId: telegram.topicId === null || telegram.topicId === undefined
        ? null
        : Number(telegram.topicId),
      telegramRoutingClaimToken: null,
      telegramRoutingClaimedAt: null,
      notificationError: null,
    });
    return clone(request);
  }

  function cleanupRateLimitRows(
    retentionSeconds = rateLimitRetentionSeconds,
    batchSize = rateLimitCleanupBatchSize,
  ) {
    const cutoff = now() - retentionSeconds * 1_000;
    const expiredKeys = [...rateLimits.entries()]
      .filter(([, reservation]) => reservation.reservedAt < cutoff)
      .sort((first, second) => first[1].reservedAt - second[1].reservedAt)
      .slice(0, Math.max(0, batchSize))
      .map(([clientHash]) => clientHash);
    for (const clientHash of expiredKeys) rateLimits.delete(clientHash);
    return expiredKeys.length;
  }

  return {
    async getPublishedAccommodationMap() {
      return cloneMapConfig(accommodationMapPublished);
    },

    async getAccommodationMapDraft() {
      return cloneMapConfig(accommodationMapDraft);
    },

    async saveAccommodationMapDraft(config) {
      accommodationMapDraft = cloneMapConfig(config);
      return cloneMapConfig(accommodationMapDraft);
    },

    async publishAccommodationMap() {
      if (!accommodationMapDraft) throw new Error("ACCOMMODATION_MAP_DRAFT_MISSING");
      accommodationMapPublished = cloneMapConfig(accommodationMapDraft);
      return cloneMapConfig(accommodationMapPublished);
    },

    async getRequestByRequestKey(requestKey) {
      const requestId = requestKeys.get(requestKey);
      return clone(requestId ? requests.get(requestId) : null);
    },

    async createOrGetRequest(metadata) {
      const existingId = requestKeys.get(metadata.requestKey);
      if (existingId) return { created: false, request: clone(requests.get(existingId)) };

      const request = {
        ...clone(metadata),
        status: "pending",
        allocatedUnitIds: [],
        telegramChatId: null,
        telegramMessageId: null,
        telegramTopicId: null,
        telegramRoutingClaimToken: null,
        telegramRoutingClaimedAt: null,
        notificationError: null,
      };
      requests.set(request.id, request);
      requestKeys.set(request.requestKey, request.id);
      return { created: true, request: clone(request) };
    },

    async getRequest(requestId) {
      const request = requests.get(requestId);
      if (!request) return null;
      const allocatedUnitIds = allocations
        .filter((item) => item.requestId === requestId)
        .map((item) => item.unitId)
        .sort();
      return clone({ ...request, allocatedUnitIds });
    },

    markTelegramDelivered,

    async markNotificationFailed(requestId, errorCode = "telegram_delivery_failed") {
      const request = requests.get(requestId);
      if (!request) return null;
      if (request.status === "pending") request.status = "notification_failed";
      request.notificationError = String(errorCode).slice(0, 160);
      return clone(request);
    },

    async claimNotificationDelivery(requestId) {
      const request = requests.get(requestId);
      if (
        !request
        || request.telegramMessageId !== null
        || !["pending", "notification_failed"].includes(request.status)
        || request.notificationError === "telegram_delivery_in_progress"
      ) return null;
      request.status = "pending";
      request.notificationError = "telegram_delivery_in_progress";
      return clone(request);
    },

    async updateTelegramLocation(requestId, telegram) {
      return markTelegramDelivered(requestId, telegram);
    },

    async claimTelegramRouting(requestId, source) {
      const request = requests.get(requestId);
      const timestamp = now();
      const claimExpired = request?.telegramRoutingClaimedAt !== null
        && timestamp - request.telegramRoutingClaimedAt >= 120_000;
      if (
        !request
        || String(request.telegramChatId) !== String(source.chatId)
        || Number(request.telegramMessageId) !== Number(source.messageId)
        || Number(request.telegramTopicId) !== Number(source.topicId)
        || (request.telegramRoutingClaimToken !== null && !claimExpired)
      ) {
        return { claimed: false, claimToken: null };
      }

      const claimToken = randomUUID();
      request.telegramRoutingClaimToken = claimToken;
      request.telegramRoutingClaimedAt = timestamp;
      return { claimed: true, claimToken };
    },

    async completeTelegramRouting(requestId, claimToken, telegram) {
      const request = requests.get(requestId);
      if (!request || request.telegramRoutingClaimToken !== claimToken) return null;
      return markTelegramDelivered(requestId, telegram);
    },

    async releaseTelegramRouting(requestId, claimToken) {
      const request = requests.get(requestId);
      if (!request || request.telegramRoutingClaimToken !== claimToken) return false;
      request.telegramRoutingClaimToken = null;
      request.telegramRoutingClaimedAt = null;
      return true;
    },

    async recordNotificationError(requestId, errorCode) {
      const request = requests.get(requestId);
      if (request) request.notificationError = String(errorCode).slice(0, 160);
    },

    async reserveRateLimit(clientHashes, windowSeconds = 20) {
      cleanupRateLimitRows();
      const timestamp = now();
      const activeReservations = clientHashes
        .map((clientHash) => rateLimits.get(clientHash))
        .filter((reservation) => (
          reservation && timestamp - reservation.reservedAt < windowSeconds * 1_000
        ));
      if (activeReservations.length > 0) {
        const latestReservedAt = Math.max(
          ...activeReservations.map((reservation) => reservation.reservedAt),
        );
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((latestReservedAt + windowSeconds * 1_000 - timestamp) / 1_000),
          ),
          reservationToken: null,
        };
      }

      const reservationToken = randomUUID();
      rateLimits.set(clientHashes[0], { reservationToken, reservedAt: timestamp });
      return { allowed: true, retryAfterSeconds: 0, reservationToken };
    },

    async releaseRateLimit(clientHash, reservationToken) {
      const reservation = rateLimits.get(clientHash);
      if (!reservation || reservation.reservationToken !== reservationToken) return false;
      rateLimits.delete(clientHash);
      return true;
    },

    async cleanupRateLimits(
      retentionSeconds = rateLimitRetentionSeconds,
      batchSize = rateLimitCleanupBatchSize,
    ) {
      return cleanupRateLimitRows(retentionSeconds, batchSize);
    },

    async claimTelegramUpdate(updateId) {
      const existing = telegramUpdates.get(updateId);
      if (existing?.status === "completed") return "completed";
      if (existing?.status === "processing" && now() - existing.claimedAt < 120_000) {
        return "processing";
      }
      telegramUpdates.set(updateId, { status: "processing", claimedAt: now() });
      return "claimed";
    },

    async completeTelegramUpdate(updateId) {
      telegramUpdates.set(updateId, { status: "completed", claimedAt: now() });
    },

    async releaseTelegramUpdate(updateId) {
      if (telegramUpdates.get(updateId)?.status === "processing") telegramUpdates.delete(updateId);
    },

    async claimTripMessageRouting(source, targetTopicId) {
      const key = `${String(source.chatId)}:${Number(source.messageId)}`;
      const existing = tripRoutes.get(key);
      const timestamp = now();
      const claimExpired = existing?.state === "processing"
        && timestamp - existing.updatedAt >= 120_000;

      if (existing && !claimExpired) {
        return {
          state: existing.state,
          claimToken: null,
          targetMessageId: existing.targetMessageId,
        };
      }
      if (
        existing
        && (
          Number(existing.sourceTopicId) !== Number(source.topicId)
          || Number(existing.targetTopicId) !== Number(targetTopicId)
        )
      ) {
        return { state: "processing", claimToken: null, targetMessageId: null };
      }

      const claimToken = randomUUID();
      tripRoutes.set(key, {
        sourceChatId: String(source.chatId),
        sourceMessageId: Number(source.messageId),
        sourceTopicId: Number(source.topicId),
        targetTopicId: Number(targetTopicId),
        targetMessageId: null,
        state: "processing",
        claimToken,
        claimedAt: timestamp,
        completedAt: null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
      return { state: "claimed", claimToken, targetMessageId: null };
    },

    async completeTripMessageRouting(source, claimToken, targetMessageId) {
      const key = `${String(source.chatId)}:${Number(source.messageId)}`;
      const route = tripRoutes.get(key);
      if (
        !route
        || route.state !== "processing"
        || route.claimToken !== claimToken
      ) return false;

      route.state = "completed";
      route.claimToken = null;
      route.targetMessageId = Number(targetMessageId);
      route.completedAt = now();
      route.updatedAt = route.completedAt;
      return true;
    },

    async releaseTripMessageRouting(source, claimToken) {
      const key = `${String(source.chatId)}:${Number(source.messageId)}`;
      const route = tripRoutes.get(key);
      if (
        !route
        || route.state !== "processing"
        || route.claimToken !== claimToken
      ) return false;
      tripRoutes.delete(key);
      return true;
    },

    async confirmRequest(requestId, actorTelegramUserId) {
      const request = requests.get(requestId);
      if (!request) return { ok: false, code: "not_found", status: null, allocatedUnitIds: [] };
      if (request.status === "confirmed") {
        return {
          ok: true,
          code: "already_confirmed",
          status: request.status,
          allocatedUnitIds: allocations.filter((item) => item.requestId === requestId).map((item) => item.unitId),
        };
      }
      if (request.status !== "pending") {
        return { ok: false, code: "invalid_status", status: request.status, allocatedUnitIds: [] };
      }

      const stayUnits = PHYSICAL_UNITS.filter((unit) => unit.stayId === request.stayId);
      const desiredIds = request.stayId === "hotel-room"
        ? stayUnits
          .filter((unit) => !occupied(unit.id, request.checkIn, request.checkOut))
          .slice(0, request.unitCount)
          .map((unit) => unit.id)
        : request.stayId === "cottage"
          ? ["cottage"]
          : request.selectedUnitIds;

      if (
        desiredIds.length !== request.unitCount
        || desiredIds.some((unitId) => occupied(unitId, request.checkIn, request.checkOut))
      ) {
        return { ok: false, code: "conflict", status: request.status, allocatedUnitIds: [] };
      }

      for (const unitId of desiredIds) {
        allocations.push({
          requestId,
          unitId,
          stayId: request.stayId,
          checkIn: request.checkIn,
          checkOut: request.checkOut,
        });
      }
      request.status = "confirmed";
      request.statusActorTelegramUserId = actorTelegramUserId;
      return { ok: true, code: "confirmed", status: request.status, allocatedUnitIds: [...desiredIds] };
    },

    async transitionRequest(requestId, targetStatus, actorTelegramUserId) {
      const request = requests.get(requestId);
      if (!request) return { ok: false, code: "not_found", status: null, allocatedUnitIds: [] };

      const allowed = (targetStatus === "rejected" && request.status === "pending")
        || (targetStatus === "cancelled" && request.status === "confirmed")
        || request.status === targetStatus;
      if (!allowed) {
        return { ok: false, code: "invalid_status", status: request.status, allocatedUnitIds: [] };
      }

      if (targetStatus === "cancelled") {
        for (let index = allocations.length - 1; index >= 0; index -= 1) {
          if (allocations[index].requestId === requestId) allocations.splice(index, 1);
        }
      }
      const already = request.status === targetStatus;
      request.status = targetStatus;
      request.statusActorTelegramUserId = actorTelegramUserId;
      return {
        ok: true,
        code: already ? `already_${targetStatus}` : targetStatus,
        status: request.status,
        allocatedUnitIds: [],
      };
    },

    async listAvailability(from, to) {
      const rows = [];
      for (let cursor = from; cursor < to; cursor = nextIsoDate(cursor)) {
        for (const unit of PHYSICAL_UNITS) {
          rows.push({
            date: cursor,
            unitId: unit.id,
            stayId: unit.stayId,
            available: !occupied(unit.id, cursor, nextIsoDate(cursor)),
          });
        }
      }
      return rows;
    },

    async checkAvailability(selection) {
      const stayUnits = PHYSICAL_UNITS.filter((unit) => unit.stayId === selection.stayId);
      const availableIds = stayUnits
        .filter((unit) => !occupied(unit.id, selection.checkIn, selection.checkOut))
        .map((unit) => unit.id);
      const desiredIds = selection.stayId === "cottage"
        ? ["cottage"]
        : selection.selectedUnitIds;
      const available = selection.stayId === "hotel-room"
        ? availableIds.length >= selection.unitCount
        : desiredIds.every((unitId) => availableIds.includes(unitId));
      return {
        available,
        code: available ? "available" : "conflict",
        availableUnitIds: availableIds,
      };
    },

    // Test-only snapshots deliberately contain no contact fields.
    snapshot() {
      return {
        requests: clone([...requests.values()]),
        allocations: clone(allocations),
        telegramUpdates: clone([...telegramUpdates.entries()]),
        tripRoutes: clone([...tripRoutes.values()]),
        rateLimits: clone([...rateLimits.entries()]),
      };
    },
  };
}

function nextIsoDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function getBookingRepository(environment = process.env) {
  if (!environment.DATABASE_URL) {
    throw new Error(DATABASE_NOT_CONFIGURED);
  }

  if (!sharedRepositoryPromise) {
    sharedRepositoryPromise = import("postgres").then(({ default: postgres }) => {
      const sql = postgres(environment.DATABASE_URL, {
        max: 2,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
      });
      return createPostgresBookingRepository(sql);
    });
  }

  return sharedRepositoryPromise;
}

export function createRequestId() {
  return randomUUID();
}

export { DATABASE_NOT_CONFIGURED, PHYSICAL_UNITS };
