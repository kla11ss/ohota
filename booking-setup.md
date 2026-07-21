# Бесплатный контур бронирования

Приложение разворачивается на Netlify Free, а подтверждённая занятость хранится в Neon Postgres. Telegram остаётся единственным местом, где хранятся телефон, имя и комментарий гостя.

## 1. Neon Postgres

1. Создайте Free-проект `velikovskoe-booking` в AWS Europe (Frankfurt), `aws-eu-central-1`.
2. Под ролью-владельцем и через прямое, не pooled-подключение примените:

   ```text
   supabase/migrations/202607210001_booking_inventory.sql
   database/booking-app-role.sql
   ```

   Миграция включает `btree_gist`, физические номера и exclusion constraint для интервалов `[check-in, check-out)`.
3. Задайте пароль SQL-роли `booking_app` вне репозитория. Через `psql` это можно сделать интерактивно:

   ```text
   \password booking_app
   ```

   Не создавайте runtime-роль через Neon Console/API: такие роли получают расширенное членство. `booking_app` должна создаваться SQL-скриптом.
4. Скопируйте pooled connection string с hostname, содержащим `-pooler`, подставьте логин `booking_app` и сохраните строку в Netlify как `DATABASE_URL`.

`booking_app` не владеет объектами, не имеет DDL-прав и не может напрямую менять занятость. Приложение использует пул и `prepare: false`, что совместимо с transaction pooling.

## 2. Telegram

Единственный неавтоматизируемый шаг:

1. Создайте закрытую супергруппу под своим аккаунтом-владельцем.
2. Включите Topics.
3. Добавьте `@Velikovskoe_hunt_bot` администратором с правами управлять темами и удалять сообщения.
4. Отправьте `/setup` в общую тему этой группы.

В чистом клоне сначала создайте локальный `.env` и заполните в нём существующий токен бота и свой числовой Telegram ID. До обнаружения группы `TELEGRAM_CHAT_ID` можно временно задать тем же ID владельца:

```powershell
Copy-Item .env.example .env
```

После этого запустите:

```text
pnpm setup:telegram
```

Скрипт проверит, что `/setup` отправил владелец группы, проверит права бота, создаст или переиспользует точно четыре темы:

- «Новые заявки»;
- «Подтверждённые»;
- «Архив»;
- «Запросы на поездку».

Он атомарно обновляет игнорируемый `.env` после каждой темы, генерирует разные webhook/rate-limit secrets и не выводит их. Повторный запуск безопасно продолжает частично завершённую настройку.

## 3. Netlify

1. Импортируйте GitHub-репозиторий. `netlify.toml` уже задаёт `pnpm build`, `dist`, Node 22, Function-адаптеры и SPA fallback.
2. Оставьте `main` production-веткой; Pull Request/ветки будут получать Deploy Preview.
3. Добавьте только в Functions/Production environment:

   ```text
   DATABASE_URL
   TELEGRAM_BOT_TOKEN
   TELEGRAM_CHAT_ID
   TELEGRAM_OWNER_USER_ID
   TELEGRAM_ADMIN_USER_IDS
   TELEGRAM_NEW_TOPIC_ID
   TELEGRAM_CONFIRMED_TOPIC_ID
   TELEGRAM_ARCHIVE_TOPIC_ID
   TELEGRAM_TRIP_TOPIC_ID
   TELEGRAM_WEBHOOK_SECRET
   BOOKING_RATE_LIMIT_SECRET
   ```

   Ни одна из этих переменных не должна иметь префикс `VITE_`. `PUBLIC_SITE_URL` нужен только локально setup-скрипту.
4. Запустите production deploy, затем зарегистрируйте callback-only webhook:

   ```text
   pnpm setup:telegram -- --url=https://your-site.netlify.app
   ```

Публичные маршруты сохранены:

- `POST /api/booking-request`;
- `GET /api/availability`;
- `POST /api/availability/check`;
- `POST /api/trip-request`;
- `POST /api/telegram-webhook`.

Netlify Free на новом credit-based тарифе даёт 300 credits с жёстким месячным лимитом и автоматическими уведомлениями на 50%, 75% и 100%. Проект не может получить Functions region Frankfurt на Free: Netlify разрешает выбор региона только на Pro/Enterprise. Поэтому Free-совместимая конфигурация оставляет регион Netlify по умолчанию, а Neon — во Frankfurt.

## 4. Smoke test

1. Отправьте синтетическую заявку на размещение. Она должна появиться только в «Новых заявках».
2. Нажмите «Подтвердить»: копия должна появиться в «Подтверждённых», исходное сообщение — удалиться, а ночи — закрыться в календаре.
3. Нажмите «Отменить бронь»: копия должна уйти в «Архив», а даты — освободиться.
4. Отклоните отдельную заявку: она должна уйти в «Архив», не закрывая даты.
5. Отправьте обычную форму поездки: она должна появиться только в «Запросах на поездку».
6. Проверьте SQL-запросом, что в `booking_requests`, `booking_allocations`, `telegram_updates` и `booking_rate_limits` нет телефона, имени и комментария.

До заполнения production-переменных публичные API должны fail closed: возвращать ошибку конфигурации и не считать даты свободными по умолчанию.
