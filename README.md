# Трекер технического аудита

Статическая доска задач и полный отчёт по аудиту сайта «Сладкий Град». Доска доступна только по ссылке с токеном в части URL после `#`: фрагмент URL не отправляется автоматически GitHub Pages, но браузер читает его и намеренно передаёт только в HTTPS-вызовах Supabase RPC. Не публикуйте и не пересылайте ссылку посторонним.

## Что понадобится

- Node.js 22+ и npm;
- проект [Supabase](https://supabase.com/), SQL Editor или `psql`;
- репозиторий GitHub с включённым GitHub Pages.

`SUPABASE_ANON_KEY` и `SUPABASE_URL` — публичная конфигурация браузера. Не добавляйте в репозиторий `SUPABASE_DB_URL`, service-role key или созданный файл `src/config.js`.

## Создание базы Supabase

1. Создайте проект Supabase и дождитесь его готовности.
2. В SQL Editor выполните по очереди содержимое файлов [`supabase/migrations/202608200001_audit_board.sql`](supabase/migrations/202608200001_audit_board.sql), затем [`supabase/seed.sql`](supabase/seed.sql). Альтернатива с локальным `psql`:

   ```sh
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608200001_audit_board.sql
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
   ```

   `SUPABASE_DB_URL` — строка подключения к базе с правом выполнять миграции; используйте её только на локальной машине или в защищённой среде.
3. Возьмите в Supabase Dashboard → **Connect** только Project URL и publishable/anon key. Не используйте `service_role` key: он никогда не нужен приложению.

## Создание доски и защищённой ссылки

После миграции и seed выполните на своей машине:

```sh
SUPABASE_DB_URL='postgresql://…' \
AUDIT_TRACKER_SITE_URL='https://<владелец>.github.io/<репозиторий>/' \
node scripts/create-board.mjs
```

Скрипт создаёт случайный 256-битный токен, сохраняет в базе только его SHA-256-хеш и выводит одну ссылку вида `https://…/#board=…`. Сохраните и передайте её нужным участникам: любой, кто владеет ссылкой, может читать и изменять эту доску. Токен нельзя восстановить из базы; для новой доски запустите скрипт заново.

## Локальный просмотр

```sh
npm ci
cp src/config.example.js src/config.js
```

В `src/config.js` замените два плейсхолдера значениями Project URL и publishable/anon key, затем запустите:

```sh
npm run preview
```

Откройте адрес, показанный Vite, и добавьте к нему фрагмент `#board=<токен>` из созданной ссылки. Файл `src/config.js` локальный и игнорируется Git, поэтому не коммитьте его.

Для проверки production-сборки конфигурация передаётся окружением:

```sh
SUPABASE_URL='https://<project>.supabase.co' \
SUPABASE_ANON_KEY='<publishable-or-anon-key>' \
npm run build
```

Сборка завершается с понятной ошибкой, если одного из публичных значений нет. Она создаёт `dist/` ровно с нужными для рантайма файлами: HTML, CSS, отчётом и модулями приложения с сгенерированным `src/config.js`.

## Публикация на GitHub Pages

1. В GitHub откройте **Settings → Secrets and variables → Actions → Variables** и добавьте repository variables `SUPABASE_URL` и `SUPABASE_ANON_KEY`. Это именно Variables, не Secrets: оба значения попадут в браузер и поэтому должны быть публичными.
2. В **Settings → Pages** выберите source **GitHub Actions**.
3. Убедитесь, что основная ветка называется `main`, затем отправьте в неё изменения либо вручную запустите workflow **Deploy GitHub Pages**. Если используется другая ветка, измените `on.push.branches` в [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
4. После первого успешного деплоя скопируйте точный адрес Pages и используйте его как `AUDIT_TRACKER_SITE_URL` при создании доски.

Workflow выполняет `npm ci`, тесты и production-сборку, после чего загружает только `dist/` штатными GitHub Pages actions. В артефакт не входят `node_modules`, тесты, `.git`, SQL-файлы Supabase, локальная конфигурация или ключи с расширенными правами.
