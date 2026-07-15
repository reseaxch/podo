# Podo — Use Cases

> Юзкейсы выведены из [MVP_PLAN.md](MVP_PLAN.md). Покрывают основной сквозной сценарий
> `incident → evidence → root cause → tested fix → pull request`, а также поддерживающие
> и вспомогательные потоки.

## Обозначения

| Поле | Значение |
| --- | --- |
| Уровень автономности | Observe / Recommend / Act with approval (из раздела 10 плана) |
| Приоритет | Must (7.1) / Should (7.2) |
| Трассировка | Ссылка на FR / критерий готовности из плана |

### Акторы

- **On-call инженер** — дежурный, основной пользователь MVP.
- **Backend-разработчик** — автор исправляемого кода.
- **DevOps / SRE** — отвечает за deployment и инфраструктуру.
- **Tech lead** — принимает решение по remediation и ревьюит PR.
- **Podo (система)** — Incident Engine, Investigator (GPT-5.6), Codex worker.
- **Внешние системы** — Graphify, GitHub, источник OpenTelemetry-событий.

---

## Обзор

| ID | Название | Основной актор | Приоритет |
| --- | --- | --- | --- |
| UC-01 | Импорт code graph через GraphifyAdapter | DevOps / система | Must |
| UC-02 | Построение Operational Overlay поверх code graph | Система | Must |
| UC-03 | Ingestion и детерминированный replay телеметрии | On-call / система | Must |
| UC-04 | Автоматическое создание инцидента по порогу/ошибкам | Система | Must |
| UC-05 | Расследование инцидента (evidence-based diagnosis) | On-call / Investigator | Must |
| UC-06 | Просмотр причинной цепочки и evidence timeline | On-call | Must |
| UC-07 | Генерация исправления и regression test (Codex) | Tech lead / Codex | Must |
| UC-08 | Прогон тестов в изолированной рабочей копии | Система | Must |
| UC-09 | Создание pull request при успешных тестах | Tech lead / система | Must |
| UC-10 | Создание issue при неуспешной проверке | Система | Must |
| UC-11 | Просмотр audit trail действий агента | Tech lead | Must |
| UC-12 | Сравнение метрик до/после исправления | On-call | Should |
| UC-13 | Обработка упавшего GitHub Actions workflow | DevOps | Should |
| UC-14 | Локальный запуск демо одной командой | Judge / разработчик | Must |

---

## UC-01. Импорт code graph через GraphifyAdapter

- **Актор:** DevOps / система (build-time).
- **Уровень:** Observe. **Приоритет:** Must. **Трассировка:** FR-1, FR-1.1, критерии «GraphifyAdapter импортирует…», «Contract test обнаруживает несовместимую схему».
- **Предусловие:** Graphify построил `graphify-out/graph.json` для demo-monorepo; версия `graphifyy` зафиксирована в lock.

**Основной поток:**
1. Adapter читает `graphify-out/graph.json`.
2. Проверяет поддерживаемую версию / fingerprint схемы.
3. Нормализует nodes и edges (Repository, Service, File, Function, Endpoint) в модель Podo.
4. Сохраняет external ID, source path, line, relation type, provenance и маркировку `EXTRACTED`/`INFERRED`/`AMBIGUOUS`.
5. Идемпотентно апсертит данные в PostgreSQL.

**Постусловие:** Code Intelligence Layer сохранён в БД без потери provenance; повторный импорт не создаёт дубликатов.

**Альтернативы:**
- **A1 — несовместимая схема:** contract test / проверка версии падает → adapter завершается понятной ошибкой, импорт не выполняется.
- **A2 — повторный импорт:** стабильные external IDs → upsert обновляет существующие узлы.

---

## UC-02. Построение Operational Overlay поверх code graph

- **Актор:** Система.
- **Уровень:** Observe. **Приоритет:** Must. **Трассировка:** FR-1.1 (operational nodes), критерии «Operational Overlay дополняет…», «Deployment связан с commit SHA».
- **Предусловие:** Code graph импортирован (UC-01).

**Основной поток:**
1. Система добавляет operational-узлы: Commit, Deployment, Container, Trace, LogEvent, MetricEvent, Incident, Evidence.
2. Привязывает Deployment к конкретному Git commit SHA (`Deployment --USES--> Commit`).
3. Связывает Container → Deployment, Service → File и т.д. согласно схеме связей.
4. Объединённый граф хранится в PostgreSQL вместе с code graph.

**Постусловие:** Единый граф связывает runtime-сущности с кодом; путь `container → deployment → commit → function` разрешим.

---

## UC-03. Ingestion и детерминированный replay телеметрии

- **Актор:** On-call инженер (запуск) / система.
- **Уровень:** Observe. **Приоритет:** Must. **Трассировка:** FR-2, критерий «Incident replay воспроизводится детерминированно».
- **Предусловие:** Подготовлен набор OpenTelemetry-совместимых событий (logs, traces, memory metrics).

**Основной поток:**
1. Инженер запускает replay проблемного deployment.
2. Система принимает нормализованные события (timestamp, service, deployment/commit, trace ID, severity, message, metric name/value, container ID).
3. Replay ускоряет течение времени, но события обрабатываются реально.
4. Метрики памяти и ошибки поступают в Incident Engine.

**Постусловие:** Поток событий доступен engine; сценарий воспроизводим детерминированно.

**Альтернатива:**
- **A1 — сбой шага:** любой упавший шаг завершается понятным состоянием, workflow не зависает.

---

## UC-04. Автоматическое создание инцидента

- **Актор:** Система (Incident Engine).
- **Уровень:** Observe. **Приоритет:** Must. **Трассировка:** FR-3, критерий «Система автоматически создаёт incident».
- **Предусловие:** Идёт replay (UC-03), настроен threshold detector.

**Основной поток:**
1. Detector фиксирует превышение memory threshold либо последовательность ошибок (HTTP 500).
2. Система создаёт Incident.
3. Определяет затронутый service (`checkout-service`) и endpoint.
4. Прикрепляет исходные события как Evidence.
5. Запускает investigation workflow (переход к UC-05).

**Постусловие:** Открыт инцидент со связанными evidence; investigation инициировано.

---

## UC-05. Расследование инцидента (evidence-based diagnosis)

- **Актор:** On-call инженер (кнопка `Investigate`) / GPT-5.6 Investigator.
- **Уровень:** Recommend. **Приоритет:** Must. **Трассировка:** FR-4, критерии «GPT-5.6 возвращает валидный структурированный диагноз», «Диагноз содержит ссылки на evidence».
- **Предусловие:** Существует инцидент (UC-04); граф собран.

**Основной поток:**
1. Investigator выбирает релевантный subgraph инцидента.
2. Использует ограниченный tool set: `get_incident_events`, `get_graph_neighbors`, `get_recent_deployments`, `get_commit_diff`, `get_related_logs`, `get_trace`, `search_code`, `run_test`.
3. Связывает симптом → runtime errors → deployment/commit → изменённый cache-класс.
4. Возвращает структурированный ответ по схеме: `summary`, `affectedService`, `probableRootCause`, `confidence`, `evidenceIds[]`, `recommendedAction`, `safeToAttemptFix`.
5. Каждое существенное утверждение ссылается минимум на один `evidenceId`.

**Постусловие:** Готов диагноз с root cause, confidence и evidence-ссылками; выставлен флаг `safeToAttemptFix`.

**Альтернативы:**
- **A1 — невалидный вывод:** схема не проходит валидацию → повтор/ошибка, отображённая в UI.
- **A2 — вывод без evidence:** утверждение без `evidenceId` не считается доказанным (целевая доля evidence-ссылок — 100%).
- **NFR:** investigation одного подготовленного инцидента ≤ 60 секунд.

---

## UC-06. Просмотр причинной цепочки и evidence timeline

- **Актор:** On-call инженер / tech lead.
- **Уровень:** Observe. **Приоритет:** Must. **Трассировка:** FR-6, критерий «UI показывает путь от metric/log до функции или файла».
- **Предусловие:** Есть диагноз (UC-05).

**Основной поток:**
1. Инженер открывает dashboard.
2. Видит список активных инцидентов, статус системы и метрики.
3. Открывает инцидент → визуальный граф подсвечивает путь `container → deployment → commit → function`.
4. Просматривает evidence timeline, probable root cause и confidence.

**Постусловие:** Причинная цепочка визуально подтверждена; инженер готов принять решение о remediation.

---

## UC-07. Генерация исправления и regression test

- **Актор:** Tech lead (кнопка `Generate fix`) / Codex worker.
- **Уровень:** Act with approval. **Приоритет:** Must. **Трассировка:** FR-5 (1–4), критерии «Codex создаёт минимальное исправление», «Добавлен regression test».
- **Предусловие:** Диагноз подтверждён пользователем; `safeToAttemptFix = true`.

**Основной поток:**
1. Пользователь подтверждает запуск remediation.
2. Система создаёт изолированную рабочую копию repository (sandbox checkout).
3. Передаёт Codex описание дефекта и собранный evidence.
4. Codex формирует минимальный patch (с явным ограничением размера diff).
5. Codex добавляет/обновляет regression test.

**Постусловие:** Готов patch + regression test в изолированной копии; production и default branch не затронуты.

**Альтернатива:**
- **A1 — слишком большой patch:** ограничение diff отсекает избыточные изменения; требуется human approval.

---

## UC-08. Прогон тестов в изолированной рабочей копии

- **Актор:** Система (sandbox).
- **Уровень:** Act with approval. **Приоритет:** Must. **Трассировка:** FR-5 (5–6), критерий «Тесты выполняются и результат отображается в UI».
- **Предусловие:** Есть patch и regression test (UC-07).

**Основной поток:**
1. Система выполняет тесты в изолированном checkout.
2. Показывает diff предлагаемого исправления и результаты тестов в UI.

**Постусловие:** Известен исход проверки (pass/fail); результаты видны в dashboard.

**Ветвление:** успех → UC-09; неуспех → UC-10.

---

## UC-09. Создание pull request

- **Актор:** Tech lead (кнопка `Open pull request`) / система.
- **Уровень:** Act with approval. **Приоритет:** Must. **Трассировка:** FR-5 (7), критерий «Система создаёт PR либо воспроизводимый PR preview».
- **Предусловие:** Тесты прошли успешно (UC-08).

**Основной поток:**
1. После подтверждения пользователем система создаёт GitHub pull request (или полностью воспроизводимый PR preview).
2. PR содержит patch, regression test и ссылку на incident report.

**Постусловие:** Создан PR; нет push в default branch, нет автоматического merge.

**Ограничения:** нет прямого изменения production; максимальное автоматическое действие MVP — создание PR.

---

## UC-10. Создание issue при неуспешной проверке

- **Актор:** Система (кнопка `Create issue`).
- **Уровень:** Recommend. **Приоритет:** Must. **Трассировка:** FR-5 (8).
- **Предусловие:** Тесты не прошли (UC-08) либо исправление не подтверждено.

**Основной поток:**
1. Core формирует санитизированный draft и запрашивает отдельное подтверждение.
2. После подтверждения система создаёт GitHub issue вместо PR.
3. Issue содержит диагноз, evidence и код ошибки проверки; непроверенный patch,
   PR preview и сырой runtime output в issue не публикуются.

**Постусловие:** Задача зафиксирована для ручной доработки; production не изменён.

---

## UC-11. Просмотр audit trail действий агента

- **Актор:** Tech lead / on-call.
- **Уровень:** Observe. **Приоритет:** Must. **Трассировка:** FR-4/FR-5, NFR «все действия в audit trail», критерий «Есть audit trail investigation и remediation».
- **Предусловие:** Выполнялись investigation и/или remediation.

**Основной поток:**
1. Пользователь открывает журнал agent runs / agent steps.
2. Просматривает каждый tool call (input/output/status) investigation и remediation.

**Постусловие:** Полная прослеживаемость действий агента; ничего не выполнялось «в тени».

---

## UC-12. Сравнение метрик до/после исправления

- **Актор:** On-call инженер.
- **Уровень:** Observe. **Приоритет:** Should. **Трассировка:** 7.2 «режим сравнения метрик до и после patch», demo flow 02:50–03:00.
- **Предусловие:** Patch применён в sandbox; доступен replay после исправления.

**Основной поток:**
1. Инженер запускает replay после исправления.
2. Система показывает стабилизацию памяти (heap перестаёт расти).
3. Отображается сравнение метрик до/после patch.

**Постусловие:** Подтверждена эффективность исправления на данных.

---

## UC-13. Обработка упавшего GitHub Actions workflow

- **Актор:** DevOps / система (Build Gate).
- **Уровень:** Recommend. **Приоритет:** Should. **Трассировка:** 7.2 «обработка упавшего GitHub Actions workflow», «повторный запуск CI после исправления».
- **Предусловие:** Настроена интеграция GitHub Actions.

**Основной поток:**
1. Система получает сигнал упавшего pipeline.
2. Создаёт инцидент Build Gate и запускает investigation (UC-05).
3. После исправления повторно запускает CI и проверяет прохождение.

**Постусловие:** CI-падение расследовано; после patch pipeline перезапущен.

---

## UC-14. Локальный запуск демо одной командой

- **Актор:** Judge / разработчик.
- **Уровень:** — **Приоритет:** Must. **Трассировка:** NFR «Demo flow одной командой / Docker Compose», критерии «Demo repository запускается локально», «README, sample data, инструкция для judges».
- **Предусловие:** Клонирован репозиторий, установлен Docker.

**Основной поток:**
1. Judge запускает `docker compose` (или единственную команду по README).
2. Поднимаются web, api, worker, PostgreSQL; загружаются sample graph и recorded telemetry.
3. Judge проходит демо-сценарий UC-03 → UC-09.

**Постусловие:** Полный demo flow воспроизводится в чистом окружении; секреты не попадают в repo/логи/prompt.

---

## Трассировка «сценарий → юзкейсы»

Сквозной demo (раздел 13 плана) складывается из:

```
UC-01 → UC-02        (граф готов до демо)
UC-03 → UC-04        (replay → incident)
UC-05 → UC-06        (диагноз → визуализация)
UC-07 → UC-08        (fix → тесты)
UC-09 | UC-10        (PR или issue)
UC-11, UC-12         (audit trail, до/после)
```
