# Roadmap-трекер «Сладкий Град»

Публичная общая доска по секретной ссылке: 56 исходных пунктов roadmap, этапы 0–8, три итерации, комментарии к задачам и общий чат. Авторизация не нужна: право просмотра и изменений даёт ссылка с токеном после `#`. Не пересылайте её посторонним.

Вкладка «Стратегия» показывает исходный `roadmap-report.md` как справочный материал. Его текст не запускает и не разрешает изменений на исходном сайте.

## Что понадобится

- Node.js 22+ и npm;
- проект [Supabase](https://supabase.com/);
- репозиторий GitHub с включённым GitHub Pages.

`SUPABASE_URL` и `SUPABASE_ANON_KEY` — публичные данные браузера. Не добавляйте в репозиторий `SUPABASE_DB_URL`, service-role key или локальный `src/config.js`.

## Настройка Supabase

Выполните миграции по порядку, затем seed:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608200001_audit_board.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608200002_add_roadmap_tracker.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608200003_full_chat.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260820151527_roadmap_only.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Последняя миграция безопасно обновляет существующие доски: архивные записи старого аудита сохраняются в базе, но публичный RPC и интерфейс показывают только Roadmap. Таблицы закрыты напрямую; браузер работает только через ограниченные RPC-операции.

## Создание секретной ссылки

После миграций запустите на защищённой машине:

```sh
SUPABASE_DB_URL='postgresql://…' \
AUDIT_TRACKER_SITE_URL='https://<владелец>.github.io/<репозиторий>/' \
node scripts/create-board.mjs
```

Скрипт генерирует случайный 256-битный токен, хранит в базе только его SHA-256-хеш и выводит одну ссылку формата `https://…/#board=…`. Новая публичная доска сразу показывает 56 стартовых roadmap-пунктов. Токен нельзя восстановить из базы; чтобы выдать новую ссылку, запустите скрипт ещё раз.

## Локальная разработка

```sh
npm ci
cp src/config.example.js src/config.js
npm run preview
```

В `src/config.js` укажите Project URL и publishable/anon key из Supabase Dashboard. Затем откройте адрес Vite c добавленным `#board=<токен>`. Файл `src/config.js` игнорируется Git.

Production-сборка получает только публичные переменные окружения:

```sh
SUPABASE_URL='https://<project>.supabase.co' \
SUPABASE_ANON_KEY='<publishable-or-anon-key>' \
npm run build
```

В `dist/` попадают только рантайм-файлы: HTML, CSS, `roadmap-report.md`, модули приложения и сгенерированный публичный `src/config.js`.

## Публикация на GitHub Pages

1. В **Settings → Secrets and variables → Actions → Variables** добавьте `SUPABASE_URL` и `SUPABASE_ANON_KEY`.
2. В **Settings → Pages** выберите source **GitHub Actions**.
3. Отправьте изменения в `main` или вручную запустите workflow **Deploy GitHub Pages**.

Workflow запускает тесты, production-сборку и 86 pgTAP-проверок в отдельной локальной базе Supabase, затем публикует только `dist/`.

## Проверка базы

```sh
supabase db start
npm run test:db
supabase stop --no-backup
```

`npm run test:db` выполняет 86 pgTAP-проверок на свежей базе.
